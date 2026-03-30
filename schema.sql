-- ============================================================
-- AI OUTBOUND VOICE SALES SYSTEM — Complete Database Schema
-- ============================================================
-- Run this ENTIRE file in Supabase SQL Editor (one shot).
-- All tables, constraints, and indexes included.
-- ============================================================

-- ============================================================
-- TABLE 1: prospects
-- Every phone number to be dialed. Status tracks full lifecycle.
-- ============================================================
CREATE TABLE IF NOT EXISTS prospects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(20) NOT NULL,
  email VARCHAR(255),
  company_name VARCHAR(255),
  contact_name VARCHAR(255),
  status VARCHAR(50) DEFAULT 'pending'
    CHECK (status IN ('pending','dialing','called','failed','contacted','interested','closed','rejected','followup','do_not_call','no_answer')),
  source VARCHAR(100),
  total_calls INTEGER DEFAULT 0,
  last_called_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique phone prevents duplicate prospects from CSV imports
ALTER TABLE prospects ADD CONSTRAINT unique_prospect_phone UNIQUE (phone);

-- ============================================================
-- TABLE 2: calls
-- Every call placed, with Retell data attached via webhook.
-- retell_call_id stores the Retell call_id.
-- ============================================================
CREATE TABLE IF NOT EXISTS calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID REFERENCES prospects(id),
  retell_call_id VARCHAR(255) UNIQUE,
  phone VARCHAR(20),
  outcome VARCHAR(50)
    CHECK (outcome IN ('connected','voicemail','no_answer','busy','closed','rejected','followup','error')),
  transcript JSONB,
  recording_url TEXT,
  summary TEXT,
  duration_seconds INTEGER,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE 3: objections
-- Every objection logged mid-call by AI function calling.
-- ============================================================
CREATE TABLE IF NOT EXISTS objections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID REFERENCES calls(id),
  objection_type VARCHAR(100)
    CHECK (objection_type IN ('not_interested','too_expensive','send_info','call_later','has_provider','busy_moment','other')),
  prospect_statement TEXT,
  ai_response TEXT,
  resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE 4: payments
-- Stripe payment tracking per prospect per call.
-- stripe_session_id is UNIQUE for idempotent upserts.
-- ============================================================
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID REFERENCES prospects(id),
  call_id UUID REFERENCES calls(id),
  stripe_session_id VARCHAR(255) UNIQUE,
  amount_cents INTEGER,
  currency VARCHAR(10) DEFAULT 'usd',
  status VARCHAR(50) DEFAULT 'pending'
    CHECK (status IN ('pending','paid','failed','expired')),
  email_sent BOOLEAN DEFAULT FALSE,
  email_sent_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE 5: followups
-- Scheduled callbacks. Atomic locking via status column.
-- ============================================================
CREATE TABLE IF NOT EXISTS followups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id UUID REFERENCES prospects(id),
  call_id UUID REFERENCES calls(id),
  scheduled_at TIMESTAMPTZ NOT NULL,
  reason TEXT,
  status VARCHAR(50) DEFAULT 'pending'
    CHECK (status IN ('pending','processing','completed','cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE 6: phone_numbers
-- Outbound number pool with rotation tracking.
-- daily_call_count resets at midnight UTC via cron.
-- ============================================================
CREATE TABLE IF NOT EXISTS phone_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number VARCHAR(20) NOT NULL UNIQUE,
  daily_call_count INTEGER DEFAULT 0,
  total_calls INTEGER DEFAULT 0,
  answered_calls INTEGER DEFAULT 0,
  answer_rate NUMERIC(5,4) DEFAULT 0.5000,
  last_used_at TIMESTAMPTZ,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE 7: processed_tool_calls
-- Deduplication for Retell tool call retries.
-- tool_call_id is UNIQUE — duplicate inserts are silently ignored.
-- ============================================================
CREATE TABLE IF NOT EXISTS processed_tool_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_call_id VARCHAR(255) NOT NULL UNIQUE,
  function_name VARCHAR(100),
  response_text TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE 8: stripe_events
-- Deduplication for Stripe webhook retries (72-hour replay).
-- event_id is UNIQUE — duplicate webhook deliveries are ignored.
-- ============================================================
CREATE TABLE IF NOT EXISTS stripe_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id VARCHAR(255) NOT NULL UNIQUE,
  event_type VARCHAR(100),
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- Every column used in WHERE clauses is indexed.
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_prospects_status ON prospects(status);
CREATE INDEX IF NOT EXISTS idx_prospects_phone ON prospects(phone);
CREATE INDEX IF NOT EXISTS idx_calls_prospect ON calls(prospect_id);
CREATE INDEX IF NOT EXISTS idx_calls_retell_id ON calls(retell_call_id);
CREATE INDEX IF NOT EXISTS idx_calls_outcome ON calls(outcome);
CREATE INDEX IF NOT EXISTS idx_followups_scheduled ON followups(scheduled_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_followups_status ON followups(status);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_prospect ON payments(prospect_id);
CREATE INDEX IF NOT EXISTS idx_payments_call ON payments(call_id);
CREATE INDEX IF NOT EXISTS idx_phone_numbers_active ON phone_numbers(active) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_processed_tool_calls_id ON processed_tool_calls(tool_call_id);
CREATE INDEX IF NOT EXISTS idx_stripe_events_id ON stripe_events(event_id);

-- ============================================================
-- SEED: Insert your phone numbers (replace with real numbers)
-- ============================================================
-- INSERT INTO phone_numbers (number) VALUES
--   ('+14155551001'),
--   ('+14155551002'),
--   ('+14155551003');

-- ============================================================
-- WEEKLY MAINTENANCE QUERY (run manually or via pg_cron)
-- Recalculates answer_rate and retires numbers below 15%
-- ============================================================
-- UPDATE phone_numbers
-- SET answer_rate = CASE WHEN total_calls > 0 THEN answered_calls::numeric / total_calls ELSE 0.5 END,
--     active = CASE WHEN total_calls > 50 AND (answered_calls::numeric / GREATEST(total_calls, 1)) < 0.15 THEN false ELSE active END;
