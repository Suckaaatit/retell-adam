import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { logInfo, logError } from '@/lib/logger';

/**
 * POST /api/twilio/transcription
 *
 * Twilio Real-Time Transcription webhook. Called by Twilio during an active
 * call with each transcribed phrase from either the client or agent.
 *
 * Twilio sends form-urlencoded data with fields:
 * - TranscriptionEvent: "transcription-started", "transcription-content", "transcription-stopped"
 * - CallSid: the Twilio call SID
 * - Track: "inbound_track" or "outbound_track"
 * - TranscriptionData: JSON string with transcription results
 */
export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const prospectId = searchParams.get('prospect_id') || null;

    const formData = await req.formData();
    const event = String(formData.get('TranscriptionEvent') || '');
    const callSid = String(formData.get('CallSid') || '');
    const track = String(formData.get('Track') || '');

    if (event === 'transcription-content') {
      const rawData = String(formData.get('TranscriptionData') || '{}');
      let transcriptionData: { transcript?: string; confidence?: number };

      try {
        transcriptionData = JSON.parse(rawData);
      } catch {
        transcriptionData = {};
      }

      const text = transcriptionData.transcript || '';
      if (!text.trim()) {
        return NextResponse.json({ ok: true });
      }

      // Determine speaker from track label
      const speaker = track.includes('inbound') ? 'client' : 'agent';

      logInfo('Live transcription', { callSid, speaker, text: text.substring(0, 100) });

      const { error } = await supabase.from('live_transcripts').insert({
        call_sid: callSid,
        prospect_id: prospectId,
        speaker,
        text,
        created_at: new Date().toISOString(),
      });

      if (error) {
        logError('Live transcription: insert failed', error, { callSid });
      }
    } else if (event === 'transcription-started') {
      logInfo('Live transcription started', { callSid, prospectId });
    } else if (event === 'transcription-stopped') {
      logInfo('Live transcription stopped', { callSid, prospectId });

      // Insert end marker
      await supabase.from('live_transcripts').insert({
        call_sid: callSid,
        prospect_id: prospectId,
        speaker: 'system',
        text: '[CALL ENDED]',
        created_at: new Date().toISOString(),
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    logError('Live transcription: unhandled error', err);
    return NextResponse.json({ ok: true });
  }
}
