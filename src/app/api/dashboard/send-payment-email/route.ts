import { NextRequest } from "next/server";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { sendEmail } from "@/lib/mailer";
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
      const emailResult = await sendEmail({
        to: email,
        subject: "Your Biohazard Response Plan — God Crew",
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
  const amountText = opts.amountCents >= 110000 ? '$1,100/year' : '$650/year';

  return `
    <div style="background:#0a0a0a;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#e9f6ff;">
      <div style="max-width:620px;margin:0 auto;background:#111827;border:1px solid rgba(255,255,255,0.1);border-radius:14px;overflow:hidden;">
        <div style="padding:26px 24px;border-bottom:1px solid rgba(255,255,255,0.08);">
          <h1 style="margin:0;font-size:22px;line-height:1.3;color:#ffffff;">Your Biohazard Response Plan — God Crew</h1>
          <p style="margin:12px 0 0;font-size:14px;color:#b6c6d8;">Hi ${escapeHtml(opts.prospectName)},</p>
          <p style="margin:8px 0 0;font-size:14px;line-height:1.6;color:#d6e5f2;">
            Great speaking with you just now. As discussed, here are the details for your annual biohazard response coverage.
          </p>
        </div>

        <div style="padding:20px 24px;">
          <h2 style="margin:0 0 8px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#7fc8ff;">Your Plan</h2>
          <div style="padding:14px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);">
            <p style="margin:0 0 8px;font-size:14px;"><strong>Plan:</strong> ${escapeHtml(opts.planLabel)}</p>
            <p style="margin:0 0 8px;font-size:14px;"><strong>Price:</strong> ${amountText}</p>
            <p style="margin:0 0 8px;font-size:14px;"><strong>Response Time:</strong> 4 hours or less, guaranteed</p>
            <p style="margin:0;font-size:14px;"><strong>Property:</strong> ${escapeHtml(opts.companyName)}</p>
          </div>
        </div>

        <div style="padding:0 24px 10px;">
          <h2 style="margin:0 0 8px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#7fc8ff;">What Is Included</h2>
          <ul style="margin:0;padding-left:18px;color:#dce9f5;font-size:14px;line-height:1.75;">
            <li>Professional biohazard cleanup crew dispatched within 4 hours</li>
            <li>Certified technicians with full PPE and biohazard disposal</li>
            <li>No surprise billing — flat annual rate, no hidden fees</li>
            <li>No long-term lock-in — yearly plan, cancel anytime</li>
            <li>24/7 emergency dispatch hotline</li>
          </ul>
        </div>

        <div style="padding:18px 24px 12px;text-align:center;">
          <a href="${escapeHtml(opts.checkoutUrl)}" style="display:inline-block;background:linear-gradient(90deg,#38B6FF,#0066CC);color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 26px;border-radius:10px;">
            Complete Your Enrollment &rarr;
          </a>
          <p style="margin:14px 0 0;font-size:12px;line-height:1.6;color:#a9bcd0;">
            This is a secure payment page powered by Stripe. Your payment information is encrypted and never stored on our servers.
          </p>
        </div>

        <div style="padding:16px 24px 24px;border-top:1px solid rgba(255,255,255,0.08);">
          <p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#d6e5f2;">
            If you have any questions, reply to this email at <a href="mailto:hi@godcrew.com" style="color:#8ed5ff;text-decoration:none;">hi@godcrew.com</a>
          </p>
          <p style="margin:0;font-size:13px;color:#9eb2c6;">
            Adam — from God Crew
          </p>
          <p style="margin:12px 0 0;font-size:11px;line-height:1.4;color:#7f97ad;word-break:break-all;">
            If the button above doesn't work, copy and paste this secure checkout link into your browser:<br/>
            ${escapeHtml(opts.checkoutUrl)}
          </p>
        </div>
      </div>
    </div>
  `;
}
