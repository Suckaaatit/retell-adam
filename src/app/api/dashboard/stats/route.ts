import { supabase } from "@/lib/supabase";
import { withErrorHandling, ok, fail, requireSupabaseConfigured } from "@/app/api/dashboard/_utils";

export const maxDuration = 60;

export async function GET() {
  return withErrorHandling("dashboard stats failed", async () => {
    const supabaseGuard = requireSupabaseConfigured();
    if (supabaseGuard) return supabaseGuard;

    const now = new Date();
    const todayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0)
    );
    const sevenDaysAgo = new Date(todayStart);
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 6);

    const [prospectsTotalRes, callsTodayRes, paidCountRes, paidRevenueRes, callsWeekRes, recentCallsRes] =
      await Promise.all([
        supabase.from("prospects").select("*", { count: "exact", head: true }),
        supabase.from("calls").select("*", { count: "exact", head: true }).gte("started_at", todayStart.toISOString()),
        supabase.from("payments").select("*", { count: "exact", head: true }).eq("status", "paid"),
        supabase.from("payments").select("amount_cents").eq("status", "paid"),
        supabase
          .from("calls")
          .select("started_at")
          .gte("started_at", sevenDaysAgo.toISOString())
          .order("started_at", { ascending: true }),
        supabase
          .from("calls")
          .select(
            "id, retell_call_id, phone, outcome, duration_seconds, started_at, created_at, prospects(contact_name, company_name, phone)"
          )
          .order("created_at", { ascending: false })
          .limit(10),
      ]);

    if (
      prospectsTotalRes.error ||
      callsTodayRes.error ||
      paidCountRes.error ||
      paidRevenueRes.error ||
      callsWeekRes.error ||
      recentCallsRes.error
    ) {
      const firstError =
        prospectsTotalRes.error ||
        callsTodayRes.error ||
        paidCountRes.error ||
        paidRevenueRes.error ||
        callsWeekRes.error ||
        recentCallsRes.error;
      return fail(firstError?.message || "Failed to fetch dashboard stats", 500);
    }

    const revenueCents = (paidRevenueRes.data || []).reduce(
      (sum, row) => sum + Number(row.amount_cents || 0),
      0
    );

    const dayMap = new Map<string, number>();
    for (let i = 0; i < 7; i += 1) {
      const date = new Date(sevenDaysAgo);
      date.setUTCDate(sevenDaysAgo.getUTCDate() + i);
      const key = date.toISOString().slice(0, 10);
      dayMap.set(key, 0);
    }
    for (const call of callsWeekRes.data || []) {
      if (!call.started_at) continue;
      const key = new Date(call.started_at).toISOString().slice(0, 10);
      if (dayMap.has(key)) {
        dayMap.set(key, (dayMap.get(key) || 0) + 1);
      }
    }

    const callsByDay = Array.from(dayMap.entries()).map(([day, calls]) => ({ day, calls }));

    const totalProspects = prospectsTotalRes.count || 0;
    const callsToday = callsTodayRes.count || 0;
    const paymentsPaid = paidCountRes.count || 0;
    const totalRevenue = revenueCents;

    return ok(
      {
        totalProspects,
        callsToday,
        paymentsPaid,
        totalRevenue,
        kpis: {
          total_prospects: totalProspects,
          calls_today: callsToday,
          payments_collected: paymentsPaid,
          revenue_cents: totalRevenue,
        },
        calls_by_day: callsByDay,
        recent_activity: recentCallsRes.data || [],
      },
      recentCallsRes.data?.length || 0
    );
  });
}
