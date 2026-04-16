import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { logError } from "@/lib/logger";

/**
 * GET /api/dashboard/live-transcript?conversation_id=X
 * GET /api/dashboard/live-transcript  (no param = fetches latest active conversation)
 *
 * Fetches live transcript from ElevenLabs Conversations API.
 * Polls ElevenLabs directly — works during active calls.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    let conversationId = searchParams.get("conversation_id");

    // If no conversation_id provided, fetch the latest conversation
    if (!conversationId) {
      const listRes = await fetch(
        `https://api.elevenlabs.io/v1/convai/conversations?agent_id=${config.elevenlabs.agentId}&page_size=5`,
        {
          headers: { "xi-api-key": config.elevenlabs.apiKey },
          cache: "no-store",
        }
      );

      if (!listRes.ok) {
        return NextResponse.json({ data: [], error: null, count: 0 });
      }

      const listData = await listRes.json();
      const conversations = listData.conversations || [];

      if (conversations.length === 0) {
        return NextResponse.json({ data: [], error: null, count: 0 });
      }

      // Prefer active conversation, fall back to most recent
      const active = conversations.find(
        (c: { status: string }) => c.status === "in-progress" || c.status === "initiated" || c.status === "processing"
      );
      conversationId = active ? active.conversation_id : conversations[0].conversation_id;
    }

    // Fetch conversation details with transcript
    const detailRes = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversations/${conversationId}`,
      {
        headers: { "xi-api-key": config.elevenlabs.apiKey },
        cache: "no-store",
      }
    );

    if (!detailRes.ok) {
      return NextResponse.json({ data: [], error: null, count: 0 });
    }

    const detail = await detailRes.json();
    const transcript = detail.transcript || [];
    const status = detail.status || "unknown";

    // Map to simple format for the UI
    const lines = transcript
      .filter((t: { message?: string }) => t.message && t.message.trim())
      .map((t: { role: string; message: string; time_in_call_secs: number }) => ({
        speaker: t.role === "agent" ? "agent" : "client",
        text: t.message,
        time: t.time_in_call_secs,
      }));

    return NextResponse.json({
      data: lines,
      error: null,
      count: lines.length,
      conversation_id: conversationId,
      status,
    });
  } catch (err) {
    logError("live-transcript: error", err);
    return NextResponse.json({ data: [], error: null, count: 0 });
  }
}
