import { NextRequest } from "next/server";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { parseJson, withErrorHandling, ok, fail, requireSupabaseConfigured } from "@/app/api/dashboard/_utils";

export const maxDuration = 60;

const CreatePhoneSchema = z.object({
  number: z.string().regex(/^\+[1-9]\d{6,14}$/, "Phone must be valid E.164"),
});

const ResetSchema = z.object({
  action: z.literal("reset_daily_counts"),
});

export async function GET() {
  return withErrorHandling("dashboard phone numbers get failed", async () => {
    const supabaseGuard = requireSupabaseConfigured();
    if (supabaseGuard) return supabaseGuard;

    const { data, error, count } = await supabase
      .from("phone_numbers")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false });
    if (error) return fail(error.message, 500);
    return ok(data || [], count || 0);
  });
}

export async function POST(req: NextRequest) {
  return withErrorHandling("dashboard phone numbers post failed", async () => {
    const supabaseGuard = requireSupabaseConfigured();
    if (supabaseGuard) return supabaseGuard;

    const parsed = await parseJson(req, CreatePhoneSchema);
    if (parsed.error || !parsed.data) return fail(parsed.error || "Invalid payload", 400);

    const { data, error } = await supabase
      .from("phone_numbers")
      .insert({
        number: parsed.data.number,
        daily_call_count: 0,
        total_calls: 0,
        answered_calls: 0,
        answer_rate: 0.5,
        active: true,
      })
      .select("*")
      .maybeSingle();
    if (error) {
      if (error.code === "23505") return fail("Phone number already exists.", 409);
      return fail(error.message, 500);
    }
    if (!data) return fail("Failed to add phone number.", 500);
    return ok(data, 1, 201);
  });
}

export async function PATCH(req: NextRequest) {
  return withErrorHandling("dashboard phone numbers patch failed", async () => {
    const supabaseGuard = requireSupabaseConfigured();
    if (supabaseGuard) return supabaseGuard;

    const parsed = await parseJson(req, ResetSchema);
    if (parsed.error || !parsed.data) return fail(parsed.error || "Invalid payload", 400);

    const { error } = await supabase
      .from("phone_numbers")
      .update({ daily_call_count: 0 })
      .gte("daily_call_count", 0);
    if (error) return fail(error.message, 500);

    return ok({ reset: true }, null);
  });
}
