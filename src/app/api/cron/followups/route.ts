import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { config } from '@/lib/config';
import { logInfo, logWarn, logError } from '@/lib/logger';

export const maxDuration = 60;

/**
 * GET /api/cron/followups
 *
 * Vercel cron job running every 5 minutes. Handles three jobs:
 *
 * JOB 1: Process pending followups — atomically lock + dial via Twilio → ElevenLabs
 * JOB 2: Dead-letter retry for stuck payments (email_sent=false, created > 5min ago)
 * JOB 3: Reset daily phone number counts at midnight UTC
 *
 * All operations use atomic row locking to prevent double-execution
 * from overlapping cron invocations.
 */
export async function GET(req: NextRequest) {
  try {
    // ---- Auth: Verify Vercel cron secret ----
    const authHeader = req.headers.get('authorization');
    const cronSecret = config.app.cronSecret;
    if (config.app.env === 'production' && !cronSecret) {
      logError('Cron followups: CRON_SECRET missing in production', new Error('Missing CRON_SECRET'));
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 });
    }
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      logWarn('Cron followups: unauthorized request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const results = {
      followups_processed: 0,
      followups_skipped: 0,
      followups_reset: 0,
      payments_retried: 0,
      numbers_reset: false,
    };

    // ============================================================
    // JOB 1: Process Pending Followups
    // ============================================================
    try {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data: resetFollowups, error: resetError } = await supabase
        .from('followups')
        .update({ status: 'pending' })
        .eq('status', 'processing')
        .lt('scheduled_at', tenMinutesAgo)
        .select('id');

      if (resetError) {
        logError('Cron: failed to reset stuck followups', resetError);
      } else if (resetFollowups && resetFollowups.length > 0) {
        results.followups_reset = resetFollowups.length;
        logInfo('Cron: reset stuck followups', { count: resetFollowups.length });
      }

      const { data: pendingFollowups } = await supabase
        .from('followups')
        .select('id, prospect_id, call_id')
        .eq('status', 'pending')
        .lte('scheduled_at', new Date().toISOString())
        .limit(10);

      if (pendingFollowups && pendingFollowups.length > 0) {
        logInfo('Cron: processing followups', { count: pendingFollowups.length });

        for (const followup of pendingFollowups) {
          // Atomically mark as processing — prevents double-dial from overlapping crons
          const { data: locked } = await supabase
            .from('followups')
            .update({ status: 'processing' })
            .eq('id', followup.id)
            .eq('status', 'pending')
            .select('id')
            .maybeSingle();

          if (!locked) {
            // Another cron instance grabbed this one
            continue;
          }

          // Check prospect is still callable
          try {
            const { data: prospect } = await supabase
              .from('prospects')
              .select('phone, contact_name, company_name, status')
              .eq('id', followup.prospect_id)
              .maybeSingle();

            if (!prospect || prospect.status === 'do_not_call' || prospect.status === 'closed') {
              await supabase.from('followups').update({ status: 'cancelled' }).eq('id', followup.id);
              results.followups_skipped++;
              continue;
            }

            // Pick outbound number from phone_numbers table
            const { data: fromNumberRow } = await supabase
              .from('phone_numbers')
              .select('id, number, daily_call_count, total_calls')
              .eq('active', true)
              .lt('daily_call_count', 80)
              .order('daily_call_count', { ascending: true })
              .limit(1)
              .maybeSingle();

            const callFromNumber = fromNumberRow?.number || config.twilio.fromNumber || '';
            if (!callFromNumber) {
              logWarn('Cron: no outbound phone number available', { prospectId: followup.prospect_id });
              await supabase.from('followups').update({ status: 'pending' }).eq('id', followup.id);
              continue;
            }

            // Trigger Twilio outbound call → ElevenLabs agent
            const twimlUrl = new URL('/api/twilio/twiml', config.app.url);
            twimlUrl.searchParams.set('prospect_name', prospect.contact_name || '');
            twimlUrl.searchParams.set('company_name', prospect.company_name || '');
            twimlUrl.searchParams.set('prospect_id', followup.prospect_id);

            const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${config.twilio.accountSid}/Calls.json`;
            const twilioAuth = Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString('base64');

            const twilioBody = new URLSearchParams({
              To: prospect.phone,
              From: callFromNumber,
              Url: twimlUrl.toString(),
              Method: 'POST',
            });

            const twilioResponse = await fetch(twilioUrl, {
              method: 'POST',
              headers: {
                Authorization: `Basic ${twilioAuth}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: twilioBody.toString(),
            });

            if (twilioResponse.ok) {
              const callData = (await twilioResponse.json()) as { sid?: string };
              await supabase.from('followups').update({ status: 'completed' }).eq('id', followup.id);
              if (callData?.sid) {
                await supabase.from('calls').upsert(
                  {
                    retell_call_id: callData.sid,
                    prospect_id: followup.prospect_id,
                    phone: prospect.phone,
                    started_at: new Date().toISOString(),
                  },
                  { onConflict: 'retell_call_id' }
                );
              }
              results.followups_processed++;
              logInfo('Cron: followup call initiated', { prospectId: followup.prospect_id });
            } else {
              const errorStatus = twilioResponse.status;
              logError('Cron: Twilio followup call failed', new Error(`HTTP ${errorStatus}`), {
                prospectId: followup.prospect_id,
              });
              // Reset to pending so it gets retried next cron cycle
              await supabase.from('followups').update({ status: 'pending' }).eq('id', followup.id);
            }
          } catch (callErr) {
            logError('Cron: followup processing error', callErr, { prospectId: followup.prospect_id });
            await supabase.from('followups').update({ status: 'pending' }).eq('id', followup.id);
          }
        }
      }
    } catch (followupJobErr) {
      logError('Cron: followup job failed', followupJobErr);
    }

    // ============================================================
    // JOB 2: Dead-Letter Retry for Stuck Payments
    // Catches cases where the self-call to /api/internal/process-payment failed.
    // ============================================================
    try {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: stuckPayments } = await supabase
        .from('payments')
        .select('id, call_id, prospect_id')
        .eq('status', 'pending')
        .eq('email_sent', false)
        .lt('created_at', fiveMinutesAgo)
        .limit(5);

      if (stuckPayments && stuckPayments.length > 0) {
        logInfo('Cron: retrying stuck payments', { count: stuckPayments.length });

        for (const payment of stuckPayments) {
          try {
            // Get prospect email
            const { data: prospect } = await supabase
              .from('prospects')
              .select('email')
              .eq('id', payment.prospect_id)
              .maybeSingle();

            if (!prospect?.email) {
              logWarn('Cron: stuck payment has no prospect email', { paymentId: payment.id });
              continue;
            }

            // Get call's retell_call_id
            const { data: call } = await supabase
              .from('calls')
              .select('retell_call_id')
              .eq('id', payment.call_id)
              .maybeSingle();

            if (!call?.retell_call_id) {
              logWarn('Cron: stuck payment missing call retell_call_id, skipping retry', {
                paymentId: payment.id,
                callId: payment.call_id,
              });
              continue;
            }

            // Re-trigger payment processing via self-call
            const retryResponse = await fetch(`${config.app.url}/api/internal/process-payment`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-internal-secret': config.app.internalSecret,
              },
              body: JSON.stringify({
                call_id: payment.call_id,
                prospect_id: payment.prospect_id,
                email: prospect.email,
                retell_call_id: call.retell_call_id,
                secret: config.app.internalSecret,
              }),
            });

            if (retryResponse.ok) {
              results.payments_retried++;
              logInfo('Cron: stuck payment retry succeeded', { paymentId: payment.id });
            } else {
              logError('Cron: stuck payment retry failed', new Error(`HTTP ${retryResponse.status}`), {
                paymentId: payment.id,
              });
            }
          } catch (retryErr) {
            logError('Cron: dead-letter retry error', retryErr, { paymentId: payment.id });
          }
        }
      }
    } catch (deadLetterJobErr) {
      logError('Cron: dead-letter job failed', deadLetterJobErr);
    }

    // ============================================================
    // JOB 3: Reset Daily Phone Number Counts (at midnight UTC)
    // ============================================================
    try {
      const currentHour = new Date().getUTCHours();
      if (currentHour === 0) {
        const { error: resetError } = await supabase
          .from('phone_numbers')
          .update({ daily_call_count: 0 })
          .gte('daily_call_count', 0);

        if (resetError) {
          logError('Cron: phone number reset failed', resetError);
        } else {
          results.numbers_reset = true;
          logInfo('Cron: daily phone number counts reset');
        }
      }
    } catch (resetJobErr) {
      logError('Cron: reset job failed', resetJobErr);
    }

    logInfo('Cron: cycle completed', { results: JSON.stringify(results) });
    return NextResponse.json({ ok: true, results });
  } catch (err) {
    logError('Cron: unhandled error', err);
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 });
  }
}
