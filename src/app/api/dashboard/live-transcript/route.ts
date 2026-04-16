import { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { ok, fail, requireSupabaseConfigured, withErrorHandling } from "../_utils";

/**
 * GET /api/dashboard/live-transcript?call_sid=X or ?prospect_id=X
 *
 * Returns recent live transcript lines for an active call.
 * Dashboard polls this every 2 seconds to display real-time transcription.
 */
export async function GET(req: NextRequest) {
  return withErrorHandling("live-transcript", async () => {
    const dbCheck = requireSupabaseConfigured();
    if (dbCheck) return dbCheck;

    const { searchParams } = new URL(req.url);
    const callSid = searchParams.get("call_sid");
    const prospectId = searchParams.get("prospect_id");
    const after = searchParams.get("after"); // ISO timestamp — only return lines after this

    let query = supabase
      .from("live_transcripts")
      .select("id, call_sid, prospect_id, speaker, text, created_at")
      .order("created_at", { ascending: true });

    if (callSid) {
      query = query.eq("call_sid", callSid);
    } else if (prospectId) {
      query = query.eq("prospect_id", prospectId);
    } else {
      // No filter — get most recent call's transcripts (last 5 minutes)
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      query = query.gte("created_at", fiveMinAgo);
    }

    if (after) {
      query = query.gt("created_at", after);
    }

    query = query.limit(200);

    const { data, error } = await query;

    if (error) {
      return fail("Failed to fetch live transcript", 500);
    }

    return ok(data || [], data?.length || 0);
  });
}
