import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { supabase } from '@/lib/supabase';
import { config } from '@/lib/config';
import { logInfo, logWarn, logError } from '@/lib/logger';

export const maxDuration = 60;

/**
 * POST /api/stripe/webhook
 *
 * 1. Verifies signature using RAW request body
 * 2. Deduplicates by stripe_events.event_id
 * 3. Processes checkout.session.completed
 *
 * Returns 400 for signature problems. Returns 200 for all internal processing errors
 * to avoid webhook retry storms.
 */
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('stripe-signature');

    if (!signature) {
      logWarn('Stripe webhook: missing signature header');
      return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, config.stripe.webhookSecret);
    } catch (signatureError) {
      logError('Stripe webhook: signature verification failed', signatureError);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    const result = await processStripeEvent(event);
    return NextResponse.json({ ok: true, duplicate: result.duplicate });
  } catch (err) {
    logError('Stripe webhook: unhandled error', err);
    return NextResponse.json({ ok: true });
  }
}

async function processStripeEvent(event: Stripe.Event): Promise<{ duplicate: boolean }> {
  try {
    // Record event BEFORE processing. ignoreDuplicates handles parallel webhook deliveries safely.
    const { data: dedupInsertData, error: dedupInsertError } = await supabase
      .from('stripe_events')
      .upsert(
        {
          event_id: event.id,
          event_type: event.type,
          processed_at: new Date().toISOString(),
        },
        { onConflict: 'event_id', ignoreDuplicates: true }
      )
      .select('id')
      .maybeSingle();

    if (dedupInsertError) {
      logError('Stripe webhook: failed to record dedup event', dedupInsertError, {
        stripeEventId: event.id,
        eventType: event.type,
      });
      return { duplicate: false };
    }

    if (!dedupInsertData) {
      logInfo('Stripe webhook: duplicate event skipped', {
        stripeEventId: event.id,
        eventType: event.type,
      });
      return { duplicate: true };
    }

    logInfo('Stripe webhook: processing event', {
      stripeEventId: event.id,
      eventType: event.type,
    });

    if (event.type !== 'checkout.session.completed') {
      logInfo('Stripe webhook: event ignored', {
        stripeEventId: event.id,
        eventType: event.type,
      });
      return { duplicate: false };
    }

    const session = event.data.object as Stripe.Checkout.Session;

    let callId = session.metadata?.call_id ?? null;
    let prospectId = session.metadata?.prospect_id ?? null;
    const customerEmail = session.customer_details?.email ?? session.customer_email ?? null;

    // Fallback: match by email if metadata is missing (Payment Links)
    if (!prospectId && customerEmail) {
      const { data: prospect } = await supabase
        .from('prospects')
        .select('id')
        .eq('email', customerEmail)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      prospectId = prospect?.id ?? null;
    }

    // Fallback: get call_id from most recent payment for this prospect
    if (!callId && prospectId) {
      const { data: paymentRow } = await supabase
        .from('payments')
        .select('call_id')
        .eq('prospect_id', prospectId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      callId = paymentRow?.call_id ?? null;
    }

    const { error: paymentError } = await supabase.from('payments').upsert(
      {
        stripe_session_id: session.id,
        call_id: callId,
        prospect_id: prospectId,
        amount_cents: session.amount_total || 0,
        status: 'paid',
        paid_at: new Date().toISOString(),
        email_sent: true,
      },
      { onConflict: 'stripe_session_id' }
    );

    if (paymentError) {
      logError('Stripe webhook: payment upsert failed', paymentError, {
        stripeEventId: event.id,
        stripeSessionId: session.id,
        callId: callId ?? undefined,
        prospectId: prospectId ?? undefined,
      });
    }

    if (prospectId) {
      const { error: prospectError } = await supabase
        .from('prospects')
        .update({ status: 'closed', updated_at: new Date().toISOString() })
        .eq('id', prospectId);

      if (prospectError) {
        logError('Stripe webhook: prospect update failed', prospectError, {
          stripeEventId: event.id,
          prospectId,
        });
      }
    }

    if (callId) {
      const { error: callError } = await supabase
        .from('calls')
        .update({ outcome: 'closed' })
        .eq('id', callId);

      if (callError) {
        logError('Stripe webhook: call update failed', callError, {
          stripeEventId: event.id,
          callId,
        });
      }
    }

    logInfo('Stripe webhook: processing complete', {
      stripeEventId: event.id,
      eventType: event.type,
      stripeSessionId: session.id,
      callId: callId ?? undefined,
      prospectId: prospectId ?? undefined,
    });
    return { duplicate: false };
  } catch (err) {
    logError('Stripe webhook: event processing failed', err, {
      stripeEventId: event.id,
      eventType: event.type,
    });
    return { duplicate: false };
  }
}
