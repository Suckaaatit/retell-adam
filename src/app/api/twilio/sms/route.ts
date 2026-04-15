import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { config } from '@/lib/config';
import { sendEmail } from '@/lib/mailer';
import { logInfo, logError, logWarn } from '@/lib/logger';

const EMAIL_REGEX = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/**
 * POST /api/twilio/sms
 *
 * Twilio SMS webhook — fires when someone texts your Twilio number.
 * If the text contains an email address:
 *   1. Finds the prospect by phone number
 *   2. Updates their email
 *   3. Sends the payment link email automatically
 *   4. Replies via SMS confirming the email was sent
 *
 * Configure in Twilio Console → Phone Numbers → your number → Messaging webhook URL
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const from = String(formData.get('From') || '').trim();
    const body = String(formData.get('Body') || '').trim();

    logInfo('SMS webhook: incoming text', { from, body });

    if (!from || !body) {
      return twimlResponse('Thanks for your message!');
    }

    // Extract email from the text message
    const emailMatch = body.match(EMAIL_REGEX);

    if (!emailMatch) {
      logInfo('SMS webhook: no email found in message', { from, body });
      return twimlResponse("Got your message! If you meant to send your email address, just text it and we'll send the details right over.");
    }

    const email = emailMatch[0].toLowerCase().trim();
    logInfo('SMS webhook: email extracted', { from, email });

    // Find prospect by phone number
    const { data: prospect } = await supabase
      .from('prospects')
      .select('id, contact_name, company_name, status')
      .eq('phone', from)
      .limit(1)
      .maybeSingle();

    if (!prospect) {
      // Try without +1 prefix or with it
      const altPhone = from.startsWith('+1') ? from.slice(2) : `+1${from}`;
      const { data: altProspect } = await supabase
        .from('prospects')
        .select('id, contact_name, company_name, status')
        .eq('phone', altPhone)
        .limit(1)
        .maybeSingle();

      if (!altProspect) {
        logWarn('SMS webhook: no prospect found for phone', { from });
        return twimlResponse(`Got it! We'll send the details to ${email} shortly.`);
      }
    }

    const prospectId = prospect?.id || '';
    const prospectName = prospect?.contact_name || email.split('@')[0] || 'there';
    const companyName = prospect?.company_name || 'your property';

    // Update prospect email
    if (prospectId) {
      await supabase
        .from('prospects')
        .update({ email, updated_at: new Date().toISOString() })
        .eq('id', prospectId);
    }

    // Send payment email
    const paymentLink = config.stripe.link650;
    const planLabel = 'Annual Biohazard Response — 1 Incident Coverage';
    const amountCents = 65000;

    try {
      await sendEmail({
        to: email,
        subject: "Your Biohazard Response Plan — God Crew",
        html: buildPaymentEmailHtml({
          checkoutUrl: paymentLink,
          prospectName,
          companyName,
          planLabel,
          amountCents,
          phoneNumber: config.resend.businessPhone,
          websiteUrl: config.resend.businessWebsite,
        }),
      });

      logInfo('SMS webhook: payment email sent', { from, email, prospectId });

      // Create payment record
      if (prospectId) {
        const { data: callRow } = await supabase
          .from('calls')
          .select('id')
          .eq('prospect_id', prospectId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (callRow?.id) {
          await supabase.from('payments').insert({
            call_id: callRow.id,
            prospect_id: prospectId,
            amount_cents: amountCents,
            status: 'pending',
            email_sent: true,
            email_sent_at: new Date().toISOString(),
          });
        }
      }

      return twimlResponse(`Got it! We just sent the details to ${email}. Check your inbox!`);
    } catch (err) {
      logError('SMS webhook: email send failed', err, { from, email });
      return twimlResponse(`Got your email (${email}). We're having a small issue sending it right now — our team will follow up shortly.`);
    }
  } catch (err) {
    logError('SMS webhook: unhandled error', err);
    return twimlResponse('Thanks for your message!');
  }
}

function twimlResponse(message: string) {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`;
  return new NextResponse(twiml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}

function escapeXml(str: string) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
    <h1 style="color:#fff;font-size:22px;margin:0 0 8px;">God Crew</h1>
    <p style="color:#888;font-size:14px;margin:0;">Biohazard Response Plan</p>
  </td></tr>
  <tr><td style="padding:0 32px 24px;">
    <p style="color:#ccc;font-size:15px;line-height:1.6;">
      Hi ${escapeHtml(opts.prospectName)},<br/><br/>
      Thank you for speaking with us about protecting <strong>${escapeHtml(opts.companyName)}</strong>.
      Here is your biohazard response plan:
    </p>
    <table width="100%" style="background:#1a1a1a;border-radius:8px;margin:20px 0;padding:16px;" cellpadding="8">
      <tr><td style="color:#888;font-size:13px;">Plan</td><td style="color:#fff;font-size:13px;">${escapeHtml(opts.planLabel)}</td></tr>
      <tr><td style="color:#888;font-size:13px;">Price</td><td style="color:#0f0;font-size:15px;font-weight:bold;">${price}/year</td></tr>
      <tr><td style="color:#888;font-size:13px;">Response</td><td style="color:#fff;font-size:13px;">4-hour on-site guarantee</td></tr>
    </table>
    <div style="text-align:center;margin:24px 0;">
      <a href="${escapeHtml(opts.checkoutUrl)}" style="background:#00e676;color:#000;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px;display:inline-block;">
        Get Started Now
      </a>
    </div>
    <p style="color:#666;font-size:12px;text-align:center;">
      Or copy this link: ${escapeHtml(opts.checkoutUrl)}
    </p>
  </td></tr>
  <tr><td style="padding:24px 32px;border-top:1px solid #222;text-align:center;">
    <p style="color:#666;font-size:12px;margin:0;">
      If you have any questions, reply to this email at <a href="mailto:hi@godcrew.com" style="color:#4a9eff;">hi@godcrew.com</a><br/>
      Adam — from God Crew
    </p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}
