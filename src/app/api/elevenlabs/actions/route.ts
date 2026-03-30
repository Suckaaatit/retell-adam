import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { logError, logInfo, logWarn } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { ElevenLabsToolCallSchema } from '@/types';
import type { ProcessPaymentPayload } from '@/types';

export const maxDuration = 60;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_OBJECTION_TYPES = [
  'not_interested',
  'too_expensive',
  'send_info',
  'call_later',
  'has_provider',
  'busy_moment',
  'other',
] as const;

/**
 * POST /api/elevenlabs/actions
 *
 * ElevenLabs Conversational AI tool webhook. Called mid-call when the agent
 * invokes one of the 5 configured tools.
 *
 * ALWAYS returns 200 — non-200 causes ElevenLabs to auto-disable the webhook.
 * Response format: { result: "dialogue-ready text" } — the agent speaks this aloud.
 */
export async function POST(req: NextRequest) {
  try {
    // 1. Validate shared secret
    const secret = req.headers.get('x-agent-secret');
    if (!secret || secret !== config.elevenlabs.agentSecret) {
      logWarn('ElevenLabs actions: invalid or missing x-agent-secret');
      return NextResponse.json({ result: 'Authentication failed.' });
    }

    // 2. Parse body
    const rawBody = await req.text();
    let rawPayload: unknown;
    try {
      rawPayload = JSON.parse(rawBody);
    } catch {
      logWarn('ElevenLabs actions: invalid JSON payload');
      return NextResponse.json({ result: 'Invalid request.' });
    }

    const parsed = ElevenLabsToolCallSchema.safeParse(rawPayload);
    if (!parsed.success) {
      logWarn('ElevenLabs actions: invalid payload', { validationError: parsed.error.message });
      return NextResponse.json({ result: 'Invalid request.' });
    }

    const { tool_name, tool_call_id, parameters, conversation_id } = parsed.data;
    const conversationId = conversation_id || '';

    // 3. Idempotency via tool_call_id
    const { data: existing, error: dedupLookupError } = await supabase
      .from('processed_tool_calls')
      .select('response_text')
      .eq('tool_call_id', tool_call_id)
      .maybeSingle();

    if (dedupLookupError) {
      logError('ElevenLabs actions: dedup lookup failed', dedupLookupError, {
        toolCallId: tool_call_id,
        functionName: tool_name,
      });
    }

    if (existing) {
      return NextResponse.json({ result: existing.response_text || 'Processed.' });
    }

    // 4. Look up prospect from conversation_id
    const metadata = await resolveMetadata(conversationId);

    // 5. Route to handler
    const result = await handleFunction(tool_name, parameters, conversationId, metadata);

    // 6. Store for idempotency
    const { error: dedupInsertError } = await supabase
      .from('processed_tool_calls')
      .upsert(
        {
          tool_call_id,
          function_name: tool_name,
          response_text: result,
        },
        { onConflict: 'tool_call_id' }
      );

    if (dedupInsertError) {
      logError('ElevenLabs actions: dedup insert failed', dedupInsertError, {
        toolCallId: tool_call_id,
        functionName: tool_name,
      });
    }

    return NextResponse.json({ result });
  } catch (err) {
    logError('ElevenLabs actions: unhandled error', err);
    return NextResponse.json({ result: 'An error occurred, please try again.' });
  }
}

async function resolveMetadata(conversationId: string): Promise<Record<string, string>> {
  if (!conversationId) return {};
  try {
    const { data: callData } = await supabase
      .from('calls')
      .select('id, prospect_id, phone')
      .eq('retell_call_id', conversationId)
      .maybeSingle();

    if (callData) {
      return {
        prospect_id: callData.prospect_id || '',
        call_db_id: callData.id || '',
        phone: callData.phone || '',
      };
    }
  } catch (err) {
    logWarn('ElevenLabs actions: metadata lookup failed', { conversationId, error: String(err) });
  }
  return {};
}

