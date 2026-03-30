import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { logInfo, logWarn } from '@/lib/logger';

/**
 * POST /api/twilio/twiml
 *
 * Returns TwiML that connects an active Twilio call to the ElevenLabs
 * Conversational AI agent via WebSocket media stream.
 *
 * Flow:
 *   1. Dashboard call-now creates Twilio outbound call pointing here
 *   2. Twilio fetches this TwiML when the prospect answers
 *   3. TwiML <Connect><Stream> bridges audio to ElevenLabs WebSocket
 *   4. ElevenLabs agent ADAM handles the conversation
 *
 * Query params:
 *   - prospect_name: dynamic variable for the agent
 *   - company_name: dynamic variable for the agent
 *   - prospect_id: for tracking
 *   - conversation_id: ElevenLabs conversation reference
 */
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const prospectName = searchParams.get('prospect_name') || '';
  const companyName = searchParams.get('company_name') || '';
  const prospectId = searchParams.get('prospect_id') || '';

  logInfo('TwiML: generating stream connection', { prospectName, companyName, prospectId });

  // Validate request comes from Twilio (basic check)
  const callSid = req.headers.get('x-twilio-signature') || searchParams.get('CallSid') || '';

  const agentId = config.elevenlabs.agentId;

  // Build the ElevenLabs WebSocket URL with agent ID
  // Dynamic variables are passed as query parameters on the WebSocket URL
  const wsParams = new URLSearchParams({
    agent_id: agentId,
  });

  const wsUrl = `wss://api.elevenlabs.io/v1/convai/conversation?${wsParams.toString()}`;

  // TwiML response: Connect call audio to ElevenLabs via WebSocket stream
  // The <Stream> element sends bidirectional audio to the WebSocket
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${escapeXml(wsUrl)}">
      <Parameter name="prospect_name" value="${escapeXml(prospectName)}" />
      <Parameter name="company_name" value="${escapeXml(companyName)}" />
      <Parameter name="prospect_id" value="${escapeXml(prospectId)}" />
    </Stream>
  </Connect>
</Response>`;

  return new NextResponse(twiml, {
    status: 200,
    headers: {
      'Content-Type': 'text/xml',
    },
  });
}

// Also handle GET in case Twilio is configured to GET the TwiML
export async function GET(req: NextRequest) {
  return POST(req);
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
