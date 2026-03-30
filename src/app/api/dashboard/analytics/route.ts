import { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  OBJECTION_CATEGORIES,
  categoryMetaById,
  deriveCallAnalytics,
  derivePropertyType,
  formatTimelineClock,
  type AnalyticsCall,
  type AnalyticsFollowup,
  type AnalyticsObjection,
  type AnalyticsPayment,
  type AnalyticsProspect,
  type DerivedCallAnalytics,
  type ObjectionCategoryId,
  type PropertyType,
} from "@/lib/call-analytics";
import { ok, requireSupabaseConfigured, withErrorHandling } from "@/app/api/dashboard/_utils";

export const maxDuration = 60;

type RangePreset = "today" | "week" | "month" | "custom";

type AnalyticsCallRow = {
  call: AnalyticsCall;
  prospect: AnalyticsProspect | null;
  property_type: PropertyType;
  analytics: DerivedCallAnalytics;
  objections: AnalyticsObjection[];
  payments: AnalyticsPayment[];
  followups: AnalyticsFollowup[];
};

type BucketMember = {
  call_id: string;
  prospect_id: string | null;
  prospect_name: string;
  company_name: string;
  phone: string | null;
  stage_reached: string;
  failure_reason: string | null;
  outcome: string | null;
  duration_label: string;
  started_at: string | null;
};

const ALL_BUCKET_IDS = [
  "no_answer",
  "voicemail",
  "wrong_number",
  "hung_up_pitch",
  "hard_no_pitch",
  "gatekeeper_block",
  "lost_to_objection",
  "scheduled_followup",
  "referred_elsewhere",
  "backed_out_close",
  "payment_pending",
  "payment_failed",
  "closed_paid",
] as const;

type BucketId = (typeof ALL_BUCKET_IDS)[number];

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const asDate = new Date(value);
  return Number.isNaN(asDate.getTime()) ? null : asDate;
}

function pct(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Number(((numerator / denominator) * 100).toFixed(1));
}

function formatStageLabel(stage: string) {
  return stage
    .replaceAll("_", " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function formatPropertyTypeLabel(value: PropertyType) {
  if (value === "retirement_home") return "Retirement Homes";
  if (value === "condo") return "Condos";
  if (value === "hotel") return "Hotels";
  if (value === "commercial") return "Commercial";
  return "Unknown";
}

function resolveRange(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const presetRaw = String(params.get("preset") || params.get("range") || "week").toLowerCase();
  const preset: RangePreset =
    presetRaw === "today" || presetRaw === "week" || presetRaw === "month" || presetRaw === "custom"
      ? presetRaw
      : "week";

  const now = new Date();
  let from = new Date(now);
  let to = new Date(now);

  if (preset === "today") {
    from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  } else if (preset === "week") {
    from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    from.setUTCDate(from.getUTCDate() - 6);
  } else if (preset === "month") {
    from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  } else {
    const fromParam = parseDate(params.get("dateFrom"));
    const toParam = parseDate(params.get("dateTo"));
    if (fromParam) from = new Date(fromParam);
    if (toParam) to = new Date(toParam);
    if (!fromParam) {
      from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
      from.setUTCDate(from.getUTCDate() - 6);
    }
  }

  if (preset === "custom") {
    from.setUTCHours(0, 0, 0, 0);
    to.setUTCHours(23, 59, 59, 999);
  }

  if (to.getTime() < from.getTime()) {
    const swap = new Date(from);
    from = new Date(to);
    to = swap;
  }

  const rangeMs = Math.max(1, to.getTime() - from.getTime() + 1);
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - rangeMs + 1);

  return {
    preset,
    fromIso: from.toISOString(),
    toIso: to.toISOString(),
    previousFromIso: prevFrom.toISOString(),
    previousToIso: prevTo.toISOString(),
    propertyTypeFilter: (params.get("propertyType") || "all").toLowerCase(),
    compact: params.get("compact") === "1" || params.get("summaryOnly") === "1",
  };
}

function pickProspect(
  value:
    | AnalyticsProspect
    | Array<AnalyticsProspect>
    | null
    | undefined
): AnalyticsProspect | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] || null;
  return value;
}

async function fetchRowsByCallId<T>(table: string, select: string, callIds: string[]): Promise<T[]> {
  if (!callIds.length) return [];
  const chunkSize = 250;
  const chunks: string[][] = [];
  for (let i = 0; i < callIds.length; i += chunkSize) {
    chunks.push(callIds.slice(i, i + chunkSize));
  }

  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const { data, error } = await supabase.from(table).select(select).in("call_id", chunk);
      if (error) throw new Error(error.message);
      return (data || []) as T[];
    })
  );

  return results.flat();
}

