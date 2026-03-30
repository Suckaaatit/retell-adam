"use client";

import { useCallback, useEffect, useState } from "react";
import { Ban, CalendarPlus, PhoneCall, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/status-badge";
import { ProspectModal } from "@/components/prospect-modal";
import { CsvImportModal } from "@/components/csv-import-modal";
import { LoadingSkeleton } from "@/components/loading-skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDateTime, formatDuration, safeText } from "@/lib/utils";

type Prospect = {
  id: string;
  phone: string;
  email: string | null;
  company_name: string | null;
  contact_name: string | null;
  status: string;
  source: string | null;
  total_calls: number;
  last_called_at: string | null;
  created_at: string;
};

type ProspectCall = {
  id: string;
  outcome: string | null;
  duration_seconds: number | null;
  started_at: string | null;
  summary: string | null;
  analytics?: {
    stage_reached: "pitch" | "objections" | "closing" | "closed";
    failure_stage: "pitch" | "objections" | "closing" | null;
    failure_reason: string | null;
    timeline: Array<{
      id: string;
      label: string;
      detail: string;
      tone: "blue" | "green" | "amber" | "red" | "gray";
      offset_seconds: number;
      timestamp: string | null;
    }>;
  };
};

type ProspectObjection = {
  id: string;
  objection_type: string;
  prospect_statement: string | null;
};

type ProspectPayment = {
  id: string;
  status: string;
  amount_cents: number | null;
  created_at: string;
};

type ProspectFollowup = {
  id: string;
  status: string;
  scheduled_at: string;
  reason: string | null;
};

type ProspectListResponse = {
  data: Prospect[] | null;
  error: string | null;
  count: number | null;
};

type ProspectDetailResponse = {
  data:
    | {
        prospect: Prospect;
        calls: ProspectCall[];
        objections: ProspectObjection[];
        payments: ProspectPayment[];
        followups: ProspectFollowup[];
      }
    | null;
  error: string | null;
  count: number | null;
};

const statusPills = [
  { label: "All", value: "" },
  { label: "Pending", value: "pending" },
  { label: "Called", value: "called" },
  { label: "Interested", value: "interested" },
  { label: "Closed", value: "closed" },
  { label: "Followup", value: "followup" },
  { label: "DNC", value: "do_not_call" },
];

const allStatuses = [
  "pending",
  "dialing",
  "called",
  "failed",
  "contacted",
  "interested",
  "closed",
  "rejected",
  "followup",
  "do_not_call",
  "no_answer",
];

function cents(value: number | null) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((value || 0) / 100);
}

