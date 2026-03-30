import { NextRequest } from "next/server";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { config } from "@/lib/config";
import { parseJson, withErrorHandling, ok, fail, requireSupabaseConfigured } from "@/app/api/dashboard/_utils";

const ParamsSchema = z.object({ id: z.string().uuid() });

const UpdateFollowupSchema = z.object({
  action: z.enum(["cancel", "dial_now", "update"]).optional(),
  status: z.enum(["pending", "processing", "completed", "cancelled"]).optional(),
  scheduled_at: z.string().datetime().optional(),
  reason: z.string().max(500).optional().or(z.literal("")),
});

export const maxDuration = 60;

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withErrorHandling("dashboard followups [id] patch failed", async () => {
    const supabaseGuard = requireSupabaseConfigured();
    if (supabaseGuard) return supabaseGuard;

    const { id } = await context.params;
    const parsedParams = ParamsSchema.safeParse({ id });
    if (!parsedParams.success) return fail(parsedParams.error.message, 400);

    const parsed = await parseJson(req, UpdateFollowupSchema);
    if (parsed.error || !parsed.data) return fail(parsed.error || "Invalid payload", 400);

    const { data: followup, error: followupError } = await supabase
      .from("followups")
      .select("id, prospect_id, call_id, status, scheduled_at, reason, prospects(phone, contact_name, company_name)")
      .eq("id", id)
      .maybeSingle();
    if (followupError || !followup) return fail("Followup not found", 404);

    if (parsed.data.action === "cancel") {
      const { data, error } = await supabase
        .from("followups")
        .update({ status: "cancelled" })
        .eq("id", id)
        .select("*")
        .maybeSingle();
      if (error) return fail(error.message, 500);
      if (!data) return fail("Followup not found", 404);
      return ok(data, 1);
    }

    if (parsed.data.action === "dial_now") {
      const prospect = Array.isArray(followup.prospects) ? followup.prospects[0] : followup.prospects;
      if (!prospect?.phone) return fail("Prospect phone number is missing.", 400);

      // Pick outbound number from phone_numbers table
      const { data: fromNumberRow } = await supabase
        .from("phone_numbers")
        .select("number")
        .eq("active", true)
        .lt("daily_call_count", 80)
        .order("daily_call_count", { ascending: true })
        .limit(1)
        .maybeSingle();

      const callFromNumber = fromNumberRow?.number || config.twilio.fromNumber || "";
      if (!callFromNumber) {
        return fail("No outbound phone number available. Add one in Settings → Phone Numbers.", 400);
      }

      // Initiate call via Twilio → ElevenLabs agent
      const twimlUrl = new URL("/api/twilio/twiml", config.app.url);
      twimlUrl.searchParams.set("prospect_name", prospect.contact_name || "");
      twimlUrl.searchParams.set("company_name", prospect.company_name || "");
      twimlUrl.searchParams.set("prospect_id", followup.prospect_id);

      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${config.twilio.accountSid}/Calls.json`;
      const twilioAuth = Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString("base64");

      const twilioBody = new URLSearchParams({
        To: prospect.phone,
        From: callFromNumber,
        Url: twimlUrl.toString(),
        Method: "POST",
      });

      const response = await fetch(twilioUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${twilioAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: twilioBody.toString(),
      });

      if (!response.ok) {
        return fail(`Twilio call failed with status ${response.status}`, 502);
      }

      const callPayload = (await response.json()) as { sid?: string };

      // Create call record
      if (callPayload?.sid) {
        await supabase.from("calls").upsert(
          {
            retell_call_id: callPayload.sid,
            prospect_id: followup.prospect_id,
            phone: prospect.phone,
            started_at: new Date().toISOString(),
          },
          { onConflict: "retell_call_id" }
        );
      }

      await supabase.from("followups").update({ status: "completed" }).eq("id", id);
      return ok({ followup_id: id, call: callPayload }, 1);
    }

    const updatePayload: Record<string, unknown> = {};
    if (parsed.data.status) updatePayload.status = parsed.data.status;
    if (parsed.data.scheduled_at) updatePayload.scheduled_at = parsed.data.scheduled_at;
    if (typeof parsed.data.reason !== "undefined") updatePayload.reason = parsed.data.reason || null;

    if (Object.keys(updatePayload).length === 0) {
      return fail("No updates provided.", 400);
    }

    const { data, error } = await supabase.from("followups").update(updatePayload).eq("id", id).select("*").maybeSingle();
    if (error) return fail(error.message, 500);
    if (!data) return fail("Followup not found", 404);
    return ok(data, 1);
  });
}
