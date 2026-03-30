import { NextRequest } from "next/server";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { resend } from "@/lib/resend";
import { config } from "@/lib/config";
import { ok, fail, parseJson, requireSupabaseConfigured, withErrorHandling } from "../_utils";

const SendPaymentEmailSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  plan_tier: z.enum(["one_incident", "two_incident"]).optional().default("one_incident"),
  prospect_name: z.string().max(255).optional().default(""),
  company_name: z.string().max(255).optional().default(""),
});

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  return withErrorHandling("send-payment-email", async () => {
    const dbCheck = requireSupabaseConfigured();
    if (dbCheck) return dbCheck;

    const parsed = await parseJson(req, SendPaymentEmailSchema);
    if (parsed.error || !parsed.data) {
      return fail(parsed.error || "Invalid payload", 400);
    }

    const { email, plan_tier, prospect_name, company_name } = parsed.data;

    // 1. Find or create prospect by email
    let prospectId: string;

    const { data: existing } = await supabase
      .from("prospects")
      .select("id, contact_name, company_name")
      .eq("email", email)
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
          phone: `+1000${Date.now().toString().slice(-7)}`,
          email,
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

    // 2. Create a call record for this web interaction
    const { data: callRow, error: callErr } = await supabase
      .from("calls")
      .insert({
        prospect_id: prospectId,
        retell_call_id: `web_email_${Date.now()}`,
        outcome: "connected",
        summary: `Payment email sent to ${email}`,
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
    const planLabel = plan_tier === "two_incident"
      ? "Annual Biohazard Response — 2 Incident Coverage"
      : "Annual Biohazard Response — 1 Incident Coverage";
    const resolvedName = prospect_name || (email.includes("@") ? email.split("@")[0] : "there");
    const resolvedCompany = company_name || existing?.company_name || "your property";

    // 4. Send email via Resend
    const resendDisabled = config.resend.fromEmail.toLowerCase().endsWith("@example.com");
    let emailSent = false;

    if (!resendDisabled) {
      const emailResult = await resend.emails.send({
        from: `${config.resend.fromName} <${config.resend.fromEmail}>`,
        to: email,
        replyTo: config.resend.replyToEmail,
        subject: "Your Biohazard Response Plan — God's Cleaning Crew",
        html: buildPaymentEmailHtml({
          checkoutUrl: paymentLink,
          prospectName: resolvedName,
          companyName: resolvedCompany,
          planLabel,
          amountCents,
          phoneNumber: config.resend.businessPhone,
          websiteUrl: config.resend.businessWebsite,
        }),
      });

      if (emailResult.error) {
        return fail(`Email failed: ${JSON.stringify(emailResult.error)}`, 500);
      }
      emailSent = true;
    }

    // 5. Persist payment record
    await supabase.from("payments").insert({
      call_id: callRow.id,
      prospect_id: prospectId,
      stripe_session_id: null,
      amount_cents: amountCents,
      status: "pending",
      email_sent: emailSent,
      email_sent_at: emailSent ? new Date().toISOString() : null,
    });

    // 6. Update prospect status
    await supabase
      .from("prospects")
      .update({ status: "interested", email, updated_at: new Date().toISOString() })
      .eq("id", prospectId);

    return ok({
      sent: emailSent,
      email,
      prospect_id: prospectId,
      message: resendDisabled ? "Email sending is disabled (dev mode)" : "Payment link sent",
    });
  });
}

function escapeHtml(str: string) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildPaymentEmailHtml(opts: {
  checkoutUrl: string;
  prospectName: string;
  companyName: string;
  planLabel: string;
  amountCents: number;
  phoneNumber: string;
  websiteUrl: string;
}) {
  const price = `$${(opts.amountCents / 100).toLocaleString("en-US")}`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 0;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#111;border-radius:12px;overflow:hidden;">
  <tr><td style="padding:32px;text-align:center;">
    <h1 style="color:#fff;font-size:22px;margin:0 0 8px;">God&#39;s Cleaning Crew</h1>
    <p style="color:#888;font-size:14px;margin:0;">Biohazard Response Plan</p>
  </td></tr>
  <tr><td style="padding:0 32px 24px;">
    <p style="color:#ccc;font-size:15px;line-height:1.6;">
      Hi ${escapeHtml(opts.prospectName)},<br/><br/>
      Thank you for speaking with us about protecting <strong>${escapeHtml(opts.companyName)}</strong>.
      As discussed, here is your personalized biohazard response plan:
    </p>
    <table width="100%" style="background:#1a1a1a;border-radius:8px;margin:20px 0;padding:16px;" cellpadding="8">
      <tr><td style="color:#888;font-size:13px;">Plan</td><td style="color:#fff;font-size:13px;">${escapeHtml(opts.planLabel)}</td></tr>
      <tr><td style="color:#888;font-size:13px;">Price</td><td style="color:#0f0;font-size:15px;font-weight:bold;">${price}/year</td></tr>
      <tr><td style="color:#888;font-size:13px;">Response</td><td style="color:#fff;font-size:13px;">2-hour on-site guarantee</td></tr>
    </table>
    <div style="text-align:center;margin:24px 0;">
      <a href="${escapeHtml(opts.checkoutUrl)}" style="background:#00e676;color:#000;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px;display:inline-block;">
        Secure Your Coverage Now
      </a>
    </div>
    <p style="color:#666;font-size:12px;text-align:center;">
      Or copy this link: ${escapeHtml(opts.checkoutUrl)}
    </p>
  </td></tr>
  <tr><td style="padding:24px 32px;border-top:1px solid #222;text-align:center;">
    <p style="color:#666;font-size:12px;margin:0;">
      Questions? Call ${escapeHtml(opts.phoneNumber)} or visit
      <a href="${escapeHtml(opts.websiteUrl)}" style="color:#4a9eff;">${escapeHtml(opts.websiteUrl)}</a>
    </p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}
