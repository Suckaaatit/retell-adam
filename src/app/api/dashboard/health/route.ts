import { NextResponse } from "next/server";

export const maxDuration = 60;

export async function GET() {
  return NextResponse.json({ ok: true, timestamp: new Date().toISOString() });
}
