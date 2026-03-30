import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { supabase } from '@/lib/supabase';
import { ResendWebhookSchema } from '@/types';
import type { ResendWebhookPayload } from '@/types';
import { logInfo, logWarn, logError } from '@/lib/logger';
import { config } from '@/lib/config';

export const maxDuration = 60;

/**
 * POST /api/resend/webhook
 *
 * Handles Resend email events:
 * - email.delivered / email.opened / email.clicked: stores engagement metadata
 * - email.bounced: marks bounced email + schedules callback to recollect email
 * - email.delivery_delayed: warning-only event
 *
 * Always returns 200 to prevent retry storms.
 */
export async function POST(req: NextRequest) {
  try {
    const incoming = req.headers.get("x-webhook-secret");
    const expected = config.resend.webhookSecret;
    if (expected && incoming !== expected) {
      logWarn("Resend webhook: invalid secret");
      return NextResponse.json({ ok: true });
    }

    const rawBody: unknown = await req.json();
    const parsed = ResendWebhookSchema.safeParse(rawBody);

    if (!parsed.success) {
      logWarn('Resend webhook: invalid payload', { validationError: parsed.error.message });
      return NextResponse.json({ ok: true });
    }

    waitUntil(
      processResendEvent(parsed.data).catch((err) => {
        logError('Resend webhook: background processing failed', err);
      })
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    logError('Resend webhook: unhandled error', err);
    return NextResponse.json({ ok: true });
  }
}

async function processResendEvent(body: ResendWebhookPayload): Promise<void> {
  const eventType = body.type;
  const email = body.data?.to?.[0] || body.data?.email || null;
  const eventAt = body.data?.created_at || new Date().toISOString();

  if (!email) {
    logWarn('Resend webhook: missing email in payload', { eventType });
    return;
  }

  const { data: prospects, error: fetchError } = await supabase
    .from('prospects')
    .select('id, status, metadata')
    .eq('email', email);

  if (fetchError) {
    logError('Resend webhook: failed to fetch prospects by email', fetchError, { eventType });
    return;
  }

  if (!prospects || prospects.length === 0) {
    logInfo('Resend webhook: no prospect found for email event', {
      eventType,
      email: email.replace(/(.{2}).*(@.*)/, '$1***$2'),
    });
    return;
  }

  if (eventType === 'email.delivered' || eventType === 'email.opened' || eventType === 'email.clicked') {
    for (const prospect of prospects) {
      const currentMetadata = (prospect.metadata as Record<string, unknown>) || {};
      const metadataPatch: Record<string, unknown> = { ...currentMetadata };

      if (eventType === 'email.delivered') {
        metadataPatch.payment_email_delivered = true;
        metadataPatch.payment_email_delivered_at = eventAt;
      } else if (eventType === 'email.opened') {
        metadataPatch.payment_email_opened = true;
        metadataPatch.payment_email_opened_at = eventAt;
        metadataPatch.payment_email_open_count = Number(body.data?.open_count || 1);
      } else {
        metadataPatch.payment_email_clicked = true;
        metadataPatch.payment_email_clicked_at = eventAt;
        metadataPatch.payment_email_click_count = Number(body.data?.click_count || 1);
      }

      const { error: updateError } = await supabase
        .from('prospects')
        .update({
          metadata: metadataPatch,
          updated_at: new Date().toISOString(),
        })
        .eq('id', prospect.id);

      if (updateError) {
        logError('Resend webhook: failed to update prospect email engagement metadata', updateError, {
          eventType,
          prospectId: prospect.id,
        });
      }
    }
  }

  if (eventType === 'email.bounced') {
    logWarn('Resend webhook: email bounced', {
      email: email.replace(/(.{2}).*(@.*)/, '$1***$2'),
    });

    for (const prospect of prospects) {
      const currentMetadata = (prospect.metadata as Record<string, unknown>) || {};
      const nowIso = new Date().toISOString();

      const { error: updateError } = await supabase
        .from('prospects')
        .update({
          status: prospect.status === 'closed' || prospect.status === 'do_not_call' ? prospect.status : 'followup',
          metadata: {
            ...currentMetadata,
            email_bounced: true,
            email_bounced_at: nowIso,
          },
          updated_at: nowIso,
        })
        .eq('id', prospect.id);

      if (updateError) {
        logError('Resend webhook: failed updating bounced prospect metadata', updateError, {
          prospectId: prospect.id,
        });
        continue;
      }

      if (prospect.status !== 'closed' && prospect.status !== 'do_not_call') {
        const { data: existingFollowup } = await supabase
          .from('followups')
          .select('id')
          .eq('prospect_id', prospect.id)
          .eq('status', 'pending')
          .ilike('reason', '%email bounce%')
          .limit(1)
          .maybeSingle();

        if (!existingFollowup) {
          const scheduledAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
          const { error: followupError } = await supabase.from('followups').insert({
            prospect_id: prospect.id,
            scheduled_at: scheduledAt,
            reason: 'Email bounce detected - recollect best payment email',
            status: 'pending',
          });

          if (followupError) {
            logError('Resend webhook: failed to schedule bounce followup', followupError, {
              prospectId: prospect.id,
            });
          }
        }
      }
    }

    logInfo('Resend webhook: prospect(s) marked with bounced email', { count: prospects.length });
  }

  if (eventType === 'email.delivery_delayed') {
    logWarn('Resend webhook: email delivery delayed', {
      email: email.replace(/(.{2}).*(@.*)/, '$1***$2'),
    });
  }
}
