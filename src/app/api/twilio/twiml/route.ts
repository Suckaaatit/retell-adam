import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { logInfo, logError } from '@/lib/logger';

/**
 * POST /api/twilio/twiml
 *
 * When Twilio connects a call, this endpoint registers the call with
 * ElevenLabs' register-call API, which returns TwiML that bridges
 * the audio directly to the ElevenLabs agent.
 *
 * Flow:
 *   1. Dashboard call-now creates Twilio outbound call pointing here
 *   2. Twilio fetches this TwiML when the prospect answers
 *   3. We call ElevenLabs register-call API to get TwiML
 *   4. Return that TwiML to Twilio — ElevenLabs handles the conversation
 */
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const prospectName = searchParams.get('prospect_name') || '';
  const companyName = searchParams.get('company_name') || '';
  const prospectId = searchParams.get('prospect_id') || '';

  // Get Twilio call details from form body (Twilio sends as form-urlencoded)
  let fromNumber = '';
  let toNumber = '';
  try {
    const formData = await req.formData();
    fromNumber = String(formData.get('From') || '');
    toNumber = String(formData.get('To') || '');
  } catch {
    // May not have form data on initial request
  }

  logInfo('TwiML: registering call with ElevenLabs', { prospectName, companyName, prospectId, fromNumber, toNumber });

  try {
    // Register call with ElevenLabs — returns TwiML
    const registerResponse = await fetch('https://api.elevenlabs.io/v1/convai/twilio/register-call', {
      method: 'POST',
      headers: {
        'xi-api-key': config.elevenlabs.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        agent_id: config.elevenlabs.agentId,
        from_number: fromNumber || '+10000000000',
        to_number: toNumber || '+10000000000',
        direction: 'outbound',
        conversation_initiation_client_data: {
          dynamic_variables: {
            prospect_name: prospectName,
            company_name: companyName,
            prospect_id: prospectId,
          },
        },
      }),
    });

    if (!registerResponse.ok) {
      const errorText = await registerResponse.text();
      logError('TwiML: ElevenLabs register-call failed', new Error(errorText), {
        status: registerResponse.status,
        fromNumber,
        toNumber,
      });
      // Fallback: say error message to caller
      return new NextResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, an application error has occurred. Please try again later.</Say></Response>`,
        { status: 200, headers: { 'Content-Type': 'text/xml' } }
      );
    }

    // ElevenLabs returns TwiML directly — pass it through to Twilio
    const twiml = await registerResponse.text();

    logInfo('TwiML: ElevenLabs returned TwiML', {
      twimlLength: twiml.length,
      twimlPreview: twiml.substring(0, 500),
      fromNumber,
      toNumber,
    });

    return new NextResponse(twiml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (err) {
    logError('TwiML: unhandled error', err);
    return new NextResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, an application error has occurred. Please try again later.</Say></Response>`,
      { status: 200, headers: { 'Content-Type': 'text/xml' } }
    );
  }
}

// Also handle GET in case Twilio is configured to GET the TwiML
export async function GET(req: NextRequest) {
  return POST(req);
}
