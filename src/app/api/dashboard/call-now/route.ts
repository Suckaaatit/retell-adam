import { NextRequest } from "next/server";
import { z } from "zod";
import { config } from "@/lib/config";
import { supabase } from "@/lib/supabase";
import { parseJson, withErrorHandling, ok, fail, requireSupabaseConfigured } from "@/app/api/dashboard/_utils";

const CallNowSchema = z.object({
  prospect_id: z.string().uuid(),
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/).optional(),
  contact_name: z.string().max(255).nullable().optional(),
});

export const maxDuration = 60;

/**
 * POST /api/dashboard/call-now
 *
 * Initiates an outbound call via Twilio, then bridges the audio to
 * ElevenLabs Conversational AI agent via the /api/twilio/twiml endpoint.
 *
 * Flow:
 *   1. Lock prospect status to "dialing"
 *   2. Create Twilio outbound call pointing to TwiML endpoint
 *   3. TwiML streams audio to ElevenLabs agent
 *   4. Record call in DB
 */
export async function POST(req: NextRequest) {
  return withErrorHandling("dashboard call-now failed", async () => {
    const supabaseGuard = requireSupabaseConfigured();
    if (supabaseGuard) return supabaseGuard;

    const parsed = await parseJson(req, CallNowSchema);
    if (parsed.error || !parsed.data) return fail(parsed.error || "Invalid payload", 400);

    const payload = parsed.data;
    const nowIso = new Date().toISOString();

    // Atomically lock prospect
    const { data: lockedProspect, error: lockError } = await supabase
      .from("prospects")
      .update({ status: "dialing", updated_at: nowIso })
      .eq("id", payload.prospect_id)
      .in("status", ["pending", "followup", "called", "failed", "contacted", "no_answer"])
      .select("id, phone, contact_name, company_name, total_calls")
      .maybeSingle();

    if (lockError || !lockedProspect) {
      return fail("Prospect is already dialing or not callable.", 409);
    }

    const phoneNumber = payload.phone || lockedProspect.phone;
    if (!phoneNumber || !/^\+[1-9]\d{6,14}$/.test(phoneNumber)) {
      await supabase
        .from("prospects")
        .update({ status: "pending", updated_at: new Date().toISOString() })
        .eq("id", payload.prospect_id);
      return fail("Prospect phone must be valid E.164.", 400);
    }

    const contactName = payload.contact_name || lockedProspect.contact_name || "";
    const companyName = lockedProspect.company_name || "";

    // Pick outbound number from phone_numbers table (dashboard-managed)
    const { data: fromNumberRow } = await supabase
      .from("phone_numbers")
      .select("id, number, daily_call_count, total_calls")
      .eq("active", true)
      .lt("daily_call_count", 80)
      .order("daily_call_count", { ascending: true })
      .limit(1)
      .maybeSingle();

    const fromNumber = fromNumberRow?.number || config.twilio.fromNumber;
    if (!fromNumber) {
      await supabase
        .from("prospects")
        .update({ status: "pending", updated_at: new Date().toISOString() })
        .eq("id", payload.prospect_id);
      return fail("No outbound phone number available. Add one in Settings → Phone Numbers.", 400);
    }

    // Build TwiML URL with dynamic variables as query params
    const twimlUrl = new URL("/api/twilio/twiml", config.app.url);
    twimlUrl.searchParams.set("prospect_name", contactName);
    twimlUrl.searchParams.set("company_name", companyName);
    twimlUrl.searchParams.set("prospect_id", payload.prospect_id);

    // Create Twilio outbound call via REST API
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${config.twilio.accountSid}/Calls.json`;
    const twilioAuth = Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString("base64");

    const twilioBody = new URLSearchParams({
      To: phoneNumber,
      From: fromNumber,
      Url: twimlUrl.toString(),
      Method: "POST",
      StatusCallback: `${config.app.url}/api/twilio/twiml`,
      StatusCallbackMethod: "POST",
    });

    // Update phone number daily count
    if (fromNumberRow) {
      await supabase
        .from("phone_numbers")
        .update({
          daily_call_count: fromNumberRow.daily_call_count + 1,
          total_calls: (fromNumberRow.total_calls || 0) + 1,
          last_used_at: new Date().toISOString(),
        })
        .eq("id", fromNumberRow.id);
    }

    const response = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${twilioAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: twilioBody.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      await supabase
        .from("prospects")
        .update({ status: "pending", updated_at: new Date().toISOString() })
        .eq("id", payload.prospect_id);
      return fail(`Twilio call failed (${response.status}): ${errorText}`, 502);
    }

    const callPayload = (await response.json()) as { sid?: string };
    if (!callPayload.sid) {
      await supabase
        .from("prospects")
        .update({ status: "pending", updated_at: new Date().toISOString() })
        .eq("id", payload.prospect_id);
      return fail("Twilio response missing call SID.", 502);
    }

    // Use Twilio call SID as the retell_call_id (reuse column for external call ID)
    const [prospectUpdateRes, callUpsertRes] = await Promise.all([
      supabase
        .from("prospects")
        .update({
          status: "called",
          total_calls: Number(lockedProspect.total_calls || 0) + 1,
          last_called_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", payload.prospect_id),
      supabase.from("calls").upsert(
        {
          retell_call_id: callPayload.sid,
          prospect_id: payload.prospect_id,
          phone: phoneNumber,
          started_at: nowIso,
        },
        { onConflict: "retell_call_id" }
      ),
    ]);

    if (prospectUpdateRes.error || callUpsertRes.error) {
      await supabase
        .from("prospects")
        .update({ status: "pending", updated_at: new Date().toISOString() })
        .eq("id", payload.prospect_id);
      return fail(
        prospectUpdateRes.error?.message || callUpsertRes.error?.message || "Failed to persist call initiation.",
        500
      );
    }

    return ok({ callId: callPayload.sid, call: callPayload }, 1);
  });
}