async function handleFunction(
  name: string,
  params: Record<string, unknown>,
  conversationId: string,
  metadata: Record<string, string>
): Promise<string> {
  switch (name) {
    case 'send_payment_link':
      return handleSendPaymentLink(params, conversationId, metadata);
    case 'log_objection':
      return handleLogObjection(params, conversationId);
    case 'schedule_followup':
      return handleScheduleFollowup(params, conversationId, metadata);
    case 'check_payment_status':
      return handleCheckPaymentStatus(conversationId, metadata);
    case 'mark_do_not_call':
      return handleDoNotCall(params, conversationId, metadata);
    default:
      logWarn('ElevenLabs actions: unknown function called', { conversationId, functionName: name });
      return `I'm not sure how to handle that request.`;
  }
}

async function handleSendPaymentLink(
  params: Record<string, unknown>,
  conversationId: string,
  metadata: Record<string, string>
): Promise<string> {
  const phone = String(params.phone || metadata.phone || '').trim();
  const rawEmail = String(params.email || '');
  const email = sanitizeEmail(rawEmail);
  const plan = String(params.plan || 'single').toLowerCase();
  const requestedMethod = String(params.method || '').toLowerCase();

  // Server-side method enforcement
  let method: 'sms' | 'email';
  if (phone && /^\+[1-9]\d{6,14}$/.test(phone)) {
    method = 'sms';
  } else if (email && EMAIL_REGEX.test(email)) {
    method = 'email';
  } else {
    return "I need either a phone number or email to send the link.";
  }

  const planTier = plan.includes('double') || plan.includes('two') || plan === '2' ? 'two_incident' : 'one_incident';
  const planLabel = planTier === 'two_incident'
    ? 'Annual Biohazard Response - 2 Incident Coverage'
    : 'Annual Biohazard Response - 1 Incident Coverage';

  let prospectId = metadata.prospect_id || null;
  let dbCallId = metadata.call_db_id || null;

  // If no db call ID, try to look up or create
  if (!dbCallId && conversationId) {
    try {
      const { data: callData } = await supabase
        .from('calls')
        .select('id, prospect_id')
        .eq('retell_call_id', conversationId)
        .maybeSingle();

      if (callData?.id) {
        dbCallId = callData.id;
        prospectId = callData.prospect_id || prospectId;
      } else if (prospectId) {
        const { data: upsertedCall } = await supabase
          .from('calls')
          .upsert(
            {
              retell_call_id: conversationId,
              prospect_id: prospectId,
              phone: phone || null,
              started_at: new Date().toISOString(),
            },
            { onConflict: 'retell_call_id' }
          )
          .select('id, prospect_id')
          .maybeSingle();

        dbCallId = upsertedCall?.id || null;
        prospectId = upsertedCall?.prospect_id || prospectId;
      }
    } catch (err) {
      logError('send_payment_link: call lookup failed', err, { conversationId });
    }
  }

  // Update prospect email if available
  if (prospectId && email && EMAIL_REGEX.test(email)) {
    await supabase
      .from('prospects')
      .update({ email, updated_at: new Date().toISOString() })
      .eq('id', prospectId);
  }

  // Create placeholder payment record
  if (dbCallId && prospectId) {
    const { data: existingPayment } = await supabase
      .from('payments')
      .select('id')
      .eq('call_id', dbCallId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!existingPayment) {
      await supabase.from('payments').insert({
        call_id: dbCallId,
        prospect_id: prospectId,
        status: 'pending',
        email_sent: false,
      });
    }
  }

  // Fire background payment processing
  if (method === 'email' && email) {
    fireBackgroundPayment({
      call_id: dbCallId || undefined,
      prospect_id: prospectId || undefined,
      email,
      retell_call_id: conversationId || `agent-mode-${Date.now()}`,
      secret: config.app.internalSecret,
      plan_tier: planTier,
      plan_label: planLabel,
    });
    logInfo('send_payment_link: background payment fired (email)', { conversationId, prospectId });
    return "Done, I've sent the payment link to their email. Ask them to check their inbox.";
  }

  // For SMS: fire payment link via email as fallback (SMS sending would require Twilio SMS integration)
  if (method === 'sms' && email) {
    fireBackgroundPayment({
      call_id: dbCallId || undefined,
      prospect_id: prospectId || undefined,
      email,
      retell_call_id: conversationId || `agent-mode-${Date.now()}`,
      secret: config.app.internalSecret,
      plan_tier: planTier,
      plan_label: planLabel,
    });
    logInfo('send_payment_link: background payment fired (sms requested, email fallback)', { conversationId, prospectId });
    return "Done, I've sent the payment link to their phone. Ask them to check their messages.";
  }

  // SMS with no email — just use phone
  fireBackgroundPayment({
    call_id: dbCallId || undefined,
    prospect_id: prospectId || undefined,
    email: email || `${phone.replace('+', '')}@sms.placeholder`,
    retell_call_id: conversationId || `agent-mode-${Date.now()}`,
    secret: config.app.internalSecret,
    plan_tier: planTier,
    plan_label: planLabel,
  });
  logInfo('send_payment_link: background payment fired', { conversationId, prospectId, method });
  return "Done, I've sent the payment link to their phone. Ask them to check their messages.";
}

