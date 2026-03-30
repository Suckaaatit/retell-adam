import crypto from 'crypto';
import { waitUntil } from '@vercel/functions';
import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { logError, logInfo, logWarn } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

export const maxDuration = 60;

/**
 * POST /api/elevenlabs/webhook
 *
 * ElevenLabs post-call webhook. Receives two SEPARATE event types:
 *   - post_call_transcription: transcript, analysis, metadata
 *   - post_call_audio: recording URL
 *
 * Auth: HMAC-SHA256 with timestamp replay protection (±5 min).
 * ALWAYS returns 200 to prevent ElevenLabs from auto-disabling the webhook.
 */
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('elevenlabs-signature');
    const timestamp = req.headers.get('elevenlabs-timestamp');

    if (!verifySignature(rawBody, signature, timestamp, config.elevenlabs.webhookSecret)) {
      logWarn('ElevenLabs webhook: invalid signature');
      return NextResponse.json({ ok: true });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      logWarn('ElevenLabs webhook: invalid JSON');
      return NextResponse.json({ ok: true });
    }

    const payload = parsed as Record<string, unknown>;
    const eventType = String(payload.type || '');

    waitUntil(
      processWebhook(eventType, payload).catch((err) => {
        logError('ElevenLabs webhook: background processing failed', err, { eventType });
      })
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    logError('ElevenLabs webhook: unhandled error', err);
    return NextResponse.json({ ok: true });
  }
}

function verifySignature(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
  secret: string
): boolean {
  if (!signature || !timestamp || !secret) return false;

  // Replay protection: reject if timestamp older than 5 minutes
  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > 300) {
    logWarn('ElevenLabs webhook: stale timestamp', { diff: Math.abs(now - ts) });
    return false;
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  const expectedBuf = Buffer.from(expected, 'hex');
  const receivedBuf = Buffer.from(signature, 'hex');

  if (expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

async function processWebhook(eventType: string, payload: Record<string, unknown>): Promise<void> {
  switch (eventType) {
    case 'post_call_transcription':
      await handlePostCallTranscription(payload);
      return;
    case 'post_call_audio':
      await handlePostCallAudio(payload);
      return;
    default:
      logInfo('ElevenLabs webhook: unhandled event type', { eventType });
  }
}

async function handlePostCallTranscription(payload: Record<string, unknown>): Promise<void> {
  const data = payload.data as Record<string, unknown> | undefined;
  if (!data) {
    logWarn('ElevenLabs webhook transcription: missing data');
    return;
  }

  const conversationId = String(data.conversation_id || '');
  if (!conversationId) {
    logWarn('ElevenLabs webhook transcription: missing conversation_id');
    return;
  }

  const eventTimestamp = typeof payload.event_timestamp === 'number' ? payload.event_timestamp : null;
  const metadata = data.metadata as Record<string, unknown> | undefined;
  const analysis = data.analysis as Record<string, unknown> | undefined;
  const transcript = data.transcript as Array<Record<string, unknown>> | undefined;
  const clientData = data.conversation_initiation_client_data as Record<string, unknown> | undefined;
  const dynamicVars = clientData?.dynamic_variables as Record<string, unknown> | undefined;

  const durationSeconds = typeof metadata?.call_duration_secs === 'number' ? metadata.call_duration_secs : null;
  const callSuccessful = typeof analysis?.call_successful === 'boolean' ? analysis.call_successful : null;
  const summary = typeof analysis?.transcript_summary === 'string' ? analysis.transcript_summary : null;

  // Map transcript to standard format
  const transcriptObject = Array.isArray(transcript)
    ? transcript.map((turn) => ({
        role: String(turn.role || 'agent'),
        content: String(turn.message || ''),
      }))
    : [];

  const outcome = callSuccessful === true ? 'connected' : callSuccessful === false ? 'contacted' : 'connected';
  const startedAt = eventTimestamp
    ? new Date((eventTimestamp - (durationSeconds || 0)) * 1000).toISOString()
    : null;
  const endedAt = eventTimestamp ? new Date(eventTimestamp * 1000).toISOString() : new Date().toISOString();

  // Look up existing call record (created at dial time)
  const { data: existingCall } = await supabase
    .from('calls')
    .select('id, prospect_id')
    .eq('retell_call_id', conversationId)
    .maybeSingle();

  const prospectId = existingCall?.prospect_id || null;

  const upsertPayload: Record<string, unknown> = {
    retell_call_id: conversationId,
    transcript: transcriptObject,
    summary,
    duration_seconds: durationSeconds,
    ended_at: endedAt,
    outcome,
  };
  if (startedAt && !existingCall) upsertPayload.started_at = startedAt;
  if (prospectId) upsertPayload.prospect_id = prospectId;

  const { error: upsertError } = await supabase
    .from('calls')
    .upsert(upsertPayload, { onConflict: 'retell_call_id' });

  if (upsertError) {
    logError('ElevenLabs webhook transcription: call upsert failed', upsertError, { conversationId });
  }

  // Update prospect status
  if (prospectId) {
    const nextStatus = outcome === 'connected' ? 'contacted' : 'contacted';
    await supabase
      .from('prospects')
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq('id', prospectId);
  }

  logInfo('ElevenLabs webhook transcription processed', {
    conversationId,
    prospectId,
    outcome,
    durationSeconds,
  });
}

async function handlePostCallAudio(payload: Record<string, unknown>): Promise<void> {
  const data = payload.data as Record<string, unknown> | undefined;
  if (!data) {
    logWarn('ElevenLabs webhook audio: missing data');
    return;
  }

  const conversationId = String(data.conversation_id || '');
  const recordingUrl = String(data.recording_url || '');

  if (!conversationId || !recordingUrl) {
    logWarn('ElevenLabs webhook audio: missing conversation_id or recording_url');
    return;
  }

  const { error } = await supabase
    .from('calls')
    .update({ recording_url: recordingUrl })
    .eq('retell_call_id', conversationId);

  if (error) {
    logError('ElevenLabs webhook audio: recording update failed', error, { conversationId });
  } else {
    logInfo('ElevenLabs webhook audio: recording URL stored', { conversationId });
  }
}
