"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ExternalLink, X } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { LoadingSkeleton } from "@/components/loading-skeleton";
import { formatCurrencyFromCents, formatDateTime } from "@/lib/utils";

type PaymentProspect = {
  contact_name: string | null;
  company_name: string | null;
  email: string | null;
};

type PaymentRow = {
  id: string;
  stripe_session_id: string | null;
  amount_cents: number | null;
  status: string;
  email_sent: boolean;
  paid_at: string | null;
  created_at: string;
  prospects: PaymentProspect | PaymentProspect[] | null;
};

type PaymentKpis = {
  total_revenue_cents: number;
  payments_today: number;
  conversion_rate: number;
  average_payment_cents: number;
};

type PaymentsApiPayload = {
  data:
    | {
        items: PaymentRow[];
        kpis: PaymentKpis;
      }
    | null;
  error: string | null;
  count: number | null;
};

function pickProspect(value: PaymentProspect | PaymentProspect[] | null) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export default function PaymentsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [count, setCount] = useState(0);
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pendingCount, setPendingCount] = useState(0);
  const [monthPaidCount, setMonthPaidCount] = useState(0);
  const [monthPaidAmount, setMonthPaidAmount] = useState(0);

  const pageSize = 20;
  const totalPages = Math.max(Math.ceil(count / pageSize), 1);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError("");
      try {
        const [currentRes, pendingRes, paidRes] = await Promise.all([
          fetch(`/api/dashboard/payments?page=${page}&limit=${pageSize}&status=${encodeURIComponent(status)}`, { cache: "no-store" }),
          fetch("/api/dashboard/payments?page=1&limit=1&status=pending", { cache: "no-store" }),
          fetch("/api/dashboard/payments?page=1&limit=100&status=paid", { cache: "no-store" }),
        ]);

        const payload = (await currentRes.json()) as PaymentsApiPayload;
        if (!currentRes.ok || payload.error || !payload.data) {
          throw new Error(payload.error || "Failed to load payments.");
        }
        setRows(payload.data.items || []);
        setCount(payload.count || 0);

        const pendingPayload = (await pendingRes.json()) as PaymentsApiPayload;
        if (pendingRes.ok && !pendingPayload.error) {
          setPendingCount(pendingPayload.count || 0);
        }

        const paidPayload = (await paidRes.json()) as PaymentsApiPayload;
        if (paidRes.ok && paidPayload.data) {
          const now = new Date();
          const monthRows = (paidPayload.data.items || []).filter((row) => {
            if (!row.paid_at) return false;
            const paidAt = new Date(row.paid_at);
            return paidAt.getUTCFullYear() === now.getUTCFullYear() && paidAt.getUTCMonth() === now.getUTCMonth();
          });
          setMonthPaidCount(monthRows.length);
          setMonthPaidAmount(monthRows.reduce((sum, row) => sum + Number(row.amount_cents || 0), 0));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to load payments.";
        setRows([]);
        setCount(0);
        setPendingCount(0);
        setMonthPaidCount(0);
        setMonthPaidAmount(0);
        setError(message);
        toast.error(message);
      } finally {
        setLoading(false);
      }
    },
    [page, pageSize, status]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => void load(true), 30000);
    return () => window.clearInterval(id);
  }, [load]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold text-white">Payments</h1>
        <div className="flex gap-2">
          <Select
            onChange={(event) => {
              setPage(1);
              setStatus(event.target.value);
            }}
            value={status}
          >
            <option value="">All statuses</option>
            <option value="paid">paid</option>
            <option value="pending">pending</option>
            <option value="expired">expired</option>
            <option value="failed">failed</option>
          </Select>
          <Button onClick={() => void load()} variant="outline">
            Refresh
          </Button>
        </div>
      </div>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <StatCard
          description="Sent links waiting for checkout completion"
          icon={X}
          title="Pending Payments"
          tone="warning"
          value={loading ? "-" : String(pendingCount)}
        />
        <StatCard
          description={`${formatCurrencyFromCents(monthPaidAmount)} collected`}
          icon={Check}
          title="Collected This Month"
          tone="success"
          value={loading ? "-" : String(monthPaidCount)}
        />
      </section>

      {error ? (
        <div className="rounded-xl border border-[rgba(255,68,68,0.45)] bg-[rgba(255,68,68,0.12)] px-4 py-3 text-sm text-[#ffc4c4]">
          {error}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Payment Log</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 10 }).map((_, index) => (
                <LoadingSkeleton className="h-12 w-full" key={index} />
              ))}
            </div>
          ) : (
            <div className="overflow-auto rounded-2xl border border-[var(--line)]">
              <table className="w-full min-w-[1080px]">
                <thead>
                  <tr className="border-b border-[var(--line)] bg-[rgba(255,255,255,0.03)] text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">
                    <th className="px-3 py-3">Prospect</th>
                    <th className="px-3 py-3">Email</th>
                    <th className="px-3 py-3">Amount</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Email Sent</th>
                    <th className="px-3 py-3">Paid At</th>
                    <th className="px-3 py-3">Stripe Link</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td className="px-3 py-10 text-center text-sm text-[var(--text-muted)]" colSpan={7}>
                        No payments found.
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => {
                      const prospect = pickProspect(row.prospects);
                      return (
                        <tr
                          className="border-b border-[var(--line)] text-sm transition-all hover:bg-[rgba(56,182,255,0.08)] hover:shadow-[inset_0_0_0_1px_rgba(56,182,255,0.45)]"
                          key={row.id}
                        >
                          <td className="px-3 py-3">{prospect?.contact_name || prospect?.company_name || "Unknown"}</td>
                          <td className="px-3 py-3">{prospect?.email || "-"}</td>
                          <td className="px-3 py-3">{formatCurrencyFromCents(row.amount_cents || 0)}</td>
                          <td className="px-3 py-3">
                            <StatusBadge status={row.status} />
                          </td>
                          <td className="px-3 py-3">
                            {row.email_sent ? <Check className="h-4 w-4 text-[var(--green)]" /> : <X className="h-4 w-4 text-[var(--red)]" />}
                          </td>
                          <td className="px-3 py-3 text-[var(--text-muted)]">{formatDateTime(row.paid_at)}</td>
                          <td className="px-3 py-3">
                            {row.stripe_session_id ? (
                              <a
                                className="inline-flex items-center gap-1 text-[#8ed5ff] hover:text-[#c7ecff]"
                                href={`https://dashboard.stripe.com/checkout/sessions/${row.stripe_session_id}`}
                                rel="noreferrer"
                                target="_blank"
                              >
                                <ExternalLink className="h-4 w-4" />
                                Open
                              </a>
                            ) : (
                              "-"
                            )}
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
