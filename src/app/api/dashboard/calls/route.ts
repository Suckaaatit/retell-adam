import { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { parsePagination, withErrorHandling, ok, fail, requireSupabaseConfigured } from "@/app/api/dashboard/_utils";
import { deriveCallAnalytics, derivePropertyType } from "@/lib/call-analytics";

export const maxDuration = 60;

type ProspectRow = {
  id: string;
  contact_name: string | null;
  company_name: string | null;
  phone: string | null;
  email: string | null;
  status: string | null;
  metadata: Record<string, unknown> | null;
};

function pickProspect(value: ProspectRow | ProspectRow[] | null): ProspectRow | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

async function fetchRowsByCallId<T>(table: string, select: string, callIds: string[]) {
  if (!callIds.length) return [] as T[];
  const chunkSize = 250;
  const chunks: string[][] = [];
  for (let i = 0; i < callIds.length; i += chunkSize) {
    chunks.push(callIds.slice(i, i + chunkSize));
  }
  const responses = await Promise.all(
    chunks.map(async (chunk) => {
      const { data, error } = await supabase.from(table).select(select).in("call_id", chunk);
      if (error) throw new Error(error.message);
      return (data || []) as T[];
    })
  );
  return responses.flat();
}

export async function GET(req: NextRequest) {
  return withErrorHandling("dashboard calls get failed", async () => {
    const supabaseGuard = requireSupabaseConfigured();
    if (supabaseGuard) return supabaseGuard;

    const { limit, offset, searchParams } = parsePagination(req.url);
    const outcome = searchParams.get("outcome") || "";
    const dateFrom = searchParams.get("dateFrom") || "";
    const dateTo = searchParams.get("dateTo") || "";
    const sortBy = searchParams.get("sortBy") || "created_at";
    const sortDirection = (searchParams.get("sortOrder") || searchParams.get("sortDirection") || "desc") === "asc";

    const allowedSort = new Set(["created_at", "duration_seconds", "outcome", "started_at"]);
    const safeSort = allowedSort.has(sortBy) ? sortBy : "created_at";

    let query = supabase
      .from("calls")
      .select(
        "id, prospect_id, retell_call_id, phone, outcome, transcript, recording_url, summary, duration_seconds, started_at, ended_at, created_at, prospects(id, contact_name, company_name, phone, email, status, metadata)",
        { count: "exact" }
      )
      .order(safeSort, { ascending: sortDirection, nullsFirst: false })
      .range(offset, offset + limit - 1);

    if (outcome) query = query.eq("outcome", outcome);
    if (dateFrom) query = query.gte("started_at", dateFrom);
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      query = query.lte("started_at", end.toISOString());
    }

    const { data, error, count } = await query;
    if (error) return fail(error.message, 500);
    const rows = data || [];
    const callIds = rows.map((row) => row.id as string);

    const [objections, payments, followups] = await Promise.all([
      fetchRowsByCallId<{
        id: string;
        call_id: string;
        objection_type: string;
        prospect_statement: string | null;
        ai_response: string | null;
        resolved: boolean | null;
        created_at: string | null;
      }>("objections", "id, call_id, objection_type, prospect_statement, ai_response, resolved, created_at", callIds),
      fetchRowsByCallId<{
        id: string;
        call_id: string;
        status: string | null;
        email_sent: boolean | null;
        email_sent_at: string | null;
        paid_at: string | null;
        created_at: string | null;
        amount_cents: number | null;
        stripe_session_id: string | null;
      }>("payments", "id, call_id, status, email_sent, email_sent_at, paid_at, created_at, amount_cents, stripe_session_id", callIds),
      fetchRowsByCallId<{
        id: string;
        call_id: string;
        status: string | null;
        scheduled_at: string | null;
        reason: string | null;
        created_at: string | null;
      }>("followups", "id, call_id, status, scheduled_at, reason, created_at", callIds),
    ]);

    const objectionsByCall = objections.reduce<Record<string, typeof objections>>((acc, row) => {
      if (!acc[row.call_id]) acc[row.call_id] = [];
      acc[row.call_id].push(row);
      return acc;
    }, {});
    const paymentsByCall = payments.reduce<Record<string, typeof payments>>((acc, row) => {
      if (!acc[row.call_id]) acc[row.call_id] = [];
      acc[row.call_id].push(row);
      return acc;
    }, {});
    const followupsByCall = followups.reduce<Record<string, typeof followups>>((acc, row) => {
      if (!acc[row.call_id]) acc[row.call_id] = [];
      acc[row.call_id].push(row);
      return acc;
    }, {});

    const enrichedRows = rows.map((row) => {
      const prospect = pickProspect(row.prospects as ProspectRow | ProspectRow[] | null);
      const analytics = deriveCallAnalytics({
        call: {
          id: row.id as string,
          prospect_id: row.prospect_id as string | null,
          retell_call_id: row.retell_call_id as string | null,
          phone: row.phone as string | null,
          outcome: row.outcome as string | null,
          transcript: row.transcript,
          recording_url: row.recording_url as string | null,
          summary: row.summary as string | null,
          duration_seconds: row.duration_seconds as number | null,
          started_at: row.started_at as string | null,
          ended_at: row.ended_at as string | null,
          created_at: row.created_at as string,
        },
        prospect: prospect
          ? {
              id: prospect.id,
              contact_name: prospect.contact_name,
              company_name: prospect.company_name,
              email: prospect.email,
              phone: prospect.phone,
              status: prospect.status,
              metadata: prospect.metadata,
            }
          : null,
        objections: objectionsByCall[String(row.id)] || [],
        payments: paymentsByCall[String(row.id)] || [],
        followups: followupsByCall[String(row.id)] || [],
      });

      // Destructure transcript separately so it's an explicit field
      // rather than an opaque blob from the Supabase spread.
      const { transcript, ...rowWithoutTranscript } = row as Record<string, unknown>;
      return {
        ...rowWithoutTranscript,
        transcript,
        analytics: {
          ...analytics,
          property_type: derivePropertyType(
            prospect
              ? {
                  id: prospect.id,
                  contact_name: prospect.contact_name,
                  company_name: prospect.company_name,
                  email: prospect.email,
                  phone: prospect.phone,
                  status: prospect.status,
                  metadata: prospect.metadata,
                }
              : null
          ),
        },
      };
    });

    return ok(enrichedRows, count || 0);
  });
}
