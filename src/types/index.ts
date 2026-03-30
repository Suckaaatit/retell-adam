import { z } from 'zod';

// ============================================================
// Environment Variable Schema
// ============================================================
export const EnvSchema = z.object({
  ELEVENLABS_API_KEY: z.string().min(1, 'ELEVENLABS_API_KEY is required'),
  ELEVENLABS_AGENT_ID: z.string().min(1, 'ELEVENLABS_AGENT_ID is required'),
  ELEVENLABS_PHONE_NUMBER_ID: z.string().optional().or(z.literal('')),
  ELEVENLABS_WEBHOOK_SECRET: z.string().min(1, 'ELEVENLABS_WEBHOOK_SECRET is required'),
  AGENT_SECRET: z.string().min(1, 'AGENT_SECRET is required'),
  TWILIO_ACCOUNT_SID: z.string().min(1, 'TWILIO_ACCOUNT_SID is required'),
  TWILIO_AUTH_TOKEN: z.string().min(1, 'TWILIO_AUTH_TOKEN is required'),
  TWILIO_FROM_NUMBER: z.string().optional().or(z.literal('')),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url('NEXT_PUBLIC_SUPABASE_URL must be a valid URL'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),
  STRIPE_SECRET_KEY: z.string().startsWith('sk_', 'STRIPE_SECRET_KEY must start with sk_'),
  STRIPE_WEBHOOK_SECRET: z.string().min(1, 'STRIPE_WEBHOOK_SECRET is required'),
  STRIPE_LINK_650: z.string().url('STRIPE_LINK_650 must be a valid URL'),
  STRIPE_LINK_1100: z.string().url('STRIPE_LINK_1100 must be a valid URL'),
  RESEND_API_KEY: z.string().min(1, 'RESEND_API_KEY is required'),
  RESEND_FROM_EMAIL: z.string().email('RESEND_FROM_EMAIL must be a valid email'),
  RESEND_WEBHOOK_SECRET: z.string().optional().or(z.literal('')),
  RESEND_FROM_NAME: z.string().optional().or(z.literal('')),
  RESEND_REPLY_TO_EMAIL: z.string().email('RESEND_REPLY_TO_EMAIL must be a valid email').optional().or(z.literal('')),
  BUSINESS_PHONE_NUMBER: z.string().optional().or(z.literal('')),
  BUSINESS_WEBSITE_URL: z.string().url('BUSINESS_WEBSITE_URL must be a valid URL').optional().or(z.literal('')),
  NEXT_PUBLIC_APP_URL: z.string().url('NEXT_PUBLIC_APP_URL must be a valid URL'),
  INTERNAL_API_SECRET: z.string().min(16, 'INTERNAL_API_SECRET must be at least 16 characters'),
  CRON_SECRET: z.string().optional().or(z.literal('')),
  DASHBOARD_BASIC_USER: z.string().optional().or(z.literal('')),
  DASHBOARD_BASIC_PASS: z.string().optional().or(z.literal('')),
  VERCEL_URL: z.string().optional().or(z.literal('')),
  NODE_ENV: z.string().optional().or(z.literal('')),
});

export type EnvConfig = z.infer<typeof EnvSchema>;

// ============================================================
// ElevenLabs Webhook + Tool Call Payload Schemas
// ============================================================
export const ElevenLabsToolCallSchema = z.object({
  tool_name: z.string().min(1, 'tool_name is required'),
  tool_call_id: z.string().min(1, 'tool_call_id is required'),
  conversation_id: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).default({}),
}).passthrough();

export type ElevenLabsToolCall = z.infer<typeof ElevenLabsToolCallSchema>;

export const ElevenLabsTranscriptTurnSchema = z.object({
  role: z.enum(['agent', 'user']),
  message: z.string(),
  tool_calls: z.array(z.unknown()).optional(),
  tool_results: z.array(z.unknown()).optional(),
}).passthrough();

export const ElevenLabsPostCallTranscriptionSchema = z.object({
  type: z.literal('post_call_transcription'),
  event_timestamp: z.number(),
  data: z.object({
    agent_id: z.string().optional(),
    conversation_id: z.string().min(1),
    status: z.string().optional(),
    transcript: z.array(ElevenLabsTranscriptTurnSchema).optional(),
    metadata: z.object({
      call_duration_secs: z.number().optional(),
      cost: z.number().optional(),
    }).passthrough().optional(),
    analysis: z.object({
      call_successful: z.boolean().optional(),
      transcript_summary: z.string().optional(),
      data_collection_results: z.record(z.string(), z.unknown()).optional(),
    }).passthrough().optional(),
    conversation_initiation_client_data: z.object({
      dynamic_variables: z.record(z.string(), z.unknown()).optional(),
    }).passthrough().optional(),
  }).passthrough(),
}).passthrough();