function stageLabel(value: string | null | undefined) {
  if (!value) return "-";
  return value
    .replaceAll("_", " ")
    .split(" ")
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function dotTone(tone: "blue" | "green" | "amber" | "red" | "gray") {
  if (tone === "green") return "bg-[var(--green)]";
  if (tone === "amber") return "bg-[var(--amber)]";
  if (tone === "red") return "bg-[var(--red)]";
  if (tone === "gray") return "bg-[var(--text-muted)]";
  return "bg-[var(--brand-1)]";
}

export default function ProspectsPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Prospect[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("calls");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<ProspectDetailResponse["data"]>(null);
  const [savingDetail, setSavingDetail] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleProspectId, setScheduleProspectId] = useState("");
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleReason, setScheduleReason] = useState("");

  const pageSize = 20;
  const totalPages = Math.max(Math.ceil(count / pageSize), 1);
  const selected = detail?.prospect || null;
  const latestCall = detail?.calls?.[0] || null;

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const response = await fetch(
          `/api/dashboard/prospects?page=${page}&pageSize=${pageSize}&status=${encodeURIComponent(status)}&search=${encodeURIComponent(search)}&sortBy=created_at&sortDirection=desc`,
          { cache: "no-store" }
        );
        const payload = (await response.json()) as ProspectListResponse;
        if (!response.ok || payload.error) throw new Error(payload.error || "Failed to load prospects.");
        setRows(payload.data || []);
        setCount(payload.count || 0);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load prospects.");
      } finally {
        setLoading(false);
      }
    },
    [page, pageSize, status, search]
  );

  const loadDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/dashboard/prospects/${id}`, { cache: "no-store" });
      const payload = (await response.json()) as ProspectDetailResponse;
      if (!response.ok || payload.error || !payload.data) {
        throw new Error(payload.error || "Failed to load prospect detail.");
      }
      setDetail(payload.data);
      setActiveTab("calls");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load prospect detail.");
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => void load(true), 30000);
    return () => window.clearInterval(id);
  }, [load]);

  const refresh = async () => {
    await load();
    if (selected?.id) await loadDetail(selected.id);
  };

  const updateDetailField = (field: keyof Prospect, value: string) => {
    if (!selected) return;
    setDetail((prev) =>
      prev
        ? {
            ...prev,
            prospect: {
              ...prev.prospect,
              [field]: value || null,
            },
          }
        : prev
    );
  };

  const callNow = async (prospectId: string, phone: string, contactName?: string | null) => {
    try {
      const response = await fetch("/api/dashboard/call-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prospect_id: prospectId, phone, contact_name: contactName || null }),
      });
      const payload = await response.json();
      if (!response.ok || payload.error) throw new Error(payload.error || "Call initiation failed.");
      toast.success("Call initiated.");
      void refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Call initiation failed.");
    }
  };

  const markDnc = async (id: string) => {
    try {
      const response = await fetch(`/api/dashboard/prospects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "do_not_call" }),
      });
      const payload = await response.json();
      if (!response.ok || payload.error) throw new Error(payload.error || "Failed to mark do_not_call.");
      toast.success("Prospect marked as Do Not Call.");
      if (selected?.id === id) setDetail(null);
      void load(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update prospect.");
    }
  };

  const deleteProspect = async (id: string) => {
    const confirmed = window.confirm("Delete this prospect and related records?");
    if (!confirmed) return;
    try {
      const response = await fetch(`/api/dashboard/prospects/${id}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok || payload.error) throw new Error(payload.error || "Failed to delete prospect.");
      toast.success("Prospect deleted.");
      if (selected?.id === id) setDetail(null);
      void load(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete prospect.");
    }
  };

  const openSchedule = (prospectId: string) => {
    setScheduleProspectId(prospectId);
    setScheduleOpen(true);
  };

  const scheduleFollowup = async () => {
    if (!scheduleProspectId || !scheduleDate) {
      toast.error("Select date and time.");
      return;
    }
    try {
      const response = await fetch("/api/dashboard/followups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prospect_id: scheduleProspectId,
          scheduled_at: new Date(scheduleDate).toISOString(),
          reason: scheduleReason || "Callback requested",
        }),
      });
      const payload = await response.json();
      if (!response.ok || payload.error) throw new Error(payload.error || "Failed to schedule followup.");
      toast.success("Follow-up scheduled.");
      setScheduleOpen(false);
      setScheduleProspectId("");
      setScheduleDate("");
      setScheduleReason("");
      void refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to schedule followup.");
    }
  };

  const saveDetail = async () => {
    if (!selected) return;
    setSavingDetail(true);
    try {
      const response = await fetch(`/api/dashboard/prospects/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: selected.phone,
          contact_name: selected.contact_name,
          company_name: selected.company_name,
          email: selected.email,
          source: selected.source,
          status: selected.status,
        }),
      });
      const payload = await response.json();
      if (!response.ok || payload.error) throw new Error(payload.error || "Failed to save.");
      toast.success("Prospect updated.");
      void refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save.");
    } finally {
      setSavingDetail(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold text-white">Prospects</h1>
          <span className="rounded-full border border-[var(--line)] bg-[rgba(255,255,255,0.04)] px-3 py-1 text-xs text-[var(--text-muted)]">
            {count} total
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ProspectModal onCreated={() => void refresh()} />
          <CsvImportModal onImported={() => void refresh()} />
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--text-muted)]" />
            <Input
              className="w-64 pl-9"
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
              placeholder="Search prospects"
              value={search}
            />
          </div>
        </div>
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
              key={pill.label}
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
                    <th className="px-3 py-3">Name</th>
                    <th className="px-3 py-3">Phone</th>
                    <th className="px-3 py-3">Company</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Calls</th>
                    <th className="px-3 py-3">Last Called</th>
                    <th className="px-3 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td className="px-3 py-10 text-center text-sm text-[var(--text-muted)]" colSpan={7}>
                        No prospects found.
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => (
                      <tr
                        className="cursor-pointer border-b border-[var(--line)] text-sm transition-all hover:bg-[rgba(56,182,255,0.08)] hover:shadow-[inset_0_0_0_1px_rgba(56,182,255,0.45)]"
                        key={row.id}
                        onClick={() => void loadDetail(row.id)}
                      >
                        <td className="px-3 py-3">{row.contact_name || "Unknown"}</td>
                        <td className="px-3 py-3" data-mono="true">
                          {row.phone}
                        </td>
                        <td className="px-3 py-3">{row.company_name || "-"}</td>
                        <td className="px-3 py-3">
                          <StatusBadge status={row.status} />
                        </td>
                        <td className="px-3 py-3">{row.total_calls}</td>
                        <td className="px-3 py-3 text-[var(--text-muted)]">{formatDateTime(row.last_called_at)}</td>
                        <td
                          className="px-3 py-3"
                          onClick={(event) => {
                            event.stopPropagation();
                          }}
                        >
                          <div className="flex gap-1">
                            <Button
                              onClick={() => void callNow(row.id, row.phone, row.contact_name)}
                              size="icon"
                              title="Call now"
                              variant="outline"
                            >
                              <PhoneCall className="h-4 w-4" />
                            </Button>
                            <Button
                              onClick={() => openSchedule(row.id)}
                              size="icon"
                              title="Schedule followup"
                              variant="outline"
                            >
                              <CalendarPlus className="h-4 w-4" />
                            </Button>
                            <Button onClick={() => void markDnc(row.id)} size="icon" title="Mark DNC" variant="outline">
                              <Ban className="h-4 w-4" />
                            </Button>
                            <Button onClick={() => void deleteProspect(row.id)} size="icon" title="Delete" variant="danger">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
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
              <Button
                disabled={page <= 1}
                onClick={() => {
                  setPage((prev) => Math.max(prev - 1, 1));
                }}
                variant="outline"
              >
                Previous
              </Button>
              <Button
                disabled={page >= totalPages}
                onClick={() => {
                  setPage((prev) => prev + 1);
                }}
                variant="outline"
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div
        className={`fixed inset-0 z-40 transition-all ${selected ? "pointer-events-auto bg-black/65 backdrop-blur-sm" : "pointer-events-none bg-transparent"}`}
        onClick={() => setDetail(null)}
      />
      <aside
        className={`fixed right-0 top-0 z-50 h-screen w-[min(620px,95vw)] border-l border-[var(--line)] bg-[rgba(6,10,18,0.96)] p-5 shadow-[0_0_50px_rgba(0,0,0,0.7)] backdrop-blur-xl transition-transform duration-300 ${
          selected ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold text-white">{selected?.contact_name || "Prospect Detail"}</h2>
            {selected ? <StatusBadge status={selected.status} /> : null}
          </div>
          <Button onClick={() => setDetail(null)} size="icon" variant="outline">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {detailLoading ? (
          <div className="space-y-2">
            <LoadingSkeleton className="h-10 w-full" />
            <LoadingSkeleton className="h-10 w-full" />
            <LoadingSkeleton className="h-10 w-full" />
          </div>
        ) : selected ? (
          <div className="space-y-5">
            <Button className="w-full" onClick={() => void callNow(selected.id, selected.phone, selected.contact_name)}>
              <PhoneCall className="mr-2 h-4 w-4" />
              Call Now
            </Button>

            {latestCall?.analytics ? (
              <div className="rounded-2xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm text-white">Latest Call Timeline</p>
                  <span className="text-xs text-[var(--text-muted)]">
                    {stageLabel(latestCall.analytics.stage_reached)} | {formatDuration(latestCall.duration_seconds)}
                  </span>
                </div>
                <div className="relative h-2 rounded-full bg-[rgba(255,255,255,0.08)]">
                  {(latestCall.analytics.timeline || []).map((event) => {
                    const duration = Math.max(Number(latestCall.duration_seconds || 0), 1);
                    const left = Math.max(0, Math.min(100, (event.offset_seconds / duration) * 100));
                    return (
                      <span
                        className={`absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border border-black ${dotTone(event.tone)}`}
                        key={event.id}
                        style={{ left: `calc(${left}% - 5px)` }}
                        title={`${event.label}: ${event.detail}`}
                      />
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  Failed at {stageLabel(latestCall.analytics.failure_stage || latestCall.analytics.stage_reached)} -{" "}
                  {stageLabel(latestCall.analytics.failure_reason)}
                </p>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-2">
              <label className="text-xs text-[var(--text-muted)]">Name</label>
              <Input onChange={(event) => updateDetailField("contact_name", event.target.value)} value={selected.contact_name || ""} />
              <label className="text-xs text-[var(--text-muted)]">Phone</label>
              <Input onChange={(event) => updateDetailField("phone", event.target.value)} value={selected.phone} />
              <label className="text-xs text-[var(--text-muted)]">Email</label>
              <Input onChange={(event) => updateDetailField("email", event.target.value)} value={selected.email || ""} />
              <label className="text-xs text-[var(--text-muted)]">Company</label>
              <Input onChange={(event) => updateDetailField("company_name", event.target.value)} value={selected.company_name || ""} />
              <label className="text-xs text-[var(--text-muted)]">Source</label>
              <Input onChange={(event) => updateDetailField("source", event.target.value)} value={selected.source || ""} />
              <label className="text-xs text-[var(--text-muted)]">Status</label>
              <Select onChange={(event) => updateDetailField("status", event.target.value)} value={selected.status}>
                {allStatuses.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
            </div>

            <Button disabled={savingDetail} onClick={saveDetail} variant="outline">
              {savingDetail ? "Saving..." : "Save Changes"}
            </Button>

            <Tabs onValueChange={setActiveTab} value={activeTab}>
              <TabsList>
                <TabsTrigger value="calls">Call History</TabsTrigger>
                <TabsTrigger value="objections">Objections</TabsTrigger>
                <TabsTrigger value="payments">Payments</TabsTrigger>
                <TabsTrigger value="followups">Followups</TabsTrigger>
              </TabsList>

              <TabsContent value="calls">
                <div className="space-y-2">
                  {detail?.calls.length ? (
                    detail.calls.map((call) => (
                      <div className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] p-3" key={call.id}>
                        <div className="mb-1 flex items-center justify-between">
                          <StatusBadge status={call.outcome} />
                          <span className="text-xs text-[var(--text-muted)]">
                            {formatDateTime(call.started_at)} | {formatDuration(call.duration_seconds)}
                          </span>
                        </div>
                        {call.analytics ? (
                          <p className="mb-1 text-xs text-[var(--text-muted)]">
                            Stage: {stageLabel(call.analytics.stage_reached)} | Reason: {stageLabel(call.analytics.failure_reason)}
                          </p>
                        ) : null}
                        <p className="text-sm text-[var(--text-muted)]">{safeText(call.summary) || "No summary"}</p>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-[var(--text-muted)]">No calls yet.</p>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="objections">
                <div className="space-y-2">
                  {detail?.objections.length ? (
                    detail.objections.map((obj) => (
                      <div className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] p-3" key={obj.id}>
                        <p className="font-medium text-white">{safeText(obj.objection_type)}</p>
                        <p className="text-sm text-[var(--text-muted)]">{safeText(obj.prospect_statement) || "-"}</p>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-[var(--text-muted)]">No objections logged.</p>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="payments">
                <div className="space-y-2">
                  {detail?.payments.length ? (
                    detail.payments.map((payment) => (
                      <div className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] p-3" key={payment.id}>
                        <div className="mb-1 flex items-center justify-between">
                          <StatusBadge status={payment.status} />
                          <span className="text-sm text-white">{cents(payment.amount_cents)}</span>
                        </div>
                        <p className="text-xs text-[var(--text-muted)]">{formatDateTime(payment.created_at)}</p>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-[var(--text-muted)]">No payments yet.</p>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="followups">
                <div className="mb-2">
                  <Button onClick={() => openSchedule(selected.id)} size="sm">
                    <CalendarPlus className="mr-2 h-4 w-4" />
                    Schedule Followup
                  </Button>
                </div>
                <div className="space-y-2">
                  {detail?.followups.length ? (
                    detail.followups.map((followup) => (
                      <div className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] p-3" key={followup.id}>
                        <div className="mb-1 flex items-center justify-between">
                          <StatusBadge status={followup.status} />
                          <span className="text-xs text-[var(--text-muted)]">{formatDateTime(followup.scheduled_at)}</span>
                        </div>
                        <p className="text-sm text-[var(--text-muted)]">{safeText(followup.reason) || "-"}</p>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-[var(--text-muted)]">No followups scheduled.</p>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">Select a prospect to inspect and update details.</p>
        )}
      </aside>

      {scheduleOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-[rgba(9,14,22,0.98)] p-5">
            <h3 className="text-lg font-semibold text-white">Schedule Follow-up</h3>
            <p className="mt-1 text-sm text-[var(--text-muted)]">Set callback date and reason.</p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs text-[var(--text-muted)]">Date / Time</label>
                <Input onChange={(event) => setScheduleDate(event.target.value)} type="datetime-local" value={scheduleDate} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--text-muted)]">Reason</label>
                <Input onChange={(event) => setScheduleReason(event.target.value)} value={scheduleReason} />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button onClick={() => setScheduleOpen(false)} variant="outline">
                Cancel
              </Button>
              <Button onClick={() => void scheduleFollowup()}>Save Follow-up</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
