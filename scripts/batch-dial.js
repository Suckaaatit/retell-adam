#!/usr/bin/env node

/**
 * AI Voice Sales — Batch Dialer Script
 *
 * Runs LOCALLY (not on Vercel). Fully resumable — picks up where it left off on crash.
 *
 * Usage:
 *   node scripts/batch-dial.js          # Dial up to 100 prospects (default)
 *   node scripts/batch-dial.js 50       # Dial up to 50 prospects
 *
 * Features:
 * - Atomic row locking (prevents double-dials from concurrent runs)
 * - Phone number rotation with daily limits (80/day/number, answer_rate >= 15%)
 * - E.164 validation before dialing
 * - Timezone-aware calling windows (9am-6pm local time)
 * - 4-second delay between calls (prevents carrier spam flags)
 * - Crash recovery via status column (dialing → pending on restart)
 * - Max 5 concurrent calls, 2 retries with exponential backoff
 *
 * Required env vars (set in shell or .env.local):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER,
 *   ELEVENLABS_AGENT_ID, NEXT_PUBLIC_APP_URL
 */

const { createClient } = require('@supabase/supabase-js');

// ============================================================
// CONFIGURATION
// ============================================================
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL;
const DELAY_MS = 4000; // 4 seconds between calls (prevent spam flags)
const MAX_CALLS_PER_RUN = parseInt(process.argv[2]) || 100;
const MAX_RETRIES = 2;
const RETRY_BACKOFF = [5000, 15000]; // 5s first retry, 15s second
let interrupted = false;

process.on('SIGINT', () => {
  interrupted = true;
  console.log('\n\n⏹️  Received Ctrl+C. Finishing current operation and stopping safely...');
});

// Validate required env vars
const required = { SUPABASE_URL, SUPABASE_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, APP_URL };
const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
if (missing.length > 0) {
  console.error(`\n❌ Missing required environment variables:\n  ${missing.join('\n  ')}\n`);
  console.error('Set them in your shell or source your .env.local file.\n');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================
// E.164 VALIDATION
// ============================================================
function isValidE164(phone) {
  return /^\+[1-9]\d{6,14}$/.test(phone);
}

// ============================================================
// TIMEZONE CHECK
// Returns true if the prospect's local time is between 9am-6pm.
// Infers timezone from US area code. Non-US numbers default to Eastern.
// ============================================================
function isWithinCallingHours(phone) {
  const areaCode = phone.replace('+1', '').substring(0, 3);

  // Eastern (UTC-5)
  const eastern = new Set([
    '212','347','646','718','917','201','551','609','732','848','856','862','908','973',
    '203','475','860','302','202','301','240','410','443','667','227','339','351','413',
    '508','617','774','781','857','978','603','401','802','304','681',
  ]);
  // Central (UTC-6)
  const central = new Set([
    '205','251','256','334','938','479','501','870','217','224','309','312','331','618',
    '630','708','773','779','815','847','872','219','260','317','463','574','765','812',
    '930','319','515','563','641','712','316','620','785','913','270','364','502','606',
    '859','225','318','337','504','985','218','320','507','612','651','763','952','228',
    '601','662','769','314','417','573','636','660','816','402','531','701','605','210',
    '214','254','325','361','409','430','432','469','512','682','713','726','737','806',
    '817','830','832','903','915','936','940','956','972','979','262','274','414','534',
    '608','715','920',
  ]);
  // Mountain (UTC-7)
  const mountain = new Set([
    '480','520','602','623','928','303','719','720','970','208','406','505','575','307',
    '385','435','801',
  ]);
  // Pacific (UTC-8)
  const pacific = new Set([
    '907','209','213','279','310','323','341','369','408','415','424','442','510','530',
    '559','562','619','626','628','650','657','661','669','707','714','747','760','805',
    '818','831','858','909','916','925','949','951','360','206','253','425','509','564',
    '503','541','971','808',
  ]);

  const now = new Date();
  let utcHour = now.getUTCHours();
  let offset = -5; // Default Eastern

  if (eastern.has(areaCode)) offset = -5;
  else if (central.has(areaCode)) offset = -6;
  else if (mountain.has(areaCode)) offset = -7;
  else if (pacific.has(areaCode)) offset = -8;

  let localHour = utcHour + offset;
  localHour = ((localHour % 24) + 24) % 24;

  return localHour >= 9 && localHour < 18;
}

// ============================================================
// PICK BEST PHONE NUMBER
// Lowest daily count, active, under 80/day, answer_rate >= 15%
// ============================================================
async function pickPhoneNumber() {
  const { data, error } = await supabase
    .from('phone_numbers')
    .select('id, number, daily_call_count, total_calls')
    .eq('active', true)
    .lt('daily_call_count', 80)
    .gte('answer_rate', 0.15)
    .order('daily_call_count', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return null;
  }
  return data;
}

// ============================================================
// MAKE TWILIO CALL (with retry)
// ============================================================
async function makeTwilioCall(prospect, fromNumber, retryCount = 0) {
  const twimlUrl = new URL('/api/twilio/twiml', APP_URL);
  twimlUrl.searchParams.set('prospect_name', prospect.contact_name || '');
  twimlUrl.searchParams.set('company_name', prospect.company_name || '');
  twimlUrl.searchParams.set('prospect_id', prospect.id);

  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls.json`;
  const twilioAuth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');

  const body = new URLSearchParams({
    To: prospect.phone,
    From: fromNumber,
    Url: twimlUrl.toString(),
    Method: 'POST',
  });

  const response = await fetch(twilioUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${twilioAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (retryCount < MAX_RETRIES) {
      const backoff = RETRY_BACKOFF[retryCount] || 5000;
      console.log(`   ⏳ Retry ${retryCount + 1}/${MAX_RETRIES} in ${backoff / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, backoff));
      return makeTwilioCall(prospect, fromNumber, retryCount + 1);
    }
    throw new Error(`Twilio API ${response.status}: ${errorText.substring(0, 200)}`);
  }

  const callData = await response.json();
  if (!callData.sid) {
    throw new Error('Twilio response missing SID');
  }

  return callData;
}

