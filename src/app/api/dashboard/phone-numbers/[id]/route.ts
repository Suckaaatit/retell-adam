import { NextRequest } from "next/server";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { parseJson, withErrorHandling, ok, fail, requireSupabaseConfigured } from "@/app/api/dashboard/_utils";

const ParamsSchema = z.object({ id: z.string().uuid() });

const UpdatePhoneSchema = z.object({
  active: z.boolean().optional(),
  number: z.string().regex(/^\+[1-9]\d{6,14}$/).optional(),
  daily_call_count: z.number().int().min(0).optional(),
  answered_calls: z.number().int().min(0).optional(),
  total_calls: z.number().int().min(0).optional(),
});

export const maxDuration = 60;

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withErrorHandling("dashboard phone numbers [id] patch failed", async () => {
    const supabaseGuard = requireSupabaseConfigured();
    if (supabaseGuard) return supabaseGuard;

    const { id } = await context.params;
    const parsedParams = ParamsSchema.safeParse({ id });
    if (!parsedParams.success) return fail(parsedParams.error.message, 400);

    const parsed = await parseJson(req, UpdatePhoneSchema);
    if (parsed.error || !parsed.data) return fail(parsed.error || "Invalid payload", 400);

    const updatePayload = { ...parsed.data };
    if (
      typeof parsed.data.total_calls === "number" &&
      parsed.data.total_calls > 0 &&
      typeof parsed.data.answered_calls === "number"
    ) {
      Object.assign(updatePayload, {
        answer_rate: parsed.data.answered_calls / parsed.data.total_calls,
      });
    }

    const { data, error } = await supabase
      .from("phone_numbers")
      .update(updatePayload)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) return fail(error.message, 500);
    if (!data) return fail("Phone number not found", 404);
    return ok(data, 1);
  });
}
