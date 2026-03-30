"use client";

import { useCallback, useEffect, useState } from "react";
import { PhoneCall } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/status-badge";
import { LoadingSkeleton } from "@/components/loading-skeleton";
import { formatDateTime, safeText } from "@/lib/utils";

type FollowupProspect = {
  contact_name: string | null;
  company_name: string | null;
  phone: string | null;
};

type FollowupRow = {
  id: string;
  scheduled_at: string;
  reason: string | null;
  status: string;
  prospects: FollowupProspect | FollowupProspect[] | null;
};

type FollowupResponse = {
  data: FollowupRow[] | null;
  error: string | null;
  count: number | null;
};

const statusPills = [
  { label: "All", value: "" },
  { label: "Pending", value: "pending" },
  { label: "Processing", value: "processing" },
  { label: "Completed", value: "completed" },
  { label: "Cancelled", value: "cancelled" },
];

function pickProspect(value: FollowupProspect | FollowupProspect[] | null) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export default function FollowupsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<FollowupRow[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [pendingCount, setPendingCount] = useState(0);

  const pageSize = 20;
  const totalPages = Math.max(Math.ceil(count / pageSize), 1);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError("");
      try {
        const [listRes, pendingRes] = await Promise.all([
          fetch(
            `/api/dashboard/followups?page=${page}&limit=${pageSize}&status=${encodeURIComponent(status)}&dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`,
            { cache: "no-store" }
          ),
          fetch("/api/dashboard/followups?page=1&limit=1&status=pending", { cache: "no-store" }),
        ]);

        const payload = (await listRes.json()) as FollowupResponse;
        if (!listRes.ok || payload.error) throw new Error(payload.error || "Failed to load followups.");
        setRows(payload.data || []);
        setCount(payload.count || 0);

        const pendingPayload = (await pendingRes.json()) as FollowupResponse;
        if (pendingRes.ok && !pendingPayload.error) {
          setPendingCount(pendingPayload.count || 0);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load followups.";
        setRows([]);
        setCount(0);
        setPendingCount(0);
        setError(message);
        toast.error(message);
      } finally {
        setLoading(false);
      }
    },
    [page, pageSize, status, dateFrom, dateTo]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => void load(true), 30000);
    return () => window.clearInterval(id);
  }, [load]);

  const dialNow = async (id: string) => {
    try {
      const response = await fetch(`/api/dashboard/followups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dial_now" }),
      });
      const payload = await response.json();
      if (!response.ok || payload.error) throw new Error(payload.error || "Failed to dial followup.");
      toast.success("Follow-up dial initiated.");
      void load(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to dial followup.");
    }
  };

  const runCron = async () => {
    try {
      const response = await fetch("/api/dashboard/run-cron", { method: "POST", cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || payload.error) throw new Error(payload.error || "Cron run failed.");
      toast.success("Cron run completed.");
      void load(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Cron run failed.");
    }
  };

  const cancelFollowup = async (id: string) => {
    try {
      const response = await fetch(`/api/dashboard/followups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      const payload = await response.json();
      if (!response.ok || payload.error) throw new Error(payload.error || "Failed to cancel followup.");
      toast.success("Follow-up cancelled.");
      void load(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to cancel followup.");
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold text-white">Follow-ups</h1>
          <span className="rounded-full border border-[var(--line)] bg-[rgba(255,255,255,0.04)] px-3 py-1 text-xs text-[var(--text-muted)]">
            {pendingCount} pending
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {statusPills.map((pill) => {
            const active = status === pill.value;
            return (
              <button
                className={`rounded-full border px-3 py-1.5 text-xs transition-all ${
                  active
                    ? "border-[#0b67c5] bg-[linear-gradient(120deg,#38B6FF,#0066CC)] text-white"
                    : "border-[var(--line)] bg-[rgba(255,255,255,0.02)] text-[var(--text-muted)] hover:border-[var(--line-strong)]"
                }`}
                key={pill.value || "all"}
                onClick={() => {
                  setPage(1);
                  setStatus(pill.value);
                }}
                type="button"
              >
                {pill.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          className="w-48"
          onChange={(event) => {
            setPage(1);
            setDateFrom(event.target.value);
          }}
          type="date"
          value={dateFrom}
        />
        <Input
          className="w-48"
          onChange={(event) => {
            setPage(1);
            setDateTo(event.target.value);
          }}
          type="date"
          value={dateTo}
        />
        <Button onClick={() => void load()} variant="outline">
          Refresh
        </Button>
        <Button onClick={() => void runCron()} variant="outline">
          Run Cron
        </Button>
      </div>

      {error ? (
        <div className="rounded-xl border border-[rgba(255,68,68,0.45)] bg-[rgba(255,68,68,0.12)] px-4 py-3 text-sm text-[#ffc4c4]">
          {error}
        </div>
      ) : null}

      <Card>
        <CardContent className="pt-4">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 10 }).map((_, index) => (
                <LoadingSkeleton className="h-12 w-full" key={index} />
              ))}
            </div>
          ) : (
            <div className="overflow-auto rounded-2xl border border-[var(--line)]">
              <table className="w-full min-w-[980px]">
                <thead>
                  <tr className="border-b border-[var(--line)] bg-[rgba(255,255,255,0.03)] text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">
                    <th className="px-3 py-3">Prospect</th>
                    <th className="px-3 py-3">Phone</th>
                    <th className="px-3 py-3">Scheduled At</th>
                    <th className="px-3 py-3">Reason</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td className="px-3 py-10 text-center text-sm text-[var(--text-muted)]" colSpan={6}>
                        No followups found.
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => {
                      const prospect = pickProspect(row.prospects);
                      const overdue = row.status === "pending" && new Date(row.scheduled_at).getTime() < Date.now();
                      return (
                        <tr
                          className={`border-b border-[var(--line)] text-sm transition-all hover:bg-[rgba(56,182,255,0.08)] hover:shadow-[inset_0_0_0_1px_rgba(56,182,255,0.45)] ${
                            overdue ? "shadow-[inset_3px_0_0_0_#FFB800]" : ""
                          }`}
                          key={row.id}
                        >
                          <td className="px-3 py-3">{prospect?.contact_name || prospect?.company_name || "Unknown"}</td>
                          <td className="px-3 py-3" data-mono="true">
                            {prospect?.phone || "-"}
                          </td>
                          <td className="px-3 py-3 text-[var(--text-muted)]">{formatDateTime(row.scheduled_at)}</td>
                          <td className="px-3 py-3">{safeText(row.reason) || "-"}</td>
                          <td className="px-3 py-3">
                            <StatusBadge status={row.status} />
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex gap-2">
                              <Button onClick={() => void dialNow(row.id)} size="sm">
                                <PhoneCall className="mr-1 h-4 w-4" />
                                Call Now
                              </Button>
                              <Button onClick={() => void cancelFollowup(row.id)} size="sm" variant="danger">
                                Cancel
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-[var(--text-muted)]">
              Page {page} of {totalPages}
            </p>
            <div className="flex gap-2">
              <Button disabled={page <= 1} onClick={() => setPage((prev) => Math.max(prev - 1, 1))} variant="outline">
                Previous
              </Button>
              <Button disabled={page >= totalPages} onClick={() => setPage((prev) => prev + 1)} variant="outline">
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
