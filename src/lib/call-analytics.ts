type StageReached = "pitch" | "objections" | "closing" | "closed";

type FailureReason =
  | "hung_up"
  | "hard_no"
  | "gatekeeper_block"
  | "voicemail"
  | "no_answer"
  | "wrong_number"
  | "lost_to_objection"
  | "multiple_objections_handled"
  | "scheduled_followup"
  | "referred_elsewhere"
  | "payment_pending"
  | "payment_failed"
  | "backed_out_at_close"
  | "promised_to_pay_later"
  | "error";

type EventTone = "blue" | "green" | "amber" | "red" | "gray";

export type PropertyType = "condo" | "retirement_home" | "hotel" | "commercial" | "unknown";

export type ObjectionCategoryId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export type ObjectionCategoryMeta = {
  id: ObjectionCategoryId;
  key: string;
  label: string;
};

export const OBJECTION_CATEGORIES: ObjectionCategoryMeta[] = [
  { id: 1, key: "deflection_delay", label: "Deflection & Delay" },
  { id: 2, key: "authority_ownership", label: "Authority & Ownership" },
  { id: 3, key: "status_quo", label: "Status Quo" },
  { id: 4, key: "cost_value", label: "Cost & Value" },
  { id: 5, key: "trust_credibility", label: "Trust & Credibility" },
  { id: 6, key: "process_bureaucracy", label: "Process & Bureaucracy" },
  { id: 7, key: "timing_urgency", label: "Timing & Urgency" },
  { id: 8, key: "minimization", label: "Minimization" },
  { id: 9, key: "defensive", label: "Defensive" },
  { id: 10, key: "hard_no", label: "Hard No" },
];

export type AnalyticsTimelineEvent = {
  id: string;
  label: string;
  detail: string;
  tone: EventTone;
  offset_seconds: number;
  timestamp: string | null;
};

export type AnalyticsObjection = {
  id: string;
  call_id?: string | null;
  objection_type: string;
  prospect_statement: string | null;
  ai_response: string | null;
  resolved: boolean | null;
  created_at: string | null;
};

export type AnalyticsPayment = {
  id: string;
  call_id?: string | null;
  status: string | null;
  email_sent: boolean | null;
  email_sent_at: string | null;
  paid_at: string | null;
  created_at: string | null;
  amount_cents: number | null;
  stripe_session_id: string | null;
};

export type AnalyticsFollowup = {
  id: string;
  call_id?: string | null;
  status: string | null;
  scheduled_at: string | null;
  reason: string | null;
  created_at: string | null;
};

export type AnalyticsProspect = {
  id: string;
  contact_name: string | null;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  metadata?: Record<string, unknown> | null;
};

export type AnalyticsCall = {
  id: string;
  prospect_id: string | null;
  retell_call_id: string | null;
  phone: string | null;
  outcome: string | null;
  transcript: unknown;
  recording_url: string | null;
  summary: string | null;
  duration_seconds: number | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
};

export type ObjectionInstanceOutcome = {
  objection_id: string;
  category_id: ObjectionCategoryId;
  category_label: string;
  category_key: string;
  statement: string;
  ai_response: string;
  overcame: boolean;
  killed: boolean;
};

export type DerivedCallAnalytics = {
  stage_reached: StageReached;
  failure_stage: Exclude<StageReached, "closed"> | null;
  failure_reason: FailureReason | null;
  reached_prospect: boolean;
  engaged: boolean;
  interested: boolean;
  objection_categories: ObjectionCategoryId[];
  objections_count: number;
  objections_overcome: number;
  email_collected: boolean;
  payment_sent: boolean;
  payment_completed: boolean;
  payment_failed: boolean;
  followup_scheduled: boolean;
  referred_elsewhere: boolean;
  timeline: AnalyticsTimelineEvent[];
  objection_outcomes: ObjectionInstanceOutcome[];
};

export function categoryMetaById(categoryId: ObjectionCategoryId): ObjectionCategoryMeta {
  return OBJECTION_CATEGORIES.find((item) => item.id === categoryId) || OBJECTION_CATEGORIES[0];
}

export function formatTimelineClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function derivePropertyType(prospect: AnalyticsProspect | null): PropertyType {
  const rawFromMetadata =
    prospect?.metadata && typeof prospect.metadata === "object"
      ? (prospect.metadata.property_type as string | undefined)
      : undefined;
  const company = String(prospect?.company_name || "").toLowerCase();
  const metadataType = String(rawFromMetadata || "").toLowerCase();
  const source = `${metadataType} ${company}`;

  if (source.includes("retirement") || source.includes("senior") || source.includes("assisted")) {
    return "retirement_home";
  }
  if (source.includes("condo") || source.includes("condominium")) {
    return "condo";
  }
  if (source.includes("hotel") || source.includes("inn") || source.includes("resort")) {
    return "hotel";
  }
  if (source.trim().length > 0) {
    return "commercial";
  }
  return "unknown";
}