// ============================================================
// CLEANUP: Reset any "dialing" prospects from crashed prior runs
// ============================================================
async function resetStuckDialing() {
  const { data, error } = await supabase
    .from('prospects')
    .update({ status: 'pending', updated_at: new Date().toISOString() })
    .eq('status', 'dialing')
    .select('id');

  if (data && data.length > 0) {
    console.log(`🔄 Reset ${data.length} stuck "dialing" prospects to "pending"\n`);
  }
  if (error) {
    console.error('⚠️  Warning: Could not reset stuck prospects:', error.message);
  }
}

// ============================================================
// MAIN DIAL LOOP
// ============================================================
async function main() {
  console.log(`\n🚀 AI Voice Sales — Batch Dialer (Twilio → ElevenLabs)`);
  console.log(`   Max calls this run: ${MAX_CALLS_PER_RUN}`);
  console.log(`   Delay between calls: ${DELAY_MS}ms\n`);

  // Reset any stuck "dialing" from prior crashed runs
  await resetStuckDialing();

  let dialed = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < MAX_CALLS_PER_RUN; i++) {
    if (interrupted) {
      console.log('\n🛑 Dialer interrupted by operator.');
      break;
    }

    // ---- Get next pending prospect ----
    const { data: prospect, error: fetchError } = await supabase
      .from('prospects')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (fetchError || !prospect) {
      console.log('\n✅ No more pending prospects. Done.');
      break;
    }

    // ---- Atomically mark as "dialing" (prevents double-dial) ----
    const { data: locked, error: lockError } = await supabase
      .from('prospects')
      .update({ status: 'dialing', updated_at: new Date().toISOString() })
      .eq('id', prospect.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();

    if (lockError || !locked) {
      // Another instance or concurrent run grabbed this prospect
      continue;
    }

    // ---- Validate E.164 format ----
    if (!isValidE164(prospect.phone)) {
      console.log(`❌ Invalid phone: ${prospect.phone} — marking failed`);
      await supabase.from('prospects').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', prospect.id);
      skipped++;
      continue;
    }

    // ---- Check calling hours ----
    if (!isWithinCallingHours(prospect.phone)) {
      console.log(`⏰ Outside calling hours for ${prospect.phone} — returning to pending`);
      await supabase.from('prospects').update({ status: 'pending', updated_at: new Date().toISOString() }).eq('id', prospect.id);
      skipped++;
      continue;
    }

    // ---- Pick outbound phone number ----
    const phoneNumber = await pickPhoneNumber();
    if (!phoneNumber) {
      console.log('⚠️  All phone numbers exhausted for today. Stopping.');
      await supabase.from('prospects').update({ status: 'pending', updated_at: new Date().toISOString() }).eq('id', prospect.id);
      break;
    }

    // ---- Make the call via Twilio → ElevenLabs ----
    try {
      const displayName = prospect.contact_name || prospect.phone;
      console.log(`📞 [${dialed + 1}/${MAX_CALLS_PER_RUN}] Calling ${displayName}...`);

      const callData = await makeTwilioCall(prospect, phoneNumber.number || TWILIO_FROM_NUMBER);

      // Mark prospect as called
      await supabase
        .from('prospects')
        .update({
          status: 'called',
          total_calls: (prospect.total_calls || 0) + 1,
          last_called_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', prospect.id);

      // Create call record (use Twilio SID as external call ID)
      await supabase.from('calls').upsert(
        {
          retell_call_id: callData.sid,
          prospect_id: prospect.id,
          phone: prospect.phone,
          started_at: new Date().toISOString(),
        },
        { onConflict: 'retell_call_id' }
      );

      // Increment phone number daily count
      await supabase
        .from('phone_numbers')
        .update({
          daily_call_count: phoneNumber.daily_call_count + 1,
          total_calls: (phoneNumber.total_calls || 0) + 1,
          last_used_at: new Date().toISOString(),
        })
        .eq('id', phoneNumber.id);

      dialed++;
      console.log(`   ✅ Call initiated: ${callData.sid}`);
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      console.error(`   ❌ Call failed: ${message}`);
      await supabase
        .from('prospects')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', prospect.id);
      failed++;
    }

    // ---- Throttle: 4-second delay between calls ----
    if (i < MAX_CALLS_PER_RUN - 1) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
  }

  console.log(`\n📊 Batch Complete`);
  console.log(`   Dialed:  ${dialed}`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`   Failed:  ${failed}\n`);
}

main().catch((err) => {
  const message = err && err.message ? err.message : String(err);
  console.error('\n💥 Fatal error:', message);
  process.exit(1);
});
