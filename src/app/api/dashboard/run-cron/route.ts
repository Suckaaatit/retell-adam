import { NextResponse } from "next/server";
import { config } from "@/lib/config";

export const maxDuration = 60;

export async function POST(req: Request) {
  const cronSecret = config.app.cronSecret;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET missing" }, { status: 500 });
  }

  const requestOrigin = new URL(req.url).origin;
  const baseUrl =
    config.app.url ||
    (config.app.vercelUrl ? `https://${config.app.vercelUrl}` : requestOrigin);

  const res = await fetch(`${baseUrl}/api/cron/followups`, {
    method: "GET",
    headers: { Authorization: `Bearer ${cronSecret}` },
    cache: "no-store",
  });

  const payload = await res.json().catch(() => ({ error: "Invalid cron response" }));
  return NextResponse.json(payload, { status: res.status });
}
