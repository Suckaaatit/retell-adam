import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { supabase } from "@/lib/supabase";
import { logError, logInfo, logWarn } from "@/lib/logger";

export const maxDuration = 60;

type CountQuery = {
  total: number;
};

type ActivityTone = "green" | "blue" | "amber" | "red";

type ActivityItem = {
  id: string;
  text: string;
  tone: ActivityTone;
  time: string;
};

type OutcomeSummary = {
  connected: number;
  voicemail: number;
  no_answer: number;
  rejected: number;
};

type MaybeList<T> = T | T[] | null;

function safeCount(count: number | null): number {
  return typeof count === "number" ? count : 0;
}

function pickFirst<T>(value: MaybeList<T>): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string" && maybeMessage) return maybeMessage;
    try {
      return JSON.stringify(error);
    } catch {
      return "Unknown error";
    }
  }
  return String(error);
}

function summarizeOutcomes(values: Array<{ outcome: string | null }>): OutcomeSummary {
  const summary: OutcomeSummary = { connected: 0, voicemail: 0, no_answer: 0, rejected: 0 };
  for (const row of values) {
    const value = String(row.outcome || "").toLowerCase();
    if (value === "connected" || value === "closed" || value === "interested") summary.connected += 1;
    else if (value === "voicemail") summary.voicemail += 1;
    else if (value === "no_answer" || value === "busy") summary.no_answer += 1;
    else if (value === "rejected" || value === "do_not_call" || value === "failed") summary.rejected += 1;
  }
  return summary;
}

async function readCount(table: string, status?: string): Promise<CountQuery> {
  let query = supabase.from(table).select("*", { count: "exact", head: true });
  if (status) query = query.eq("status", status);

  const { count, error } = await query;
  if (error) {
    logWarn("Dashboard count query failed", { table, status, error: error.message });
    return { total: 0 };
  }

  return { total: safeCount(count) };
}

/**
 * GET /api/dashboard
 *
 * Fast dashboard payload used by the dashboard home page.
 * Returns only top metrics + compact activity feed.
 */