async function loadDataset(fromIso: string, toIso: string, propertyTypeFilter: string): Promise<AnalyticsCallRow[]> {
  const { data: callData, error: callError } = await supabase
    .from("calls")
    .select(
      "id, prospect_id, retell_call_id, phone, outcome, transcript, recording_url, summary, duration_seconds, started_at, ended_at, created_at, prospects(id, contact_name, company_name, email, phone, status, metadata)"
    )
    .gte("created_at", fromIso)
    .lte("created_at", toIso)
    .order("created_at", { ascending: false })
    .limit(2500);

  if (callError) throw new Error(callError.message);

  const baseRows = (callData || [])
    .map((row) => {
      const prospect = pickProspect(row.prospects as AnalyticsProspect | AnalyticsProspect[] | null);
      const propertyType = derivePropertyType(prospect);
      return {
        call: {
          id: row.id as string,
          prospect_id: row.prospect_id as string | null,
          retell_call_id: row.retell_call_id as string | null,
          phone: row.phone as string | null,
          outcome: row.outcome as string | null,
          transcript: row.transcript,
          recording_url: row.recording_url as string | null,
          summary: row.summary as string | null,
          duration_seconds: row.duration_seconds as number | null,
          started_at: row.started_at as string | null,
          ended_at: row.ended_at as string | null,
          created_at: row.created_at as string,
        } satisfies AnalyticsCall,
        prospect: prospect
          ? ({
              id: prospect.id,
              contact_name: prospect.contact_name,
              company_name: prospect.company_name,
              email: prospect.email,
              phone: prospect.phone,
              status: prospect.status,
              metadata: prospect.metadata,
            } satisfies AnalyticsProspect)
          : null,
        property_type: propertyType,
      };
    })
    .filter((row) => (propertyTypeFilter === "all" ? true : row.property_type === propertyTypeFilter));

  if (!baseRows.length) return [];

  const callIds = baseRows.map((row) => row.call.id);
  const [objections, payments, followups] = await Promise.all([
    fetchRowsByCallId<AnalyticsObjection>(
      "objections",
      "id, call_id, objection_type, prospect_statement, ai_response, resolved, created_at",
      callIds
    ),
    fetchRowsByCallId<AnalyticsPayment>(
      "payments",
      "id, call_id, status, email_sent, email_sent_at, paid_at, created_at, amount_cents, stripe_session_id",
      callIds
    ),
    fetchRowsByCallId<AnalyticsFollowup>("followups", "id, call_id, status, scheduled_at, reason, created_at", callIds),
  ]);

  const objectionsByCall = objections.reduce<Record<string, AnalyticsObjection[]>>((acc, row) => {
    const key = row.call_id || "";
    if (!key) return acc;
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, {});

  const paymentsByCall = payments.reduce<Record<string, AnalyticsPayment[]>>((acc, row) => {
    const key = row.call_id || "";
    if (!key) return acc;
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, {});

  const followupsByCall = followups.reduce<Record<string, AnalyticsFollowup[]>>((acc, row) => {
    const key = row.call_id || "";
    if (!key) return acc;
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, {});

  return baseRows.map((row) => {
    const objectionsForCall = objectionsByCall[row.call.id] || [];
    const paymentsForCall = paymentsByCall[row.call.id] || [];
    const followupsForCall = followupsByCall[row.call.id] || [];
    const analytics = deriveCallAnalytics({
      call: row.call,
      prospect: row.prospect,
      objections: objectionsForCall,
      payments: paymentsForCall,
      followups: followupsForCall,
    });
    return {
      call: row.call,
      prospect: row.prospect,
      property_type: row.property_type,
      analytics,
      objections: objectionsForCall,
      payments: paymentsForCall,
      followups: followupsForCall,
    };
  });
}

function buildStageRates(rows: AnalyticsCallRow[]) {
  const reachedProspect = rows.filter((row) => row.analytics.reached_prospect).length;
  const engaged = rows.filter((row) => row.analytics.engaged).length;
  const objectionBase = rows.filter((row) => row.analytics.objections_count > 0).length;
  const objectionAdvanced = rows.filter((row) => {
    if (row.analytics.objections_count === 0) return false;
    return (
      row.analytics.stage_reached === "closing" ||
      row.analytics.stage_reached === "closed" ||
      row.analytics.failure_reason === "scheduled_followup" ||
      row.analytics.failure_reason === "referred_elsewhere"
    );
  }).length;
  const closingBase = rows.filter(
    (row) => row.analytics.stage_reached === "closing" || row.analytics.stage_reached === "closed"
  ).length;
  const paid = rows.filter((row) => row.analytics.payment_completed).length;

  return {
    pitch: pct(engaged, reachedProspect),
    objections: pct(objectionAdvanced, objectionBase),
    close: pct(paid, closingBase),
    reached_prospect_count: reachedProspect,
    engaged_count: engaged,
    objection_base_count: objectionBase,
    objection_advanced_count: objectionAdvanced,
    closing_base_count: closingBase,
    closed_paid_count: paid,
  };
}

function summarize(rows: AnalyticsCallRow[]) {
  const stageRates = buildStageRates(rows);

  const members: Record<BucketId, BucketMember[]> = ALL_BUCKET_IDS.reduce((acc, key) => {
    acc[key] = [];
    return acc;
  }, {} as Record<BucketId, BucketMember[]>);

  const pushMember = (bucket: BucketId, row: AnalyticsCallRow) => {
    const prospectName = row.prospect?.contact_name || row.prospect?.company_name || "Unknown Prospect";
    const companyName = row.prospect?.company_name || "-";
    members[bucket].push({
      call_id: row.call.id,
      prospect_id: row.call.prospect_id,
      prospect_name: prospectName,
      company_name: companyName,
      phone: row.call.phone || row.prospect?.phone || null,
      stage_reached: row.analytics.stage_reached,
      failure_reason: row.analytics.failure_reason,
      outcome: row.call.outcome,
      duration_label: formatTimelineClock(row.call.duration_seconds || 0),
      started_at: row.call.started_at || row.call.created_at,
    });
  };

  let noAnswer = 0;
  let voicemail = 0;
  let wrongNumber = 0;
  let hungUpPitch = 0;
  let hardNoPitch = 0;
  let gatekeeperBlock = 0;
  let lostToObjection = 0;
  let scheduledFollowup = 0;
  let referredElsewhere = 0;
  let backedOutClose = 0;
  let paymentPending = 0;
  let paymentFailed = 0;
  let closedPaid = 0;
  let plan650 = 0;
  let plan1100 = 0;
  let totalRevenueCents = 0;

  const propertyPerformance: Record<PropertyType, { total: number; closed: number }> = {
    condo: { total: 0, closed: 0 },
    retirement_home: { total: 0, closed: 0 },
    hotel: { total: 0, closed: 0 },
    commercial: { total: 0, closed: 0 },
    unknown: { total: 0, closed: 0 },
  };

  rows.forEach((row) => {
    const reason = row.analytics.failure_reason;
    const stage = row.analytics.stage_reached;
    propertyPerformance[row.property_type].total += 1;
    if (row.analytics.payment_completed) propertyPerformance[row.property_type].closed += 1;

    if (reason === "no_answer") {
      noAnswer += 1;
      pushMember("no_answer", row);
    } else if (reason === "voicemail") {
      voicemail += 1;
      pushMember("voicemail", row);
    } else if (reason === "wrong_number") {
      wrongNumber += 1;
      pushMember("wrong_number", row);
    }

    if (stage === "pitch" && reason === "hung_up") {
      hungUpPitch += 1;
      pushMember("hung_up_pitch", row);
    }
    if (stage === "pitch" && reason === "hard_no") {
      hardNoPitch += 1;
      pushMember("hard_no_pitch", row);
    }
    if (stage === "pitch" && reason === "gatekeeper_block") {
      gatekeeperBlock += 1;
      pushMember("gatekeeper_block", row);
    }

    if (stage === "objections" && ["lost_to_objection", "hard_no", "multiple_objections_handled"].includes(String(reason || ""))) {
      lostToObjection += 1;
      pushMember("lost_to_objection", row);
    }
    if (reason === "scheduled_followup") {
      scheduledFollowup += 1;
      pushMember("scheduled_followup", row);
    }
    if (reason === "referred_elsewhere") {
      referredElsewhere += 1;
      pushMember("referred_elsewhere", row);
    }

    if (reason === "backed_out_at_close") {
      backedOutClose += 1;
      pushMember("backed_out_close", row);
    }
    if (reason === "payment_pending" || reason === "promised_to_pay_later") {
      paymentPending += 1;
      pushMember("payment_pending", row);
    }
    if (reason === "payment_failed") {
      paymentFailed += 1;
      pushMember("payment_failed", row);
    }

    if (row.analytics.payment_completed) {
      closedPaid += 1;
      pushMember("closed_paid", row);
      const paidRows = row.payments.filter((payment) => String(payment.status || "").toLowerCase() === "paid");
      paidRows.forEach((payment) => {
        const cents = Number(payment.amount_cents || 0);
        totalRevenueCents += cents;
        if (cents >= 100000) plan1100 += 1;
        else plan650 += 1;
      });
    }
  });

  const totalCalls = rows.length;
  const unreachable = noAnswer + voicemail + wrongNumber;
  const reachedProspect = Math.max(0, totalCalls - unreachable);
  const engaged = rows.filter((row) => row.analytics.engaged).length;
  const interested = rows.filter((row) => row.analytics.interested).length;

  const objectionOutcomesByCategory = OBJECTION_CATEGORIES.reduce<
    Record<
      number,
      {
        category_id: ObjectionCategoryId;
        category_label: string;
        category_key: string;
        frequency: number;
        overcome_count: number;
        kill_count: number;
        overcome_rate: number;
        kill_rate: number;
        specific_objections: Array<{
          text: string;
          count: number;
          overcome_count: number;
          kill_count: number;
        }>;
        failed_examples: Array<{
          call_id: string;
          prospect_name: string;
          company_name: string;
          statement: string;
          ai_response: string;
          result: string;
        }>;
      }
    >
  >((acc, meta) => {
    acc[meta.id] = {
      category_id: meta.id,
      category_label: meta.label,
      category_key: meta.key,
      frequency: 0,
      overcome_count: 0,
      kill_count: 0,
      overcome_rate: 0,
      kill_rate: 0,
      specific_objections: [],
      failed_examples: [],
    };
    return acc;
  }, {});

  rows.forEach((row) => {
    const statementStatsByCategory: Record<
      number,
      Record<string, { count: number; overcome_count: number; kill_count: number }>
    > = {};

    row.analytics.objection_outcomes.forEach((objection) => {
      const category = objectionOutcomesByCategory[objection.category_id];
      category.frequency += 1;
      if (objection.overcame) category.overcome_count += 1;
      if (objection.killed) category.kill_count += 1;

      if (!statementStatsByCategory[objection.category_id]) statementStatsByCategory[objection.category_id] = {};
      const normalizedText = objection.statement.trim().length > 0 ? objection.statement.trim() : "(No verbatim captured)";
      if (!statementStatsByCategory[objection.category_id][normalizedText]) {
        statementStatsByCategory[objection.category_id][normalizedText] = { count: 0, overcome_count: 0, kill_count: 0 };
      }
      const item = statementStatsByCategory[objection.category_id][normalizedText];
      item.count += 1;
      if (objection.overcame) item.overcome_count += 1;
      if (objection.killed) item.kill_count += 1;

      if (objection.killed && category.failed_examples.length < 8) {
        category.failed_examples.push({
          call_id: row.call.id,
          prospect_name: row.prospect?.contact_name || row.prospect?.company_name || "Unknown Prospect",
          company_name: row.prospect?.company_name || "-",
          statement: normalizedText,
          ai_response: objection.ai_response || "No response captured.",
          result: row.analytics.failure_reason ? formatStageLabel(row.analytics.failure_reason) : "Lost",
        });
      }
    });

    Object.entries(statementStatsByCategory).forEach(([categoryId, entries]) => {
      const category = objectionOutcomesByCategory[Number(categoryId)];
      const merged = Object.entries(entries).map(([text, values]) => ({
        text,
        ...values,
      }));
      category.specific_objections.push(...merged);
    });
  });

  const heatmap = Object.values(objectionOutcomesByCategory)
    .map((entry) => {
      const mergedStatements = entry.specific_objections.reduce<Record<string, { count: number; overcome_count: number; kill_count: number }>>(
        (acc, statement) => {
          if (!acc[statement.text]) {
            acc[statement.text] = { count: 0, overcome_count: 0, kill_count: 0 };
          }
          acc[statement.text].count += statement.count;
          acc[statement.text].overcome_count += statement.overcome_count;
          acc[statement.text].kill_count += statement.kill_count;
          return acc;
        },
        {}
      );
      const specificObjections = Object.entries(mergedStatements)
        .map(([text, values]) => ({ text, ...values }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 12);

      return {
        ...entry,
        overcome_rate: pct(entry.overcome_count, entry.frequency),
        kill_rate: pct(entry.kill_count, entry.frequency),
        specific_objections: specificObjections,
      };
    })
    .sort((a, b) => b.frequency - a.frequency);

  const topKillerCategory = heatmap.find((row) => row.frequency > 0) || null;
  const topKillerName = topKillerCategory ? `${topKillerCategory.category_id}. ${topKillerCategory.category_label}` : "None";

  const emailCollectedCount = rows.filter((row) => row.analytics.email_collected).length;
  const emailToPaymentRate = pct(closedPaid, emailCollectedCount);

  const recommendations: Array<{ id: string; title: string; detail: string; tone: "green" | "blue" | "amber" | "red" }> = [];

  if (topKillerCategory) {
    recommendations.push({
      id: "top-killer",
      title: `${topKillerName} is the top call killer`,
      detail: `${topKillerCategory.kill_count} of ${topKillerCategory.frequency} occurrences ended the call (${topKillerCategory.kill_rate}% kill rate).`,
      tone: topKillerCategory.kill_rate >= 50 ? "red" : "amber",
    });
  }

  const noAnswerShare = pct(noAnswer, totalCalls);
  recommendations.push({
    id: "no-answer",
    title: `${noAnswerShare}% of calls reached no answer`,
    detail: "Try tighter dialing windows and prioritize time blocks with higher pickup rates.",
    tone: noAnswerShare > 30 ? "amber" : "blue",
  });

  if (paymentPending > 0) {
    recommendations.push({
      id: "pending-payments",
      title: `${paymentPending} payment links are pending`,
      detail: "Follow up today while call context is still fresh. Pending links are the fastest wins.",
      tone: "amber",
    });
  }

  const propertyRows = Object.entries(propertyPerformance)
    .filter(([, value]) => value.total > 0)
    .map(([key, value]) => ({
      key: key as PropertyType,
      label: formatPropertyTypeLabel(key as PropertyType),
      total: value.total,
      closed: value.closed,
      rate: pct(value.closed, value.total),
    }))
    .sort((a, b) => b.rate - a.rate);

  if (propertyRows.length >= 2) {
    recommendations.push({
      id: "property-segment",
      title: `${propertyRows[0].label} convert best`,
      detail: `${propertyRows[0].rate}% close rate vs ${propertyRows[propertyRows.length - 1].rate}% for ${propertyRows[propertyRows.length - 1].label}.`,
      tone: "blue",
    });
  }

  const closedDurations = rows
    .filter((row) => row.analytics.payment_completed)
    .map((row) => Number(row.call.duration_seconds || 0))
    .filter((value) => value > 0);
  const nonClosedDurations = rows
    .filter((row) => !row.analytics.payment_completed)
    .map((row) => Number(row.call.duration_seconds || 0))
    .filter((value) => value > 0);
  if (closedDurations.length > 0 && nonClosedDurations.length > 0) {
    const avgClosed = Math.round(closedDurations.reduce((sum, value) => sum + value, 0) / closedDurations.length);
    const avgNonClosed = Math.round(nonClosedDurations.reduce((sum, value) => sum + value, 0) / nonClosedDurations.length);
    recommendations.push({
      id: "duration-correlation",
      title: `Closed calls average ${formatTimelineClock(avgClosed)}`,
      detail: `Non-closed calls average ${formatTimelineClock(avgNonClosed)}. Short calls are less likely to close.`,
      tone: avgClosed > avgNonClosed ? "green" : "amber",
    });
  }

  recommendations.push({
    id: "pitch-benchmark",
    title: `Pitch-to-engagement is ${stageRates.pitch}%`,
    detail: stageRates.pitch >= 40 ? "Above baseline. Focus optimization on objections and close handling." : "Below benchmark. Refine the opening hook and first question.",
    tone: stageRates.pitch >= 40 ? "green" : "red",
  });

  const callsForTimeline = rows.map((row) => ({
    call_id: row.call.id,
    prospect_id: row.call.prospect_id,
    prospect_name: row.prospect?.contact_name || row.prospect?.company_name || "Unknown Prospect",
    company_name: row.prospect?.company_name || "-",
    phone: row.call.phone || row.prospect?.phone || null,
    property_type: row.property_type,
    outcome: row.call.outcome,
    duration_seconds: row.call.duration_seconds || 0,
    duration_label: formatTimelineClock(row.call.duration_seconds || 0),
    started_at: row.call.started_at || row.call.created_at,
    recording_url: row.call.recording_url,
    summary: row.call.summary,
    stage_reached: row.analytics.stage_reached,
    failure_stage: row.analytics.failure_stage,
    failure_reason: row.analytics.failure_reason,
    objections_count: row.analytics.objections_count,
    objections_overcome: row.analytics.objections_overcome,
    objection_categories: row.analytics.objection_categories.map((id) => {
      const meta = categoryMetaById(id);
      return { id, key: meta.key, label: meta.label };
    }),
    email_collected: row.analytics.email_collected,
    payment_sent: row.analytics.payment_sent,
    payment_completed: row.analytics.payment_completed,
    timeline: row.analytics.timeline,
  }));

  return {
    totals: {
      all_calls: totalCalls,
      reached_prospect: reachedProspect,
      engaged,
      interested,
      closed_paid: closedPaid,
      total_revenue_cents: totalRevenueCents,
      plan_650_count: plan650,
      plan_1100_count: plan1100,
      pending_payment_count: paymentPending,
    },
    funnel: {
      all_calls: totalCalls,
      no_answer: noAnswer,
      voicemail,
      wrong_number: wrongNumber,
      reached_prospect: reachedProspect,
      hung_up_pitch: hungUpPitch,
      hard_no_pitch: hardNoPitch,
      gatekeeper_block: gatekeeperBlock,
      engaged,
      lost_to_objection: lostToObjection,
      scheduled_followup: scheduledFollowup,
      referred_elsewhere: referredElsewhere,
      interested,
      backed_out_close: backedOutClose,
      payment_pending: paymentPending,
      payment_failed: paymentFailed,
      closed_paid: closedPaid,
    },
    stage_rates: {
      pitch_success_rate: stageRates.pitch,
      objection_overcome_rate: stageRates.objections,
      close_rate: stageRates.close,
      email_to_payment_rate: emailToPaymentRate,
      pitch_breakdown: {
        engaged,
        hung_up: hungUpPitch,
        hard_no: hardNoPitch,
        gatekeeper_block: gatekeeperBlock,
      },
      objection_breakdown: {
        overcame: stageRates.objection_advanced_count,
        lost: lostToObjection,
        followup: scheduledFollowup,
        referred: referredElsewhere,
      },
      closing_breakdown: {
        paid: closedPaid,
        pending: paymentPending,
        failed: paymentFailed,
        backed_out: backedOutClose,
      },
    },
    bucket_members: members,
    objection_heatmap: heatmap,
    top_killer_category: topKillerCategory
      ? {
          category_id: topKillerCategory.category_id,
          category_label: topKillerCategory.category_label,
          frequency: topKillerCategory.frequency,
          kill_count: topKillerCategory.kill_count,
          kill_rate: topKillerCategory.kill_rate,
        }
      : null,
    calls: callsForTimeline,
    property_performance: propertyRows,
    recommendations: recommendations.slice(0, 6),
  };
}

export async function GET(req: NextRequest) {
  return withErrorHandling("dashboard analytics get failed", async () => {
    const supabaseGuard = requireSupabaseConfigured();
    if (supabaseGuard) return supabaseGuard;

    const range = resolveRange(req);

    const [currentRows, previousRows] = await Promise.all([
      loadDataset(range.fromIso, range.toIso, range.propertyTypeFilter),
      loadDataset(range.previousFromIso, range.previousToIso, range.propertyTypeFilter),
    ]);

    const currentSummary = summarize(currentRows);
    const previousRates = buildStageRates(previousRows);

    const trend = {
      pitch_delta: Number((currentSummary.stage_rates.pitch_success_rate - previousRates.pitch).toFixed(1)),
      objections_delta: Number((currentSummary.stage_rates.objection_overcome_rate - previousRates.objections).toFixed(1)),
      close_delta: Number((currentSummary.stage_rates.close_rate - previousRates.close).toFixed(1)),
    };

    if (range.compact) {
      return ok({
        stage_rates: {
          pitch: currentSummary.stage_rates.pitch_success_rate,
          objections: currentSummary.stage_rates.objection_overcome_rate,
          close: currentSummary.stage_rates.close_rate,
        },
        trend,
      });
    }

    return ok({
      generated_at: new Date().toISOString(),
      range: {
        preset: range.preset,
        date_from: range.fromIso,
        date_to: range.toIso,
        property_type_filter: range.propertyTypeFilter,
      },
      ...currentSummary,
      trend,
    });
  });
}
