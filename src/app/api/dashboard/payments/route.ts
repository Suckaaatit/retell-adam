import { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { parsePagination, withErrorHandling, ok, fail, requireSupabaseConfigured } from "@/app/api/dashboard/_utils";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  return withErrorHandling("dashboard payments get failed", async () => {
    const supabaseGuard = requireSupabaseConfigured();
    if (supabaseGuard) return supabaseGuard;

    const { limit, offset, searchParams } = parsePagination(req.url);
    const status = searchParams.get("status") || "";

    let query = supabase
      .from("payments")
      .select(
        "id, prospect_id, call_id, stripe_session_id, amount_cents, currency, status, email_sent, email_sent_at, paid_at, created_at, prospects(contact_name, company_name, email), calls(retell_call_id, outcome)",
        { count: "exact" }
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (status) query = query.eq("status", status);

    const now = new Date();
    const paidTodayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));

    const [paymentsRes, paidRevenueRes, totalPaymentsRes, paidTodayRes] = await Promise.all([
      query,
      supabase.from("payments").select("amount_cents").eq("status", "paid"),
      supabase.from("payments").select("*", { count: "exact", head: true }),
      supabase
        .from("payments")
        .select("*", { count: "exact", head: true })
        .eq("status", "paid")
        .gte("paid_at", paidTodayStart.toISOString()),
    ]);

    if (
      paymentsRes.error ||
      paidRevenueRes.error ||
      totalPaymentsRes.error ||
      paidTodayRes.error
    ) {
      return fail("Failed to fetch payments", 500);
    }

    const paidAmounts = paidRevenueRes.data || [];
    const totalRevenueCents = paidAmounts.reduce((sum, row) => sum + Number(row.amount_cents || 0), 0);
    const averagePaymentCents =
      paidAmounts.length > 0 ? Math.round(totalRevenueCents / paidAmounts.length) : 0;

    const totalCount = totalPaymentsRes.count || 0;
    const filteredCount = paymentsRes.count || 0;
    const paidCount = paidAmounts.length;
    const conversionRate = totalCount > 0 ? paidCount / totalCount : 0;

    return ok(
      {
        items: paymentsRes.data || [],
        kpis: {
          total_revenue_cents: totalRevenueCents,
          payments_today: paidTodayRes.count || 0,
          conversion_rate: conversionRate,
          average_payment_cents: averagePaymentCents,
        },
      },
      filteredCount
    );
  });
}
