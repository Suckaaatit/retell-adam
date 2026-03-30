import { NextRequest } from "next/server";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { parseJson, withErrorHandling, ok, fail, requireSupabaseConfigured } from "@/app/api/dashboard/_utils";

const CsvRowSchema = z.object({
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/, "Phone must be valid E.164"),
  contact_name: z.string().max(255).optional().or(z.literal("")),
  company_name: z.string().max(255).optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  source: z.string().max(100).optional().or(z.literal("")),
});

const ImportSchema = z.object({
  rows: z.array(CsvRowSchema).min(1, "At least one row is required"),
});

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  return withErrorHandling("dashboard prospects import failed", async () => {
    const supabaseGuard = requireSupabaseConfigured();
    if (supabaseGuard) return supabaseGuard;

    const parsed = await parseJson(req, ImportSchema);
    if (parsed.error || !parsed.data) {
      return fail(parsed.error || "Invalid payload", 400);
    }

    const rows = parsed.data.rows.map((row) => ({
      phone: row.phone.trim(),
      contact_name: row.contact_name?.trim() || "",
      company_name: row.company_name?.trim() || "",
      email: row.email?.trim() || "",
      source: row.source?.trim() || "",
    }));

    const errors: string[] = [];
    const dedupedRows = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (dedupedRows.has(row.phone)) {
        errors.push(`Duplicate phone in upload: ${row.phone}`);
        continue;
      }
      dedupedRows.set(row.phone, row);
    }

    const uniqueRows = Array.from(dedupedRows.values());
    const phones = uniqueRows.map((row) => row.phone);

    const existingRes = await supabase.from("prospects").select("phone").in("phone", phones);
    if (existingRes.error) return fail(existingRes.error.message, 500);

    const existingPhoneSet = new Set((existingRes.data || []).map((row) => row.phone));
    const newRows = uniqueRows.filter((row) => !existingPhoneSet.has(row.phone));
    for (const row of uniqueRows) {
      if (existingPhoneSet.has(row.phone)) {
        errors.push(`Phone already exists, skipped: ${row.phone}`);
      }
    }

    if (newRows.length === 0) {
      return ok({ imported: 0, skipped: rows.length, errors }, 0);
    }

    const insertPayload = newRows.map((row) => ({
      phone: row.phone,
      contact_name: row.contact_name || null,
      company_name: row.company_name || null,
      email: row.email || null,
      source: row.source || null,
      status: "pending",
      updated_at: new Date().toISOString(),
    }));

    const insertRes = await supabase.from("prospects").insert(insertPayload);
    if (insertRes.error) return fail(insertRes.error.message, 500);

    return ok(
      {
        imported: newRows.length,
        skipped: rows.length - newRows.length,
        errors,
      },
      newRows.length
    );
  });
}