export type ElevenLabsPostCallTranscription = z.infer<typeof ElevenLabsPostCallTranscriptionSchema>;

export const ElevenLabsPostCallAudioSchema = z.object({
  type: z.literal('post_call_audio'),
  event_timestamp: z.number(),
  data: z.object({
    conversation_id: z.string().min(1),
    recording_url: z.string(),
  }).passthrough(),
}).passthrough();

export type ElevenLabsPostCallAudio = z.infer<typeof ElevenLabsPostCallAudioSchema>;

export const ElevenLabsWebhookPayloadSchema = z.discriminatedUnion('type', [
  ElevenLabsPostCallTranscriptionSchema,
  ElevenLabsPostCallAudioSchema,
]);

export type ElevenLabsWebhookPayload = z.infer<typeof ElevenLabsWebhookPayloadSchema>;

// ============================================================
// Internal Process Payment Payload
// ============================================================
export const ProcessPaymentPayloadSchema = z.object({
  call_id: z.string().uuid('call_id must be a UUID').optional(),
  prospect_id: z.string().uuid('prospect_id must be a UUID').optional(),
  email: z.string().email('email must be valid'),
  retell_call_id: z.string().min(1, 'retell_call_id is required'),
  secret: z.string().min(1, 'secret is required'),
  plan_tier: z.enum(['one_incident', 'two_incident']).optional(),
  plan_label: z.string().optional(),
  price_id: z.string().startsWith('price_').optional(),
  company_name: z.string().optional(),
  prospect_name: z.string().optional(),
});

export type ProcessPaymentPayload = z.infer<typeof ProcessPaymentPayloadSchema>;

// ============================================================
// Database Row Types
// ============================================================
export interface ProspectRow {
  id: string;
  phone: string;
  email: string | null;
  company_name: string | null;
  contact_name: string | null;
  status: string;
  source: string | null;
  total_calls: number;
  last_called_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CallRow {
  id: string;
  prospect_id: string;
  retell_call_id: string;
  phone: string | null;
  outcome: string | null;
  transcript: Record<string, unknown> | null;
  recording_url: string | null;
  summary: string | null;
  duration_seconds: number | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

export interface PaymentRow {
  id: string;
  prospect_id: string;
  call_id: string;
  stripe_session_id: string | null;
  amount_cents: number | null;
  currency: string;
  status: string;
  email_sent: boolean;
  email_sent_at: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface FollowupRow {
  id: string;
  prospect_id: string;
  call_id: string | null;
  scheduled_at: string;
  reason: string | null;
  status: string;
  created_at: string;
}

export interface PhoneNumberRow {
  id: string;
  number: string;
  daily_call_count: number;
  total_calls: number;
  answered_calls: number;
  answer_rate: number;
  last_used_at: string | null;
  active: boolean;
  created_at: string;
}

export interface ObjectionRow {
  id: string;
  call_id: string;
  objection_type: string;
  prospect_statement: string | null;
  ai_response: string | null;
  resolved: boolean;
  created_at: string;
}

export interface ProcessedToolCallRow {
  id: string;
  tool_call_id: string;
  function_name: string | null;
  response_text: string | null;
  created_at: string;
}

export interface StripeEventRow {
  id: string;
  event_id: string;
  event_type: string | null;
  processed_at: string;
}

// ============================================================
// Resend Webhook Payload
// ============================================================
export const ResendWebhookSchema = z.object({
  type: z.string(),
  data: z.object({
    to: z.array(z.string()).optional(),
    email: z.string().optional(),
    delivered_at: z.string().optional(),
    created_at: z.string().optional(),
    open_count: z.number().optional(),
    click_count: z.number().optional(),
  }).passthrough().optional(),
});

export type ResendWebhookPayload = z.infer<typeof ResendWebhookSchema>;

// ============================================================
// Structured Log Type
// ============================================================
export interface StructuredLog {
  level: 'info' | 'warn' | 'error';
  message: string;
  timestamp: string;
  callId?: string;
  prospectId?: string;
  stripeEventId?: string;
  toolCallId?: string;
  functionName?: string;
  [key: string]: unknown;
}
