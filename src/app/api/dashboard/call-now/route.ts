import { NextRequest } from "next/server";
import { z } from "zod";
import { config } from "@/lib/config";
import { supabase } from "@/lib/supabase";
import { parseJson, withErrorHandling, ok, fail, requireSupabaseConfigured } from "@/app/api/dashboard/_utils";

const CallNowSchema = z.object({
  prospect_id: z.string().uuid().optional(),
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/),
  contact_name: z.string().max(255).nullable().optional(),
});

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  return withErrorHandling("dashboard call-now failed", async () => {
    const supabaseGuard = requireSupabaseConfigured();
    if (supabaseGuard) return supabaseGuard;

    const parsed = await parseJson(req, CallNowSchema);
    if (parsed.error || !parsed.data) return fail(parsed.error || "Invalid payload", 400);

    const payload = parsed.data;
    const nowIso = new Date().toISOString();
    const phoneNumber = payload.phone;
    const contactName = payload.contact_name || "";
    let prospectId = payload.prospect_id || null;
    let companyName = "";

    // If prospect_id provided, lock the prospect
    if (prospectId) {
      const { data: lockedProspect, error: lockError } = await supabase
        .from("prospects")
        .update({ status: "dialing", updated_at: nowIso })
        .eq("id", prospectId)
        .in("status", ["pending", "followup", "called", "failed", "contacted", "no_answer"])
        .select("id, phone, contact_name, company_name, total_calls")
        .maybeSingle();

      if (lockError || !lockedProspect) {
        return fail("Prospect is already dialing or not callable.", 409);
      }
      companyName = lockedProspect.company_name || "";
    }

    // Pick outbound number from phone_numbers table
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
      if (prospectId) {
        await supabase
          .from("prospects")
          .update({ status: "pending", updated_at: new Date().toISOString() })
          .eq("id", prospectId);
      }
      return fail("No outbound phone number available. Add one in Settings → Phone Numbers.", 400);
    }

    // Build TwiML URL
    const twimlUrl = new URL("/api/twilio/twiml", config.app.url);
    twimlUrl.searchParams.set("prospect_name", contactName);
    twimlUrl.searchParams.set("company_name", companyName);
    if (prospectId) twimlUrl.searchParams.set("prospect_id", prospectId);

    // Create Twilio outbound call
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${config.twilio.accountSid}/Calls.json`;
    const twilioAuth = Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString("base64");

    const twilioBody = new URLSearchParams({
      To: phoneNumber,
      From: fromNumber,
      Url: twimlUrl.toString(),
      Method: "POST",
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
      if (prospectId) {
        await supabase
          .from("prospects")
          .update({ status: "pending", updated_at: new Date().toISOString() })
          .eq("id", prospectId);
      }
      return fail(`Twilio call failed (${response.status}): ${errorText}`, 502);
    }

    const callPayload = (await response.json()) as { sid?: string };
    if (!callPayload.sid) {
      if (prospectId) {
        await supabase
          .from("prospects")
          .update({ status: "pending", updated_at: new Date().toISOString() })
          .eq("id", prospectId);
      }
      return fail("Twilio response missing call SID.", 502);
    }

    // Record call in DB
    if (prospectId) {
      await Promise.all([
        supabase
          .from("prospects")
          .update({ status: "called", last_called_at: nowIso, updated_at: nowIso })
          .eq("id", prospectId),
        supabase.from("calls").upsert(
          { retell_call_id: callPayload.sid, prospect_id: prospectId, phone: phoneNumber, started_at: nowIso },
          { onConflict: "retell_call_id" }
        ),
      ]);
    } else {
      // Direct dial without prospect — just record the call
      await supabase.from("calls").upsert(
        { retell_call_id: callPayload.sid, phone: phoneNumber, started_at: nowIso },
        { onConflict: "retell_call_id" }
      );
    }

    return ok({ callId: callPayload.sid, call: callPayload }, 1);
  });
}