export async function GET() {
  try {
    const missingSupabaseConfig =
      !config.supabase.url?.trim() || !config.supabase.serviceRoleKey?.trim();
    if (missingSupabaseConfig) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in runtime environment variables.",
        },
        { status: 500 }
      );
    }

    const now = new Date();
    const startOfDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0)
    );
    const sevenDaysAgo = new Date(startOfDay);
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);

    const startOfDayIso = startOfDay.toISOString();
    const sevenDaysAgoIso = sevenDaysAgo.toISOString();

    const [
      prospectsTotal,
      prospectsPending,
      prospectsClosed,
      callsTodayRaw,
      paymentsPaid,
      paymentsPending,
      prospectsAddedTodayRaw,
      prospectsClosedThisWeekRaw,
      pendingPaymentEmailsSentRaw,
      todayOutcomesRes,
      recentCallsRes,
      recentPaymentsRes,
      recentFollowupsRes,
      recentDncRes,
    ] = await Promise.all([
      readCount("prospects"),
      readCount("prospects", "pending"),
      readCount("prospects", "closed"),
      supabase.from("calls").select("*", { count: "exact", head: true }).gte("created_at", startOfDayIso),
      readCount("payments", "paid"),
      readCount("payments", "pending"),
      supabase.from("prospects").select("*", { count: "exact", head: true }).gte("created_at", startOfDayIso),
      supabase
        .from("prospects")
        .select("*", { count: "exact", head: true })
        .eq("status", "closed")
        .gte("updated_at", sevenDaysAgoIso),
      supabase
        .from("payments")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending")
        .eq("email_sent", true),
      supabase.from("calls").select("outcome").gte("created_at", startOfDayIso).limit(2000),
      supabase
        .from("calls")
        .select("id, outcome, duration_seconds, started_at, created_at, prospects(contact_name, company_name)")
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("payments")
        .select("id, amount_cents, status, email_sent, paid_at, created_at, prospects(contact_name, company_name, email)")
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("followups")
        .select("id, status, scheduled_at, created_at, prospects(contact_name, company_name)")
        .in("status", ["pending", "processing"])
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("prospects")
        .select("id, contact_name, company_name, created_at, updated_at")
        .eq("status", "do_not_call")
        .order("updated_at", { ascending: false })
        .limit(10),
    ]);

    if (callsTodayRaw.error) logWarn("Dashboard calls today query failed", { error: callsTodayRaw.error.message });
    if (prospectsAddedTodayRaw.error) {
      logWarn("Dashboard added today query failed", { error: prospectsAddedTodayRaw.error.message });
    }
    if (prospectsClosedThisWeekRaw.error) {
      logWarn("Dashboard closed this week query failed", { error: prospectsClosedThisWeekRaw.error.message });
    }
    if (pendingPaymentEmailsSentRaw.error) {
      logWarn("Dashboard pending email count query failed", { error: pendingPaymentEmailsSentRaw.error.message });
    }
    if (todayOutcomesRes.error) logWarn("Dashboard outcomes query failed", { error: todayOutcomesRes.error.message });
    if (recentCallsRes.error) logWarn("Dashboard calls activity query failed", { error: recentCallsRes.error.message });
    if (recentPaymentsRes.error) {
      logWarn("Dashboard payments activity query failed", { error: recentPaymentsRes.error.message });
    }
    if (recentFollowupsRes.error) {
      logWarn("Dashboard followups activity query failed", { error: recentFollowupsRes.error.message });
    }
    if (recentDncRes.error) logWarn("Dashboard DNC activity query failed", { error: recentDncRes.error.message });

    const summary = {
      prospects_total: prospectsTotal.total,
      prospects_pending: prospectsPending.total,
      prospects_closed: prospectsClosed.total,
      calls_today: callsTodayRaw.error ? 0 : safeCount(callsTodayRaw.count),
      payments_paid: paymentsPaid.total,
      payments_pending: paymentsPending.total,
      prospects_added_today: prospectsAddedTodayRaw.error ? 0 : safeCount(prospectsAddedTodayRaw.count),
      prospects_closed_this_week: prospectsClosedThisWeekRaw.error ? 0 : safeCount(prospectsClosedThisWeekRaw.count),
      pending_payment_emails_sent: pendingPaymentEmailsSentRaw.error ? 0 : safeCount(pendingPaymentEmailsSentRaw.count),
      today_outcomes: summarizeOutcomes(todayOutcomesRes.error ? [] : todayOutcomesRes.data || []),
    };

    const activity: ActivityItem[] = [];

    for (const row of recentCallsRes.error ? [] : recentCallsRes.data || []) {
      const prospect = pickFirst(
        row.prospects as MaybeList<{ contact_name: string | null; company_name: string | null }>
      );
      const name = prospect?.contact_name || prospect?.company_name || "Unknown Prospect";
      const company = prospect?.company_name ? ` at ${prospect.company_name}` : "";
      const duration = Number(row.duration_seconds || 0);
      const minutes = Math.floor(duration / 60);
      const seconds = Math.floor(duration % 60);
      const durationLabel = `${minutes}:${String(seconds).padStart(2, "0")}`;
      activity.push({
        id: `call-${row.id}`,
        tone: "blue",
        text: `AI agent called ${name}${company} - ${(row.outcome || "unknown").replaceAll("_", " ")}, ${durationLabel}`,
        time: row.started_at || row.created_at,
      });
    }

    for (const row of recentPaymentsRes.error ? [] : recentPaymentsRes.data || []) {
      const prospect = pickFirst(
        row.prospects as MaybeList<{ contact_name: string | null; company_name: string | null; email: string | null }>
      );
      const owner = prospect?.contact_name || prospect?.company_name || prospect?.email || "Unknown";
      if (row.status === "paid") {
        activity.push({
          id: `payment-paid-${row.id}`,
          tone: "green",
          text: `Payment confirmed from ${owner}`,
          time: row.paid_at || row.created_at,
        });
      } else if (row.status === "pending" && row.email_sent) {
        activity.push({
          id: `payment-pending-${row.id}`,
          tone: "amber",
          text: `Payment link sent to ${prospect?.email || owner} - awaiting payment`,
          time: row.created_at,
        });
      }
    }

    for (const row of recentFollowupsRes.error ? [] : recentFollowupsRes.data || []) {
      const prospect = pickFirst(
        row.prospects as MaybeList<{ contact_name: string | null; company_name: string | null }>
      );
      const name = prospect?.contact_name || prospect?.company_name || "Unknown Prospect";
      activity.push({
        id: `followup-${row.id}`,
        tone: row.status === "processing" ? "blue" : "amber",
        text: `Follow-up scheduled for ${name}`,
        time: row.created_at,
      });
    }

    for (const row of recentDncRes.error ? [] : recentDncRes.data || []) {
      activity.push({
        id: `dnc-${row.id}`,
        tone: "red",
        text: `Prospect marked Do Not Call: ${row.contact_name || "Unknown"}, ${row.company_name || "No company"}`,
        time: row.updated_at || row.created_at,
      });
    }

    const sortedActivity = activity
      .filter((item) => Boolean(item.time))
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 10);

    logInfo("Dashboard data loaded", {
      prospectsTotal: summary.prospects_total,
      callsToday: summary.calls_today,
      activityItems: sortedActivity.length,
    });

    return NextResponse.json({
      ok: true,
      generated_at: new Date().toISOString(),
      summary,
      activity: sortedActivity,
    });
  } catch (error) {
    logError("Dashboard data load failed", error);
    return NextResponse.json({ ok: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