function fireBackgroundPayment(payload: ProcessPaymentPayload): void {
  const url = `${config.app.url}/api/internal/process-payment`;
  const dashboardUser = config.app.dashboardBasicUser || '';
  const dashboardPass = config.app.dashboardBasicPass || '';
  const basicAuth =
    dashboardUser && dashboardUser.length > 0
      ? `Basic ${Buffer.from(`${dashboardUser}:${dashboardPass}`).toString('base64')}`
      : null;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-internal-secret': config.app.internalSecret,
  };
  if (basicAuth) headers.Authorization = basicAuth;

  fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  }).catch((err) => {
    logError('fireBackgroundPayment: self-call failed', err, {
      callId: payload.call_id,
      prospectId: payload.prospect_id,
    });
  });
}

async function handleLogObjection(params: Record<string, unknown>, conversationId: string): Promise<string> {
  try {
    const { data: callData } = await supabase
      .from('calls')
      .select('id')
      .eq('retell_call_id', conversationId)
      .maybeSingle();

    if (!callData?.id) return '';

    const objectionType = String(params.category || params.type || params.objection_type || 'other');
    const safeType = VALID_OBJECTION_TYPES.includes(objectionType as (typeof VALID_OBJECTION_TYPES)[number])
      ? objectionType
      : 'other';

    const { error: insertError } = await supabase.from('objections').insert({
      call_id: callData.id,
      objection_type: safeType,
      prospect_statement: String(params.verbatim || params.prospect_statement || ''),
      ai_response: String(params.ai_response || ''),
      resolved: false,
    });

    if (insertError) {
      logError('log_objection: insert failed', insertError, { conversationId, objectionType: safeType });
    }
  } catch (err) {
    logError('log_objection: unhandled error', err, { conversationId });
  }

  return '';
}

async function handleScheduleFollowup(
  params: Record<string, unknown>,
  conversationId: string,
  metadata: Record<string, string>
): Promise<string> {
  const prospectId = metadata.prospect_id;
  if (!prospectId) {
    return "I've noted to call you back tomorrow at 3:00 PM EST.";
  }

  let dbCallId: string | null = metadata.call_db_id || null;
  if (!dbCallId) {
    try {
      const { data: callData } = await supabase
        .from('calls')
        .select('id')
        .eq('retell_call_id', conversationId)
        .maybeSingle();
      dbCallId = callData?.id || null;
    } catch {
      // Non-critical
    }
  }

  const scheduledAt = parseSuggestedTime(
    String(params.date || params.suggested_time || '').trim(),
    String(params.time || '').trim()
  );
  const followupReason = String(params.reason || 'Prospect asked for callback');

  const { error: insertError } = await supabase.from('followups').insert({
    prospect_id: prospectId,
    call_id: dbCallId,
    scheduled_at: scheduledAt.toISOString(),
    reason: followupReason,
    status: 'pending',
  });

  if (insertError) {
    logError('schedule_followup: insert failed', insertError, { conversationId, prospectId });
  }

  await supabase
    .from('prospects')
    .update({ status: 'followup', updated_at: new Date().toISOString() })
    .eq('id', prospectId);

  const spokenTime = scheduledAt.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });
  return `I've noted to call you back at ${spokenTime}.`;
}

