# AI Outbound Voice Sales System

**Live:** [godscrew.vercel.app](https://godscrew.vercel.app) | **Repo:** [github.com/Suckaaatit/godscrew](https://github.com/Suckaaatit/godscrew)

Production-ready AI agent that calls prospects, delivers a structured sales pitch, handles objections, collects email, sends a Stripe payment link mid-call, stays on the line while they pay, confirms payment, and logs everything to a CRM database — fully automated.

---

## 1. ARCHITECTURE OVERVIEW

The system uses Retell AI as voice orchestrator (Deepgram STT → Groq Llama 3.1 70B → Cartesia TTS) achieving ~170ms end-to-end latency. Next.js API routes on Vercel handle all webhooks and tool calls. Every tool call returns an immediate response to Retell (<500ms) while heavy work (Stripe sessions, email sending) fires via self-call endpoints to separate serverless execution contexts. The dead-letter cron catches any failed background tasks every 5 minutes. Upserts and atomic row locking handle every race condition, retry, and out-of-order webhook.

**Stack:** Next.js App Router → Vercel Pro | Supabase Postgres | Stripe Checkout Sessions | Resend Email | Retell AI Voice | Zod Validation

---

## 2. FILE STRUCTURE

```
ai-voice-sales/
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── payment-success/page.tsx
│   │   ├── payment-cancelled/page.tsx
│   │   └── api/
│   │       ├── retell/
│   │       │   ├── webhook/route.ts         ← Call lifecycle (start/end/analyzed)
│   │       │   ├── actions/route.ts         ← Mid-call tool calls (CRITICAL)
│   │       │   └── create-web-call/route.ts ← Browser call widget
│   │       ├── stripe/
│   │       │   └── webhook/route.ts         ← Payment confirmation
│   │       ├── resend/
│   │       │   └── webhook/route.ts         ← Email bounce handling
│   │       ├── cron/
│   │       │   └── followups/route.ts       ← Scheduled callbacks + dead-letter
│   │       └── internal/
│   │           └── process-payment/route.ts ← Background Stripe + Resend worker
│   ├── lib/
│   │   ├── config.ts                        ← Zod env var validation
│   │   ├── logger.ts                        ← Structured JSON logging
│   │   ├── supabase.ts                      ← Supabase REST client
│   │   ├── stripe.ts                        ← Stripe client
│   │   └── resend.ts                        ← Resend client
│   └── types/
│       └── index.ts                         ← All types + zod schemas
├── scripts/
│   └── batch-dial.js                        ← Local batch dialer
├── schema.sql                               ← Complete DB schema
├── vercel.json                              ← Cron configuration
├── .env.example                             ← Environment variable template
├── package.json
├── tsconfig.json
└── next.config.js
```

---

## 3. INSTALL COMMANDS

```bash
# Clone/create project
git clone <your-repo> ai-voice-sales && cd ai-voice-sales
# OR if starting fresh:
# mkdir ai-voice-sales && cd ai-voice-sales

# Install dependencies
npm install

# Copy env template
cp .env.example .env.local
# Fill in ALL values in .env.local
```

---

## 4. ENVIRONMENT VARIABLES

See `.env.example` for the full list. Every variable is validated at startup via Zod — the app crashes immediately with a clear error if any are missing.

---

## 5. DATABASE SCHEMA

Copy the entire contents of `schema.sql` into the Supabase SQL Editor and run it. Creates 8 tables with all constraints and indexes.

Then insert your phone numbers:
```sql
INSERT INTO phone_numbers (number) VALUES
  ('+14155551001'),
  ('+14155551002'),
  ('+14155551003');
```

---

## 6. DEPLOYMENT STEPS

```bash
# 1. Initialize git
git init
git add .
git commit -m "Initial commit: AI Voice Sales System"

# 2. Install Vercel CLI
npm i -g vercel

# 3. Link to Vercel
vercel link

# 4. Set environment variables in Vercel dashboard
#    Settings → Environment Variables → add ALL from .env.example

# 5. Deploy
vercel --prod

# 6. After deploy, configure external services with your Vercel URL:
#    Retell: Webhook URL = https://your-app.vercel.app/api/retell/webhook
#            Custom Tool Server URL = https://your-app.vercel.app/api/retell/actions
#    Stripe: Webhook URL = https://your-app.vercel.app/api/stripe/webhook
#    Resend: Webhook URL = https://your-app.vercel.app/api/resend/webhook

# 7. Local Stripe testing (before deploy)
stripe listen --forward-to localhost:3000/api/stripe/webhook
# Copy the webhook signing secret to .env.local

# 8. Configure Retell agent (run once after deploy)
#    In Retell Dashboard → Agent → Settings:
#    - Set Webhook URL to https://your-app.vercel.app/api/retell/webhook
#    - Set Custom Tool Server URL to https://your-app.vercel.app/api/retell/actions
```

---

## 7. VERIFICATION COMMANDS

```bash
# Test Retell webhook (simulate end-of-call)
curl -s -X POST https://your-app.vercel.app/api/retell/webhook \
  -H "Content-Type: application/json" \
  -d '{"event":"call_ended","call":{"call_id":"test-call-123","agent_id":"your_agent_id","call_status":"ended"}}' | jq .

# Test Retell actions (simulate tool call)
curl -s -X POST https://your-app.vercel.app/api/retell/actions \
  -H "Content-Type: application/json" \
  -d '{"call":{"call_id":"test-call-123","metadata":{"prospect_id":"00000000-0000-0000-0000-000000000000"}},"name":"confirm_payment","args":{}}' | jq .

# Test cron endpoint
curl -s https://your-app.vercel.app/api/cron/followups | jq .

# Test Stripe webhook (use Stripe CLI)
stripe trigger checkout.session.completed

# Test batch dialer (local, 3 test calls)
source .env.local  # or export vars manually
node scripts/batch-dial.js 3
```

---

## 8. NEXT 3 PROBLEMS + SOLUTIONS

### Problem 1: Retell tool call times out (dead air)
- **Symptom:** Caller hears silence for 5+ seconds after agreeing to pay
- **Root cause:** Background task blocking the tool call response
- **Immediate mitigation:** All tool calls return instantly; heavy work fires via self-call. This is already implemented.
- **Long-term fix:** Monitor `processed_tool_calls` creation timestamps to detect latency spikes. Add Vercel Function timing alerts.

### Problem 2: Stripe webhook arrives before payment record exists
- **Symptom:** Payment record has status "paid" but no `call_id`
- **Root cause:** Stripe fires webhook before `/api/internal/process-payment` finishes
- **Immediate mitigation:** Stripe webhook uses upsert on `stripe_session_id`. Already implemented.
- **Long-term fix:** Dead-letter cron reconciles any orphaned records every 5 minutes.

### Problem 3: Phone numbers get spam-flagged
- **Symptom:** Answer rate drops below 15%, calls go straight to voicemail
- **Root cause:** Carrier spam filtering triggered by volume or complaints
- **Immediate mitigation:** Number pool rotation (15-20 numbers, 50-80/day max). Answer rate tracking auto-retires numbers below 15%.
- **Long-term fix:** Register for A2P 10DLC (branded caller ID). Use STIR/SHAKEN attestation. Rotate numbers monthly.

---

## 9. CEO RUNBOOK (Day 1 Operations)

```bash
# Upload new prospects (CSV with columns: phone, company_name, contact_name)
# Use Supabase Dashboard → Table Editor → prospects → Import CSV

# Start dialing (from your laptop)
node scripts/batch-dial.js 50

# Check results
# Supabase Dashboard → Table Editor → prospects → filter by status

# Stop all calling immediately
# Kill the batch-dial.js process (Ctrl+C)
# Cron followups will NOT call any do_not_call or closed prospects
```

---

## 10. LAUNCH READINESS CHECKLIST

- [ ] ✅ `vercel --prod` = deployed and live
- [ ] ✅ `curl /api/retell/webhook` = returns `{"ok":true}`
- [ ] ✅ `curl /api/cron/followups` = returns `{"ok":true,"results":{...}}`
- [ ] ✅ Stripe test payment = webhook fires, payment record created
- [ ] ✅ Stripe webhook secret configured in Vercel env vars
- [ ] ✅ Resend domain verified (SPF/DKIM/DMARC green)
- [ ] ✅ Retell agent configured with webhook URL + custom tool server URL
- [ ] ✅ Phone numbers inserted into `phone_numbers` table
- [ ] ✅ Error tracking = Vercel logs dashboard active
- [ ] ✅ All webhook endpoints responding (Retell, Stripe, Resend)
- [ ] ✅ Test call from Retell dashboard → your personal phone → data in Supabase

---

## 11. DAY 1 METRICS

| Metric | Conservative | Target | Stretch |
|--------|-------------|--------|---------|
| Calls/day | 100 | 500 | 1,000 |
| Connect rate | 15% | 25% | 35% |
| Close rate (of connects) | 3% | 5% | 8% |
| Revenue/close | $999 | $999 | $999 |
| Daily revenue | $449 | $1,248 | $2,797 |
| Monthly revenue | $13,485 | $37,440 | $83,916 |
| Monthly system cost | ~$100 | ~$240 | ~$350 |

---

## 12. COMPLIANCE REQUIREMENTS

| Requirement | Implementation |
|------------|---------------|
| TCPA consent | Prior express written consent required. Scrub National DNC registry before upload. |
| AI disclosure | System prompt opens every call with AI disclosure. |
| Recording consent | "This call may be recorded" stated at call start. |
| Do Not Call | `mark_do_not_call` function + `do_not_call` status. Batch script respects this. |
| Calling hours | Batch script enforces 9am-6pm local time via area code timezone inference. |

**Non-negotiable. Violations cost $500-$1,500 per call.**
