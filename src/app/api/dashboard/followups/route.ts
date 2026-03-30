import { NextRequest } from "next/server";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { parseJson, parsePagination, withErrorHandling, ok, fail, requireSupabaseConfigured } from "@/app/api/dashboard/_utils";

const CreateFollowupSchema = z.object({
  prospect_id: z.string().uuid(),
  call_id: z.string().uuid().nullable().optional(),
  scheduled_at: z.string().datetime(),
  reason: z.string().max(500).optional().or(z.literal("")),
});

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  return withErrorHandling("dashboard followups get failed", async () => {
    const supabaseGuard = requireSupabaseConfigured();
    if (supabaseGuard) return supabaseGuard;

    const { limit, offset, searchParams } = parsePagination(req.url);
    const status = searchParams.get("status") || "";
    const dateFrom = searchParams.get("dateFrom") || "";
    const dateTo = searchParams.get("dateTo") || "";

    let query = supabase
      .from("followups")
      .select(
        "id, prospect_id, call_id, scheduled_at, reason, status, created_at, prospects(contact_name, company_name, phone), calls(retell_call_id, outcome)",
        { count: "exact" }
      )
      .order("scheduled_at", { ascending: true })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq("status", status);
    if (dateFrom) query = query.gte("scheduled_at", dateFrom);
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      query = query.lte("scheduled_at", end.toISOString());
    }

    const { data, error, count } = await query;
    if (error) return fail(error.message, 500);
    return ok(data || [], count || 0);
  });
}

export async function POST(req: NextRequest) {
  return withErrorHandling("dashboard followups post failed", async () => {
    const supabaseGuard = requireSupabaseConfigured();
    if (supabaseGuard) return supabaseGuard;

    const parsed = await parseJson(req, CreateFollowupSchema);
    if (parsed.error || !parsed.data) return fail(parsed.error || "Invalid payload", 400);

    const payload = {
      ...parsed.data,
      call_id: parsed.data.call_id || null,
      reason: parsed.data.reason || null,
      status: "pending",
    };
    const { data, error } = await supabase.from("followups").insert(payload).select("*").maybeSingle();
    if (error) return fail(error.message, 500);
    if (!data) return fail("Failed to create followup.", 500);

    await supabase.from("prospects").update({ status: "followup", updated_at: new Date().toISOString() }).eq("id", parsed.data.prospect_id);

    return ok(data, 1, 201);
  });
}
