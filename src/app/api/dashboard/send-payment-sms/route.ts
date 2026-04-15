import { NextRequest } from "next/server";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { config } from "@/lib/config";
import { ok, fail, parseJson, requireSupabaseConfigured, withErrorHandling } from "../_utils";

const SendPaymentSmsSchema = z.object({
  phone: z.string().min(7, "Enter a valid phone number"),
  plan_tier: z.enum(["one_incident", "two_incident"]).optional().default("one_incident"),
  prospect_name: z.string().max(255).optional().default(""),
  company_name: z.string().max(255).optional().default(""),
});

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  return withErrorHandling("send-payment-sms", async () => {
    const dbCheck = requireSupabaseConfigured();
    if (dbCheck) return dbCheck;

    const parsed = await parseJson(req, SendPaymentSmsSchema);
    if (parsed.error || !parsed.data) {
      return fail(parsed.error || "Invalid payload", 400);
    }

    const { phone, plan_tier, prospect_name, company_name } = parsed.data;

    // Normalize phone to E.164
    const cleanPhone = phone.replace(/[\s()-]/g, "");
    const e164Phone = cleanPhone.startsWith("+") ? cleanPhone : `+1${cleanPhone}`;

    if (!/^\+[1-9]\d{6,14}$/.test(e164Phone)) {
      return fail("Invalid phone number format. Use E.164 format (e.g., +14165551234).", 400);
    }

    // 1. Find or create prospect by phone
    let prospectId: string;

    const { data: existing } = await supabase
      .from("prospects")
      .select("id, contact_name, company_name")
      .eq("phone", e164Phone)
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      prospectId = existing.id;
      if (prospect_name || company_name) {
        const updates: Record<string, string> = { updated_at: new Date().toISOString() };
        if (prospect_name) updates.contact_name = prospect_name;
        if (company_name) updates.company_name = company_name;
        await supabase.from("prospects").update(updates).eq("id", prospectId);
      }
    } else {
      const { data: created, error: createErr } = await supabase
        .from("prospects")
        .insert({
          phone: e164Phone,
          contact_name: prospect_name || null,
          company_name: company_name || null,
          status: "contacted",
          source: "web_call",
        })
        .select("id")
        .single();

      if (createErr || !created) {
        return fail("Failed to create prospect record", 500);
      }
      prospectId = created.id;
    }

    // 2. Create a call record
    const { data: callRow, error: callErr } = await supabase
      .from("calls")
      .insert({
        prospect_id: prospectId,
        retell_call_id: `web_sms_${Date.now()}`,
        outcome: "connected",
        summary: `Payment SMS sent to ${e164Phone}`,
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (callErr || !callRow) {
      return fail("Failed to create call record", 500);
    }

    // 3. Select plan + Stripe payment link
    const amountCents = plan_tier === "two_incident" ? 110000 : 65000;
    const paymentLink = plan_tier === "two_incident" ? config.stripe.link1100 : config.stripe.link650;

    // 4. Send SMS via Twilio
    const smsBody = `Hey! Here's your God Crew setup link: ${paymentLink} — Click through, hit Join, and you're all set. Questions? Just reply here.`;

    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${config.twilio.accountSid}/Messages.json`;
    const twilioAuth = Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString("base64");
    const fromNumber = config.twilio.fromNumber || "";

    const smsResponse = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${twilioAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: e164Phone,
        From: fromNumber,
        Body: smsBody,
      }).toString(),
    });

    if (!smsResponse.ok) {
      const errorText = await smsResponse.text();
      return fail(`SMS failed: ${errorText.substring(0, 200)}`, 500);
    }

    // 5. Persist payment record
    await supabase.from("payments").insert({
      call_id: callRow.id,
      prospect_id: prospectId,
      stripe_session_id: null,
      amount_cents: amountCents,
      status: "pending",
      email_sent: false,
    });

    // 6. Update prospect status
    await supabase
      .from("prospects")
      .update({ status: "interested", updated_at: new Date().toISOString() })
      .eq("id", prospectId);

    return ok({
      sent: true,
      phone: e164Phone,
      prospect_id: prospectId,
      message: "Payment link sent via SMS",
    });
  });
}
