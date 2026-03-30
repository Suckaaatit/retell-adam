import { NextRequest } from "next/server";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { parseJson, withErrorHandling, ok, fail, requireSupabaseConfigured } from "@/app/api/dashboard/_utils";
import { deriveCallAnalytics } from "@/lib/call-analytics";

const UuidSchema = z.string().uuid("Prospect ID must be a valid UUID");

const UpdateProspectSchema = z.object({
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/, "Phone must be valid E.164").optional(),
  contact_name: z.string().max(255).nullable().optional(),
  company_name: z.string().max(255).nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal("")),
  source: z.string().max(100).nullable().optional(),
  status: z
    .enum([
      "pending",
      "dialing",
      "called",
      "failed",
      "contacted",
      "interested",
      "closed",
      "rejected",
      "followup",
      "do_not_call",
      "no_answer",
    ])
    .optional(),
});

export const maxDuration = 60;

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withErrorHandling("dashboard prospect detail failed", async () => {
    const supabaseGuard = requireSupabaseConfigured();
    if (supabaseGuard) return supabaseGuard;

    const { id } = await context.params;
    const parsedId = UuidSchema.safeParse(id);
    if (!parsedId.success) return fail(parsedId.error.message, 400);

    const [prospectRes, callsRes, objectionsRes, paymentsRes, followupsRes] = await Promise.all([
      supabase.from("prospects").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("calls")
        .select("id, retell_call_id, outcome, duration_seconds, started_at, ended_at, summary, transcript, recording_url, created_at")
        .eq("prospect_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("objections")
        .select("id, objection_type, prospect_statement, ai_response, resolved, created_at, call_id")
        .in(
          "call_id",
          (
            await supabase
              .from("calls")
              .select("id")
              .eq("prospect_id", id)
          ).data?.map((row) => row.id) || ["00000000-0000-0000-0000-000000000000"]
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("payments")
        .select("id, stripe_session_id, amount_cents, status, email_sent, email_sent_at, paid_at, created_at, call_id")
        .eq("prospect_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("followups")
        .select("id, scheduled_at, reason, status, created_at, call_id")
        .eq("prospect_id", id)
        .order("created_at", { ascending: false }),
    ]);

    if (prospectRes.error || !prospectRes.data) return fail(prospectRes.error?.message || "Prospect not found", 404);
    if (callsRes.error || objectionsRes.error || paymentsRes.error || followupsRes.error) {
      return fail("Failed to load prospect related records", 500);
    }

    const calls = callsRes.data || [];
    const objections = objectionsRes.data || [];
    const payments = paymentsRes.data || [];
    const followups = followupsRes.data || [];

    const objectionsByCall = objections.reduce<Record<string, typeof objections>>((acc, row) => {
      if (!row.call_id) return acc;
      if (!acc[row.call_id]) acc[row.call_id] = [];
      acc[row.call_id].push(row);
      return acc;
    }, {});
    const paymentsByCall = payments.reduce<Record<string, typeof payments>>((acc, row) => {
      if (!row.call_id) return acc;
      if (!acc[row.call_id]) acc[row.call_id] = [];
      acc[row.call_id].push(row);
      return acc;
    }, {});
    const followupsByCall = followups.reduce<Record<string, typeof followups>>((acc, row) => {
      if (!row.call_id) return acc;
      if (!acc[row.call_id]) acc[row.call_id] = [];
      acc[row.call_id].push(row);
      return acc;
    }, {});

    const enrichedCalls = calls.map((call) => {
      const analytics = deriveCallAnalytics({
        call: {
          id: call.id,
          prospect_id: id,
          retell_call_id: call.retell_call_id || null,
          phone: prospectRes.data.phone || null,
          outcome: call.outcome || null,
          transcript: call.transcript,
          recording_url: call.recording_url || null,
          summary: call.summary || null,
          duration_seconds: call.duration_seconds || null,
          started_at: call.started_at || null,
          ended_at: call.ended_at || null,
          created_at: call.created_at,
        },
        prospect: {
          id: prospectRes.data.id,
          contact_name: prospectRes.data.contact_name || null,
          company_name: prospectRes.data.company_name || null,
          email: prospectRes.data.email || null,
          phone: prospectRes.data.phone || null,
          status: prospectRes.data.status || null,
          metadata:
            typeof prospectRes.data.metadata === "object" && prospectRes.data.metadata
              ? (prospectRes.data.metadata as Record<string, unknown>)
              : null,
        },
        objections: objectionsByCall[call.id] || [],
        payments: paymentsByCall[call.id] || [],
        followups: followupsByCall[call.id] || [],
      });

      // Exclude raw transcript from response — it contains {role, content} objects
      // that would crash React if accidentally rendered as JSX children.
      const { transcript: _transcript, ...callWithoutTranscript } = call as Record<string, unknown>;
      return {
        ...callWithoutTranscript,
        analytics,
      };
    });

    return ok({
      prospect: prospectRes.data,
      calls: enrichedCalls,
      objections,
      payments,
      followups,
    });
  });
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withErrorHandling("dashboard prospect update failed", async () => {
    const supabaseGuard = requireSupabaseConfigured();
    if (supabaseGuard) return supabaseGuard;

    const { id } = await context.params;
    const parsedId = UuidSchema.safeParse(id);
    if (!parsedId.success) return fail(parsedId.error.message, 400);

    const parsed = await parseJson(req, UpdateProspectSchema);
    if (parsed.error || !parsed.data) return fail(parsed.error || "Invalid payload", 400);

    const updates = {
      ...parsed.data,
      email: parsed.data.email === "" ? null : parsed.data.email,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase.from("prospects").update(updates).eq("id", id).select("*").maybeSingle();
    if (error) {
      if (error.code === "23505") return fail("Phone already exists for another prospect.", 409);
      return fail(error.message, 500);
    }
    if (!data) return fail("Prospect not found", 404);
    return ok(data, 1);
  });
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withErrorHandling("dashboard prospect delete failed", async () => {
    const supabaseGuard = requireSupabaseConfigured();
    if (supabaseGuard) return supabaseGuard;

    const { id } = await context.params;
    const parsedId = UuidSchema.safeParse(id);
    if (!parsedId.success) return fail(parsedId.error.message, 400);

    const callsRes = await supabase.from("calls").select("id").eq("prospect_id", id);
    if (callsRes.error) return fail(callsRes.error.message, 500);
    const callIds = (callsRes.data || []).map((call) => call.id);

    if (callIds.length > 0) {
      const objectionsDeleteRes = await supabase.from("objections").delete().in("call_id", callIds);
      if (objectionsDeleteRes.error) return fail(objectionsDeleteRes.error.message, 500);
    }

    const [followupsDeleteRes, paymentsDeleteRes, callsDeleteRes] = await Promise.all([
      supabase.from("followups").delete().eq("prospect_id", id),
      supabase.from("payments").delete().eq("prospect_id", id),
      supabase.from("calls").delete().eq("prospect_id", id),
    ]);

    if (followupsDeleteRes.error || paymentsDeleteRes.error || callsDeleteRes.error) {
      return fail("Failed to delete related records", 500);
    }

    const { error } = await supabase.from("prospects").delete().eq("id", id);
    if (error) return fail(error.message, 500);

    return ok({ ok: true }, 1);
  });
}