function cleanText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function includesAny(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern));
}

function transcriptToText(transcript: unknown): string {
  if (!transcript) return "";
  if (typeof transcript === "string") return transcript;

  if (Array.isArray(transcript)) {
    return transcript
      .map((item) => {
        if (!item || typeof item !== "object") return "";
        const row = item as Record<string, unknown>;
        if (typeof row.message === "string") return row.message;
        if (typeof row.text === "string") return row.text;
        if (typeof row.content === "string") return row.content;
        return "";
      })
      .join(" ");
  }

  if (typeof transcript === "object") {
    const row = transcript as Record<string, unknown>;
    if (Array.isArray(row.messages)) {
      return row.messages
        .map((item) => {
          if (!item || typeof item !== "object") return "";
          const nested = item as Record<string, unknown>;
          if (typeof nested.message === "string") return nested.message;
          if (typeof nested.text === "string") return nested.text;
          if (typeof nested.content === "string") return nested.content;
          return "";
        })
        .join(" ");
    }
  }

  return "";
}

function toEpoch(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function secondsFrom(startIso: string | null | undefined, pointIso: string | null | undefined): number | null {
  const startMs = toEpoch(startIso || null);
  const pointMs = toEpoch(pointIso || null);
  if (startMs === null || pointMs === null) return null;
  const diff = Math.floor((pointMs - startMs) / 1000);
  return Number.isFinite(diff) ? Math.max(0, diff) : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function detectGatekeeper(text: string): boolean {
  return includesAny(text, [
    "gatekeeper",
    "reception",
    "receptionist",
    "front desk",
    "transfer you",
    "not the decision maker",
    "decision maker is not available",
    "head office handles",
  ]);
}

function detectWrongNumber(text: string): boolean {
  return includesAny(text, [
    "wrong number",
    "wrong person",
    "you have the wrong",
    "does not work here",
    "not this property",
  ]);
}

function detectHardNo(text: string): boolean {
  return includesAny(text, [
    "not interested",
    "remove me",
    "do not call",
    "don't call",
    "stop calling",
    "take me off",
    "we are good thanks",
    "no thanks",
  ]);
}

function detectReferral(text: string): boolean {
  return includesAny(text, [
    "referred",
    "talk to",
    "speak to",
    "contact our manager",
    "reach out to",
    "send this to",
  ]);
}

function normalizeOutcome(value: string | null | undefined): string {
  return cleanText(String(value || "unknown"));
}

function mapObjectionToCategory(objectionType: string, statement: string): ObjectionCategoryId {
  const normalizedType = cleanText(objectionType);
  const text = cleanText(statement);

  if (normalizedType === "send_info" || normalizedType === "call_later" || normalizedType === "busy_moment") return 1;
  if (normalizedType === "has_provider") return 3;
  if (normalizedType === "too_expensive") return 4;
  if (normalizedType === "not_interested") return 10;

  if (includesAny(text, ["decision maker", "head office", "not my call", "owner handles", "corporate"])) return 2;
  if (includesAny(text, ["reference", "credential", "proof", "legit", "licensed", "trusted"])) return 5;
  if (includesAny(text, ["rfp", "procurement", "onboarding", "vendor process", "policy"])) return 6;
  if (includesAny(text, ["not urgent", "next quarter", "later this year", "timing"])) return 7;
  if (includesAny(text, ["insurance", "overkill", "rare", "never had an issue"])) return 8;
  if (includesAny(text, ["scare tactic", "pushy", "pressure"])) return 9;
  if (includesAny(text, ["already have", "existing provider", "we use someone"])) return 3;
  if (includesAny(text, ["budget", "too expensive", "cost"])) return 4;
  if (includesAny(text, ["not interested", "remove me", "stop calling"])) return 10;

  return 3;
}

function toneForFailureReason(reason: FailureReason | null): EventTone {
  if (!reason) return "green";
  if (reason === "payment_pending" || reason === "scheduled_followup" || reason === "promised_to_pay_later") return "amber";
  if (reason === "voicemail" || reason === "no_answer" || reason === "wrong_number") return "gray";
  return "red";
}

type DeriveInput = {
  call: AnalyticsCall;
  prospect: AnalyticsProspect | null;
  objections: AnalyticsObjection[];
  payments: AnalyticsPayment[];
  followups: AnalyticsFollowup[];
};

export function deriveCallAnalytics(input: DeriveInput): DerivedCallAnalytics {
  const call = input.call;
  const prospect = input.prospect;
  const sortedObjections = [...input.objections].sort(
    (a, b) => (toEpoch(a.created_at) || 0) - (toEpoch(b.created_at) || 0)
  );
  const sortedPayments = [...input.payments].sort((a, b) => (toEpoch(a.created_at) || 0) - (toEpoch(b.created_at) || 0));
  const sortedFollowups = [...input.followups].sort(
    (a, b) => (toEpoch(a.created_at) || 0) - (toEpoch(b.created_at) || 0)
  );

  const callText = cleanText(`${call.summary || ""} ${transcriptToText(call.transcript)}`);
  const outcome = normalizeOutcome(call.outcome);
  const durationSeconds = Math.max(0, Number(call.duration_seconds || 0));
  const effectiveDuration = durationSeconds > 0 ? durationSeconds : Math.max(90, sortedObjections.length * 35 + 60);
  const prospectStatus = cleanText(String(prospect?.status || ""));

  const noAnswerSignal = outcome === "no_answer" || outcome === "busy";
  const voicemailSignal = outcome === "voicemail";
  const gatekeeperSignal = detectGatekeeper(callText);
  const wrongNumberSignal = detectWrongNumber(callText);
  const hardNoSignal = detectHardNo(callText) || outcome === "rejected" || prospectStatus === "do_not_call";
  const unreachable = noAnswerSignal || voicemailSignal || wrongNumberSignal;

  const paymentCompleted = sortedPayments.some((row) => cleanText(String(row.status || "")) === "paid");
  const paymentFailed = sortedPayments.some((row) => {
    const status = cleanText(String(row.status || ""));
    return status === "failed" || status === "expired";
  });
  const paymentSent = sortedPayments.some((row) => {
    const status = cleanText(String(row.status || ""));
    return Boolean(row.email_sent) || Boolean(row.stripe_session_id) || ["pending", "paid", "failed", "expired"].includes(status);
  });
  const emailCollected = paymentSent || Boolean(String(prospect?.email || "").trim());
  const followupScheduled =
    sortedFollowups.some((row) => ["pending", "processing"].includes(cleanText(String(row.status || "")))) ||
    prospectStatus === "followup";
  const referredElsewhere = detectReferral(callText);

  let stageReached: StageReached = "pitch";
  if (paymentCompleted) {
    stageReached = "closed";
  } else if (paymentSent || emailCollected) {
    stageReached = "closing";
  } else if (sortedObjections.length > 0 || followupScheduled || referredElsewhere || (!unreachable && durationSeconds >= 30)) {
    stageReached = "objections";
  } else {
    stageReached = "pitch";
  }

  let failureReason: FailureReason | null = null;
  let failureStage: Exclude<StageReached, "closed"> | null = stageReached === "closed" ? null : stageReached;

  if (stageReached === "closing") {
    if (paymentFailed) failureReason = "payment_failed";
    else if (followupScheduled) failureReason = "promised_to_pay_later";
    else if (paymentSent) failureReason = "payment_pending";
    else failureReason = "backed_out_at_close";
  } else if (stageReached === "objections") {
    if (followupScheduled) failureReason = "scheduled_followup";
    else if (referredElsewhere) failureReason = "referred_elsewhere";
    else if (hardNoSignal) failureReason = "hard_no";
    else if (sortedObjections.length > 1) failureReason = "multiple_objections_handled";
    else failureReason = "lost_to_objection";
  } else if (stageReached === "pitch") {
    if (voicemailSignal) failureReason = "voicemail";
    else if (noAnswerSignal) failureReason = "no_answer";
    else if (wrongNumberSignal) failureReason = "wrong_number";
    else if (gatekeeperSignal) failureReason = "gatekeeper_block";
    else if (hardNoSignal) failureReason = "hard_no";
    else if (outcome === "error") failureReason = "error";
    else if (durationSeconds > 0 && durationSeconds < 30) failureReason = "hung_up";
    else failureReason = "hung_up";
  } else {
    failureReason = null;
    failureStage = null;
  }

  const enrichedObjections = sortedObjections.map((obj) => {
    const statement = String(obj.prospect_statement || "");
    const categoryId = mapObjectionToCategory(obj.objection_type, statement);
    const categoryMeta = categoryMetaById(categoryId);
    return {
      ...obj,
      categoryId,
      categoryMeta,
      statement,
      aiResponse: String(obj.ai_response || ""),
    };
  });

  const objectionCategories = Array.from(
    new Set(enrichedObjections.map((item) => item.categoryId))
  ) as ObjectionCategoryId[];

  const lastObjectionAdvanced =
    stageReached === "closing" ||
    stageReached === "closed" ||
    followupScheduled ||
    referredElsewhere;

  const objectionOutcomes: ObjectionInstanceOutcome[] = enrichedObjections.map((item, index) => {
    const isLast = index === enrichedObjections.length - 1;
    const overcame = isLast ? lastObjectionAdvanced : true;
    return {
      objection_id: item.id,
      category_id: item.categoryId,
      category_key: item.categoryMeta.key,
      category_label: item.categoryMeta.label,
      statement: item.statement,
      ai_response: item.aiResponse,
      overcame,
      killed: !overcame,
    };
  });

  const objectionsCount = enrichedObjections.length;
  const objectionsOvercome = objectionOutcomes.filter((item) => item.overcame).length;

  const timeline: AnalyticsTimelineEvent[] = [];
  const startIso = call.started_at || call.created_at || null;

  const pushEvent = (
    id: string,
    label: string,
    detail: string,
    tone: EventTone,
    fallbackOffset: number,
    pointIso: string | null
  ) => {
    const offsetFromTimestamp = secondsFrom(startIso, pointIso);
    const offset = clamp(offsetFromTimestamp ?? fallbackOffset, 0, Math.max(1, effectiveDuration));
    timeline.push({
      id,
      label,
      detail,
      tone,
      offset_seconds: offset,
      timestamp: pointIso,
    });
  };

  pushEvent("call-connected", "Call Connected", "Prospect line connected.", "blue", 0, startIso);
  pushEvent("pitch", "Pitch Delivered", "Agent delivered opening pitch.", "blue", 5, startIso);

  if (stageReached !== "pitch") {
    pushEvent(
      "engaged",
      "Prospect Engaged",
      "Prospect gave a substantive response and conversation continued.",
      "blue",
      clamp(Math.floor(effectiveDuration * 0.18), 18, 40),
      startIso
    );
  }

  enrichedObjections.forEach((item, index) => {
    const objectionFallback = clamp(45 + index * 35, 15, Math.max(20, effectiveDuration - 30));
    pushEvent(
      `objection-${item.id}`,
      `Objection (${item.categoryMeta.id})`,
      item.statement || item.categoryMeta.label,
      "red",
      objectionFallback,
      item.created_at
    );
    if (item.aiResponse) {
      pushEvent(
        `response-${item.id}`,
        "Agent Response",
        item.aiResponse,
        "blue",
        clamp(objectionFallback + 12, 16, Math.max(20, effectiveDuration - 18)),
        null
      );
    }
  });

  const firstPayment = sortedPayments[0];
  if (emailCollected || paymentSent) {
    pushEvent(
      "email-collected",
      "Email Collected",
      "Payment link was sent to the prospect.",
      "amber",
      clamp(Math.floor(effectiveDuration * 0.7), 25, Math.max(26, effectiveDuration - 20)),
      firstPayment?.email_sent_at || firstPayment?.created_at || null
    );
  }

  if (paymentCompleted) {
    const paidPayment = sortedPayments.find((row) => cleanText(String(row.status || "")) === "paid") || sortedPayments[0];
    pushEvent(
      "payment-completed",
      "Payment Confirmed",
      "Secure Stripe checkout completed.",
      "green",
      clamp(Math.floor(effectiveDuration * 0.86), 30, Math.max(31, effectiveDuration - 8)),
      paidPayment?.paid_at || paidPayment?.created_at || null
    );
  } else if (followupScheduled) {
    const firstFollowup = sortedFollowups[0];
    pushEvent(
      "followup",
      "Follow-up Scheduled",
      firstFollowup?.reason || "Prospect requested callback.",
      "amber",
      clamp(Math.floor(effectiveDuration * 0.8), 28, Math.max(29, effectiveDuration - 10)),
      firstFollowup?.created_at || null
    );
  }

  pushEvent(
    "end",
    "Call Ended",
    failureReason ? `Call ended: ${failureReason.replaceAll("_", " ")}` : "Deal closed successfully.",
    toneForFailureReason(failureReason),
    effectiveDuration,
    call.ended_at || null
  );

  timeline.sort((a, b) => a.offset_seconds - b.offset_seconds);

  return {
    stage_reached: stageReached,
    failure_stage: failureStage,
    failure_reason: failureReason,
    reached_prospect: !unreachable,
    engaged: stageReached !== "pitch",
    interested: stageReached === "closing" || stageReached === "closed",
    objection_categories: objectionCategories,
    objections_count: objectionsCount,
    objections_overcome: objectionsOvercome,
    email_collected: emailCollected,
    payment_sent: paymentSent,
    payment_completed: paymentCompleted,
    payment_failed: paymentFailed,
    followup_scheduled: followupScheduled,
    referred_elsewhere: referredElsewhere,
    timeline,
    objection_outcomes: objectionOutcomes,
  };
}
