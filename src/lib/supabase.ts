import { createClient } from '@supabase/supabase-js';
import { config } from './config';

/**
 * Supabase client using REST API (PostgREST).
 * NEVER use direct Postgres (pg) from Vercel serverless — causes connection pool exhaustion.
 * Direct Postgres is ONLY used in the local batch-dial.js script.
 */
export const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  {
    auth: { persistSession: false },
  }
);
