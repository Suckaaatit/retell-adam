import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { sendEmail } from '@/lib/mailer';
import { config } from '@/lib/config';
import { ProcessPaymentPayloadSchema } from '@/types';
import { logInfo, logError, logWarn } from '@/lib/logger';

export const maxDuration = 60;

/**
 * POST /api/internal/process-payment
 *
 * Background worker called via self-call pattern from /api/elevenlabs/actions.
 * Runs in its own serverless execution context (survives container freeze).
 *
 * Steps:
 * 1. Idempotency check — skip if payment link already sent
 * 2. Select plan + Stripe Payment Link URL
 * 3. Send payment link email via Resend (disabled when using example.com sender)
 * 4. Upsert payment record in Supabase
 * 5. Update prospect status to "interested"
 *
 * If this fails, the dead-letter cron (/api/cron/followups) retries stuck payments
 * where email_sent=false and created_at > 5 minutes ago.
 */
export async function POST(req: NextRequest) {
  let callId = 'unknown';
  let prospectId = 'unknown';

  try {
    const rawText = await req.text();
    let rawBody: unknown = null;
    if (rawText) {
      try {
        rawBody = JSON.parse(rawText);
      } catch {
        rawBody = null;
      }
    }

    // Authenticate — only internal calls allowed (prefer header, allow legacy body)
    const headerSecret =
      req.headers.get('x-internal-secret') ||
      req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ||
      '';
    const bodySecret = rawBody && typeof (rawBody as Record<string, unknown>).secret === 'string'
      ? String((rawBody as Record<string, unknown>).secret)
      : '';
    const providedSecret = headerSecret || bodySecret;
    if (providedSecret !== config.app.internalSecret) {
      logError('process-payment: unauthorized', new Error('Invalid secret'), { callId, prospectId });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!headerSecret) {
      logWarn('process-payment: missing x-internal-secret header, using legacy body secret', { callId, prospectId });
    }

    const parsed = ProcessPaymentPayloadSchema.safeParse(rawBody);

    if (!parsed.success) {
      logError('process-payment: invalid payload', new Error(parsed.error.message));
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const body = parsed.data;
    callId = body.call_id || body.retell_call_id || `email-only-${Date.now()}`;
    prospectId = body.prospect_id || 'unknown';
    const hasDbContext = Boolean(body.call_id && body.prospect_id);

    const { email } = body;
    const { plan_tier, plan_label } = body;
    logInfo('process-payment: email payload prepared', {
      callId,
      prospectId,
      email: maskEmail(email),
      plan_tier,
      prospect_name: body.prospect_name || null,
      company_name: body.company_name || null,
    });

    let prospectRow: { contact_name: string | null; company_name: string | null; metadata: unknown } | null = null;
    if (hasDbContext) {
      const { data, error: prospectLookupError } = await supabase
        .from('prospects')
        .select('contact_name, company_name, metadata')
        .eq('id', prospectId)
        .maybeSingle();
      prospectRow = data;

      if (prospectLookupError) {
        logError('process-payment: failed to fetch prospect profile', prospectLookupError, { callId, prospectId });
      }
    }

    const prospectName =
      body.prospect_name ||
      prospectRow?.contact_name ||
      (email.includes('@') ? email.split('@')[0] : 'there');
    const companyName = body.company_name || prospectRow?.company_name || 'your property';

    const selectedPlanTier: 'one_incident' | 'two_incident' = plan_tier === 'two_incident' ? 'two_incident' : 'one_incident';
    const amountCents = selectedPlanTier === 'two_incident' ? 110000 : 65000;
    const paymentLink = selectedPlanTier === 'two_incident' ? config.stripe.link1100 : config.stripe.link650;
    const resolvedPlanLabel =
      plan_label ||
      (selectedPlanTier === 'two_incident'
        ? 'Annual Biohazard Response - 2 Incident Coverage'
        : 'Annual Biohazard Response - 1 Incident Coverage');
    logInfo('process-payment: payment link selected', {
      callId,
      prospectId,
      plan_tier: selectedPlanTier,
      paymentLink,
    });

    // ---- IDEMPOTENCY CHECK ----
    // If the same call was already processed, skip. If partially processed, resume safely.
    let existingPayment: { id: string; stripe_session_id: string | null; email_sent: boolean } | null = null;
    if (hasDbContext) {
      const { data, error: existingPaymentError } = await supabase
        .from('payments')
        .select('id, stripe_session_id, email_sent')
        .eq('call_id', callId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      existingPayment = data;

      if (existingPaymentError) {
        logError('process-payment: failed to fetch existing payment', existingPaymentError, {
          callId,
          prospectId,
        });
      }

      if (existingPayment?.email_sent) {
        logInfo('process-payment: skipping — already processed', { callId, prospectId });
        return NextResponse.json({ ok: true, skipped: true });
      }
    }

    const resendDisabled = config.resend.fromEmail.toLowerCase().endsWith('@example.com');
    let emailSent = false;

    // ---- STEP 1: Send Stripe payment link email via Resend (optional) ----
    if (resendDisabled) {
      logInfo('process-payment: Resend disabled, skipping email send', {
        callId,
        prospectId,
        paymentLink,
      });
    } else {
      try {
        const emailResult = await sendEmail({
          to: email,
          subject: "Your Biohazard Response Plan — God Crew",
          html: buildPaymentEmailHtml({
            checkoutUrl: paymentLink,
            prospectName,
            companyName,
            planLabel: resolvedPlanLabel,
            amountCents,
            phoneNumber: config.resend.businessPhone,
            websiteUrl: config.resend.businessWebsite,
          }),
        });
        logInfo('process-payment: resend response received', {
          callId,
          prospectId,
          resendMessageId: emailResult.data?.id || null,
          resendError: emailResult.error ? true : false,
        });

        if (emailResult.error) {
          logError('process-payment: Resend email send failed', new Error(JSON.stringify(emailResult.error)), {
            callId,
            prospectId,
          });
        } else {
          emailSent = true;
          logInfo('process-payment: email sent', {
            callId,
            prospectId,
            resendMessageId: emailResult.data?.id,
          });
        }
      } catch (sendErr) {
        logError('process-payment: Resend threw while sending', sendErr, { callId, prospectId });
      }
    }

    // ---- STEP 2: Persist payment record ----
    // Update existing call-linked payment row when present, otherwise create one.
    if (hasDbContext) {
      const paymentPayload = {
        call_id: callId,
        prospect_id: prospectId,
        stripe_session_id: null,
        amount_cents: amountCents,
        status: 'pending',
        email_sent: emailSent,
        email_sent_at: emailSent ? new Date().toISOString() : null,
      };

      let paymentError: unknown = null;
      if (existingPayment?.id) {
        const { error: updateError } = await supabase
          .from('payments')
          .update(paymentPayload)
          .eq('id', existingPayment.id);
        paymentError = updateError;
      } else {
        const { error: insertError } = await supabase.from('payments').insert(paymentPayload);
        paymentError = insertError;
      }

      if (paymentError) {
        logError('process-payment: payment persist failed', paymentError, { callId, prospectId });
      }

      // ---- STEP 3: Update prospect status ----
      const { error: prospectError } = await supabase
        .from('prospects')
        .update({ status: 'interested', email, updated_at: new Date().toISOString() })
        .eq('id', prospectId);

      if (prospectError) {
        logError('process-payment: prospect update failed', prospectError, { callId, prospectId });
      }

      await updateProspectEmailTracking({
        prospectId,
        email,
        metadata: (prospectRow?.metadata as Record<string, unknown>) || {},
        paymentLink,
        emailSent,
      });

      logInfo('process-payment: completed successfully', { callId, prospectId, paymentLink });
      return NextResponse.json({ ok: true });
    }

    logInfo('process-payment: completed in email-only mode', { callId, paymentLink });
    return NextResponse.json({ ok: true, email_only: true });
  } catch (err) {
    logError('process-payment: unhandled error (dead-letter cron will retry)', err, { callId, prospectId });
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

function buildPaymentEmailHtml({
  checkoutUrl,
  prospectName,
  companyName,
  planLabel,
  amountCents,
  phoneNumber,
  websiteUrl,
}: {
  checkoutUrl: string;
  prospectName: string;
  companyName: string;
  planLabel: string;
  amountCents: number;
  phoneNumber: string;
  websiteUrl: string;
}): string {
  const amountText = amountCents >= 110000 ? '$1,100/year' : '$650/year';

  return `
    <div style="background:#0a0a0a;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#e9f6ff;">
      <div style="max-width:620px;margin:0 auto;background:#111827;border:1px solid rgba(255,255,255,0.1);border-radius:14px;overflow:hidden;">
        <div style="padding:26px 24px;border-bottom:1px solid rgba(255,255,255,0.08);">
          <h1 style="margin:0;font-size:22px;line-height:1.3;color:#ffffff;">Your Biohazard Response Plan — God Crew</h1>
          <p style="margin:12px 0 0;font-size:14px;color:#b6c6d8;">Hi ${escapeHtml(prospectName)},</p>
          <p style="margin:8px 0 0;font-size:14px;line-height:1.6;color:#d6e5f2;">
            Great speaking with you just now. As discussed, here are the details for your annual biohazard response coverage.
          </p>
        </div>

        <div style="padding:20px 24px;">
          <h2 style="margin:0 0 8px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#7fc8ff;">Your Plan</h2>
          <div style="padding:14px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);">
            <p style="margin:0 0 8px;font-size:14px;"><strong>Plan:</strong> ${escapeHtml(planLabel)}</p>
            <p style="margin:0 0 8px;font-size:14px;"><strong>Price:</strong> ${amountText}</p>
            <p style="margin:0 0 8px;font-size:14px;"><strong>Response Time:</strong> 4 hours or less, guaranteed</p>
            <p style="margin:0;font-size:14px;"><strong>Property:</strong> ${escapeHtml(companyName)}</p>
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
          <a href="${checkoutUrl}" style="display:inline-block;background:linear-gradient(90deg,#38B6FF,#0066CC);color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 26px;border-radius:10px;">
            Complete Your Enrollment →
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
            ${checkoutUrl}
          </p>
        </div>
      </div>
    </div>
  `;
}

async function updateProspectEmailTracking({
  prospectId,
  email,
  metadata,
  paymentLink,
  emailSent,
}: {
  prospectId: string;
  email: string;
  metadata: Record<string, unknown>;
  paymentLink: string;
  emailSent: boolean;
}): Promise<void> {
  const sentAt = new Date().toISOString();
  const metadataUpdate = {
    ...metadata,
    payment_link_url: paymentLink,
    payment_link_logged_at: sentAt,
    payment_email_sent: emailSent,
  };

  const primaryUpdate = await supabase
    .from('prospects')
    .update({
      email,
      email_sent: emailSent,
      email_sent_at: emailSent ? sentAt : null,
      updated_at: sentAt,
    } as unknown as Record<string, unknown>)
    .eq('id', prospectId);

  if (!primaryUpdate.error) return;

  await supabase
    .from('prospects')
    .update({
      email,
      metadata: metadataUpdate,
      updated_at: sentAt,
    })
    .eq('id', prospectId);
}

function escapeHtml(value: string): string {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function maskEmail(value: string): string {
  if (!value) return '';
  const parts = value.split('@');
  if (parts.length !== 2) return value;
  const [user, domain] = parts;
  if (user.length <= 2) return `**@${domain}`;
  return `${user.slice(0, 2)}***@${domain}`;
}