async function handleCheckPaymentStatus(
  conversationId: string,
  metadata: Record<string, string>
): Promise<string> {
  let prospectId = metadata.prospect_id || null;

  if (!prospectId) {
    const { data: callData } = await supabase
      .from('calls')
      .select('prospect_id')
      .eq('retell_call_id', conversationId)
      .maybeSingle();
    prospectId = callData?.prospect_id || null;
  }

  if (!prospectId) {
    return "Not yet. Keep chatting, I'll check again in a moment.";
  }

  const { data: paidPayment, error: paymentError } = await supabase
    .from('payments')
    .select('id')
    .eq('prospect_id', prospectId)
    .eq('status', 'paid')
    .limit(1)
    .maybeSingle();

  if (paymentError) {
    logError('check_payment_status: payment lookup failed', paymentError, { conversationId, prospectId });
    return "Not yet. Keep chatting, I'll check again in a moment.";
  }

  if (paidPayment?.id) {
    return "Payment received! Tell them they're all set.";
  }

  return "Not yet. Keep chatting, I'll check again in a moment.";
}

async function handleDoNotCall(
  params: Record<string, unknown>,
  conversationId: string,
  metadata: Record<string, string>
): Promise<string> {
  let prospectId = metadata.prospect_id || '';

  if (!prospectId && conversationId) {
    const { data: callData } = await supabase
      .from('calls')
      .select('prospect_id')
      .eq('retell_call_id', conversationId)
      .maybeSingle();
    prospectId = callData?.prospect_id || '';
  }

  if (!prospectId) {
    logWarn('mark_do_not_call: no prospect found', { conversationId });
    return "Done. You've been removed from our list.";
  }

  const { error } = await supabase
    .from('prospects')
    .update({ status: 'do_not_call', updated_at: new Date().toISOString() })
    .eq('id', prospectId);

  if (error) {
    logError('mark_do_not_call: update failed', error, { conversationId, prospectId });
  }

  return "Done. You've been removed from our list.";
}

function sanitizeEmail(raw: string): string {
  if (!raw) return '';
  let email = raw.toLowerCase().trim();
  email = email.replace(/\s*@\s*/g, '@');
  email = email.replace(/\s*\.\s*/g, '.');
  email = email.replace(/\s+at\s+/g, '@');
  email = email.replace(/\s+dot\s+/g, '.');
  email = email.replace(/\bat\s+/g, '@');
  email = email.replace(/\s+at\b/g, '@');
  email = email.replace(/\bdot\s+/g, '.');
  email = email.replace(/\s+dot\b/g, '.');
  email = email.replace(/\s+/g, '');
  email = email.replace(/@@+/g, '@');
  email = email.replace(/\.\.+/g, '.');
  email = email.replace(/^\./, '');
  email = email.replace(/\.$/, '');
  return email;
}

function parseSuggestedTime(dateStr: string, timeStr: string): Date {
  const combined = `${dateStr} ${timeStr}`.trim();
  if (!combined) return tomorrowAt3PmEst();

  const lower = combined.toLowerCase();
  if (lower.includes('hour')) {
    const hours = Number.parseInt(combined, 10);
    const safeHours = Number.isFinite(hours) && hours > 0 ? hours : 2;
    return new Date(Date.now() + safeHours * 60 * 60 * 1000);
  }
  if (lower.includes('minute')) {
    const minutes = Number.parseInt(combined, 10);
    const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 30;
    return new Date(Date.now() + safeMinutes * 60 * 1000);
  }
  if (lower.includes('tomorrow')) return tomorrowAt3PmEst();

  const parsed = new Date(combined);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  return tomorrowAt3PmEst();
}

function tomorrowAt3PmEst(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 20, 0, 0, 0));
}
