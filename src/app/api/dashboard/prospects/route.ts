import { NextRequest } from "next/server";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { parseJson, parsePagination, withErrorHandling, ok, fail, requireSupabaseConfigured } from "@/app/api/dashboard/_utils";

export const maxDuration = 60;

const CreateProspectSchema = z.object({
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/, "Phone must be valid E.164"),
  contact_name: z.string().max(255).optional().default(""),
  company_name: z.string().max(255).optional().default(""),
  email: z.string().email().optional().or(z.literal("")).default(""),
  source: z.string().max(100).optional().default(""),
});

export async function GET(req: NextRequest) {
  return withErrorHandling("dashboard prospects get failed", async () => {
    const supabaseGuard = requireSupabaseConfigured();
    if (supabaseGuard) return supabaseGuard;

    const { limit, offset, searchParams } = parsePagination(req.url);
    const status = searchParams.get("status") || "";
    const search = searchParams.get("search") || "";
    const sortBy = searchParams.get("sortBy") || "created_at";
    const sortDirection = (searchParams.get("sortOrder") || searchParams.get("sortDirection") || "desc") === "asc";

    const allowedSorts = new Set([
      "created_at",
      "updated_at",
      "contact_name",
      "company_name",
      "status",
      "total_calls",
      "last_called_at",
    ]);
    const safeSortBy = allowedSorts.has(sortBy) ? sortBy : "created_at";

    let query = supabase
      .from("prospects")
      .select("id, contact_name, phone, company_name, status, total_calls, last_called_at, created_at", {
        count: "estimated",
      })
      .order(safeSortBy, { ascending: sortDirection, nullsFirst: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq("status", status);
    }
    if (search) {
      const term = search.replaceAll(",", "");
      query = query.or(
        `contact_name.ilike.%${term}%,company_name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`
      );
    }

    const { data, error, count } = await query;
    if (error) {
      return fail(error.message, 500);
    }

    return ok(data || [], count || 0);
  });
}

export async function POST(req: NextRequest) {
  return withErrorHandling("dashboard prospects post failed", async () => {
    const supabaseGuard = requireSupabaseConfigured();
    if (supabaseGuard) return supabaseGuard;

    const parsed = await parseJson(req, CreateProspectSchema);
    if (parsed.error || !parsed.data) {
      return fail(parsed.error || "Invalid payload", 400);
    }

    const payload = parsed.data;
    const insertBody = {
      phone: payload.phone,
      contact_name: payload.contact_name || null,
      company_name: payload.company_name || null,
      email: payload.email || null,
      source: payload.source || null,
      status: "pending",
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase.from("prospects").insert(insertBody).select("*").maybeSingle();
    if (error) {
      if (error.code === "23505") {
        return fail("Prospect with this phone already exists.", 409);
      }
      return fail(error.message, 500);
    }
    if (!data) return fail("Prospect creation failed.", 500);

    return ok(data, 1, 201);
  });
}
