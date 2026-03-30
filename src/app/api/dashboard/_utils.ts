import { NextRequest, NextResponse } from "next/server";
import { ZodSchema } from "zod";
import { config } from "@/lib/config";
import { logError } from "@/lib/logger";

export type ApiResponseShape<T> = {
  data: T | null;
  error: string | null;
  count: number | null;
};

export function ok<T>(data: T, count: number | null = null, status = 200) {
  const payload: ApiResponseShape<T> = {
    data,
    error: null,
    count,
  };
  return NextResponse.json(payload, { status });
}

export function fail(error: string, status = 400) {
  const payload: ApiResponseShape<null> = {
    data: null,
    error,
    count: null,
  };
  return NextResponse.json(payload, { status });
}

const SUPABASE_NOT_CONFIGURED_MESSAGE =
  "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in runtime environment variables.";

export function isSupabaseConfigured() {
  // Supabase now issues multiple key formats (legacy JWT and sb_secret_...).
  // Treat configuration as valid when both values are present.
  return Boolean(config.supabase.url?.trim() && config.supabase.serviceRoleKey?.trim());
}

export function requireSupabaseConfigured() {
  if (isSupabaseConfigured()) return null;
  return fail(SUPABASE_NOT_CONFIGURED_MESSAGE, 500);
}

export async function parseJson<T>(req: NextRequest, schema: ZodSchema<T>) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return {
      data: null as T | null,
      error: "Invalid JSON body",
    };
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      data: null as T | null,
      error: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(", "),
    };
  }
  return {
    data: parsed.data,
    error: null,
  };
}

export function parsePagination(url: string) {
  const { searchParams } = new URL(url);
  const pageRaw = parseInt(searchParams.get("page") || "1", 10);
  const limitRaw = parseInt(searchParams.get("limit") || searchParams.get("pageSize") || "20", 10);
  const page = Number.isFinite(pageRaw) ? Math.max(pageRaw, 1) : 1;
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;
  const offset = (page - 1) * limit;
  return { page, limit, pageSize: limit, offset, searchParams };
}

export async function withErrorHandling(label: string, fn: () => Promise<NextResponse>) {
  try {
    return await fn();
  } catch (error) {
    logError(label, error);
    return fail("Internal server error", 500);
  }
}
