"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, PlayCircle } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { LoadingSkeleton } from "@/components/loading-skeleton";
import { formatDateTime, formatDuration, safeText } from "@/lib/utils";

type CallProspect = {
  contact_name: string | null;
  company_name: string | null;
  phone: string | null;
};

type TranscriptMessage = {
  role: string;
  text: string;
  time: string | null;
};

type CallTimelineEvent = {
  id: string;
  label: string;
  detail: string;
  tone: "blue" | "green" | "amber" | "red" | "gray";
  offset_seconds: number;
  timestamp: string | null;
};

type CallAnalytics = {
  stage_reached: "pitch" | "objections" | "closing" | "closed";
  failure_stage: "pitch" | "objections" | "closing" | null;
  failure_reason: string | null;
  objections_count: number;
  objections_overcome: number;
  email_collected: boolean;
  payment_sent: boolean;
  payment_completed: boolean;
  timeline: CallTimelineEvent[];
};

type CallRow = {
  id: string;
  prospect_id: string | null;
  retell_call_id: string | null;
  phone: string | null;
  outcome: string | null;
  transcript:
    | string
    | Array<{
        role?: string;
        message?: string;
        text?: string;
        content?: string;
        time?: number;
      }>
    | Record<string, unknown>
    | null;
  recording_url: string | null;
  summary: string | null;
  duration_seconds: number | null;
  started_at: string | null;
  created_at: string;
  prospects: CallProspect | CallProspect[] | null;
  analytics?: CallAnalytics;
};

type CallsResponse = {
  data: CallRow[] | null;
  error: string | null;
  count: number | null;
};

const outcomeOptions = ["", "connected", "voicemail", "no_answer", "closed", "error", "busy", "rejected", "followup"];

const stageTone: Record<CallAnalytics["stage_reached"], string> = {
  pitch: "border-[rgba(255,68,68,0.4)] bg-[rgba(255,68,68,0.15)] text-[#ffb4b4]",
  objections: "border-[rgba(255,184,0,0.45)] bg-[rgba(255,184,0,0.14)] text-[#ffd995]",
  closing: "border-[rgba(56,182,255,0.42)] bg-[rgba(56,182,255,0.16)] text-[#bde9ff]",
  closed: "border-[rgba(0,255,136,0.4)] bg-[rgba(0,255,136,0.14)] text-[#9dffd2]",
};

function pickProspect(value: CallProspect | CallProspect[] | null) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function stageLabel(value: string | null | undefined) {
  if (!value) return "-";
  return value
    .replaceAll("_", " ")
    .split(" ")
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function formatClock(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function toneDot(tone: CallTimelineEvent["tone"]) {
  if (tone === "green") return "bg-[var(--green)]";
  if (tone === "amber") return "bg-[var(--amber)]";
  if (tone === "red") return "bg-[var(--red)]";
  if (tone === "gray") return "bg-[var(--text-muted)]";
  return "bg-[var(--brand-1)]";
}

function normalizeTranscript(input: CallRow["transcript"]): TranscriptMessage[] {
  if (!input) return [];
  if (typeof input === "string") {
    return [{ role: "assistant", text: input, time: null }];
  }
  if (Array.isArray(input)) {
    return input
      .map((item) => ({
        role: item.role || "assistant",
        text: item.message || item.text || item.content || "",
        time: typeof item.time === "number" ? `${Math.floor(item.time / 60)}:${String(Math.floor(item.time % 60)).padStart(2, "0")}` : null,
      }))
      .filter((item) => item.text.trim().length > 0);
  }
  const raw = input as Record<string, unknown>;
  const nested = raw.messages;
  if (Array.isArray(nested)) {
    return nested
      .map((item) => {
        const row = item as Record<string, unknown>;
        const text =
          typeof row.message === "string"
            ? row.message
            : typeof row.text === "string"
              ? row.text
              : typeof row.content === "string"
                ? row.content
                : "";
        const role = typeof row.role === "string" ? row.role : "assistant";
        const time = typeof row.time === "number" ? `${Math.floor(row.time / 60)}:${String(Math.floor(row.time % 60)).padStart(2, "0")}` : null;
        return { role, text, time };
      })
      .filter((item) => item.text.trim().length > 0);
  }
  return [];
}

export default function CallsPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<CallRow[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [outcome, setOutcome] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [expandedRecording, setExpandedRecording] = useState<string | null>(null);
  const [expandedTranscript, setExpandedTranscript] = useState<string | null>(null);
  const [expandedTimeline, setExpandedTimeline] = useState<string | null>(null);

  const pageSize = 20;
  const totalPages = Math.max(Math.ceil(count / pageSize), 1);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const response = await fetch(
          `/api/dashboard/calls?page=${page}&limit=${pageSize}&outcome=${encodeURIComponent(outcome)}&dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}&sortBy=created_at&sortDirection=desc`,
          { cache: "no-store" }
        );
        const payload = (await response.json()) as CallsResponse;
        if (!response.ok || payload.error) throw new Error(payload.error || "Failed to load calls.");
        setRows(payload.data || []);
        setCount(payload.count || 0);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load calls.");
      } finally {
        setLoading(false);
      }
    },
    [page, pageSize, outcome, dateFrom, dateTo]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => void load(true), 30000);
    return () => window.clearInterval(id);
  }, [load]);

  const transcriptMap = useMemo(
    () =>
      rows.reduce<Record<string, TranscriptMessage[]>>((acc, row) => {
        acc[row.id] = normalizeTranscript(row.transcript);
        return acc;
      }, {}),
    [rows]
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-white">Calls</h1>
          <p className="text-sm text-[var(--text-muted)]">Review call outcomes, recordings, and transcripts.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select
            onChange={(event) => {
              setPage(1);
              setOutcome(event.target.value);
            }}
            value={outcome}
          >
            <option value="">All outcomes</option>
            {outcomeOptions.filter(Boolean).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
          <Input
            onChange={(event) => {
              setPage(1);
              setDateFrom(event.target.value);
            }}
            type="date"
            value={dateFrom}
          />
          <Input
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
        </div>
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
              <table className="w-full min-w-[1240px]">
                <thead>
                  <tr className="border-b border-[var(--line)] bg-[rgba(255,255,255,0.03)] text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">
                    <th className="px-3 py-3">Prospect</th>
                    <th className="px-3 py-3">Phone</th>
                    <th className="px-3 py-3">Outcome</th>
                    <th className="px-3 py-3">Stage</th>
                    <th className="px-3 py-3">Duration</th>
                    <th className="px-3 py-3">Date</th>
                    <th className="px-3 py-3">Recording</th>
                    <th className="px-3 py-3">Transcript</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td className="px-3 py-10 text-center text-sm text-[var(--text-muted)]" colSpan={8}>
                        No calls found.
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => {
                      const prospect = pickProspect(row.prospects);
                      const showRecording = expandedRecording === row.id;
                      const showTranscript = expandedTranscript === row.id;
                      const showTimeline = expandedTimeline === row.id;
                      const transcript = transcriptMap[row.id] || [];
                      const stage = row.analytics?.stage_reached || "pitch";
                      const timeline = row.analytics?.timeline || [];
                      const durationForTimeline = Math.max(Number(row.duration_seconds || 0), 1);

                      return (
                        <Fragment key={row.id}>
                          <tr
                            className="border-b border-[var(--line)] text-sm transition-all hover:bg-[rgba(56,182,255,0.08)] hover:shadow-[inset_0_0_0_1px_rgba(56,182,255,0.45)]"
                          >
                            <td className="px-3 py-3">{prospect?.contact_name || prospect?.company_name || "Unknown"}</td>
                            <td className="px-3 py-3" data-mono="true">
                              {row.phone || prospect?.phone || "-"}
                            </td>
                            <td className="px-3 py-3">
                              <StatusBadge status={row.outcome} />
                            </td>
                            <td className="px-3 py-3">
                              <button
                                className={`rounded-full border px-2 py-1 text-[11px] font-medium transition-all hover:brightness-110 ${stageTone[stage]}`}
                                onClick={() => setExpandedTimeline((prev) => (prev === row.id ? null : row.id))}
                                type="button"
                              >
                                {stageLabel(stage)}
                              </button>
                            </td>
                            <td className="px-3 py-3">{formatDuration(row.duration_seconds)}</td>
                            <td className="px-3 py-3 text-[var(--text-muted)]">{formatDateTime(row.started_at || row.created_at)}</td>
                            <td className="px-3 py-3">
                              <Button
                                disabled={!row.recording_url}
                                onClick={() => setExpandedRecording((prev) => (prev === row.id ? null : row.id))}
                                size="sm"
                                variant="outline"
                              >
                                <PlayCircle className="mr-1 h-4 w-4" />
                                {showRecording ? "Hide" : "Play"}
                              </Button>
                            </td>
                            <td className="px-3 py-3">
                              <Button
                                onClick={() => setExpandedTranscript((prev) => (prev === row.id ? null : row.id))}
                                size="sm"
                                variant="outline"
                              >
                                {showTranscript ? <ChevronUp className="mr-1 h-4 w-4" /> : <ChevronDown className="mr-1 h-4 w-4" />}
                                {showTranscript ? "Collapse" : "Expand"}
                              </Button>
                            </td>
                          </tr>

                          {showRecording ? (
                            <tr className="border-b border-[var(--line)] bg-[rgba(56,182,255,0.08)]">
                              <td className="px-3 py-3" colSpan={8}>
                                {row.recording_url ? (
                                  <div className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.03)] p-3">
                                    <div className="mb-2 flex h-7 items-end gap-1">
                                      {Array.from({ length: 8 }).map((_, index) => (
                                        <span
                                          className="wave-bar w-1 rounded-full bg-gradient-to-t from-[#38B6FF] to-[#00D4FF]"
                                          key={`${row.id}-wave-${index}`}
                                          style={{ animationDelay: `${index * 120}ms` }}
                                        />
                                      ))}
                                    </div>
                                    <audio className="w-full" controls src={row.recording_url}>
                                      Your browser does not support audio playback.
                                    </audio>
                                  </div>
                                ) : (
                                  <p className="text-sm text-[var(--text-muted)]">No recording available.</p>
                                )}
                              </td>
                            </tr>
                          ) : null}

                          {showTranscript ? (
                            <tr className="border-b border-[var(--line)] bg-[rgba(255,255,255,0.02)]">
                              <td className="px-3 py-3" colSpan={8}>
                                {transcript.length === 0 ? (
                                  <p className="text-sm text-[var(--text-muted)]">No transcript available.</p>
                                ) : (
                                  <div className="space-y-2">
                                    {transcript.map((item, index) => {
                                      const isAgent = item.role.toLowerCase().includes("assistant") || item.role.toLowerCase().includes("agent");
                                      return (
                                        <div
                                          className={`max-w-[85%] rounded-2xl border px-3 py-2 ${
                                            isAgent
                                              ? "ml-auto border-[#0f5aa7] bg-[rgba(56,182,255,0.18)] text-[#c6ecff]"
                                              : "border-[var(--line)] bg-[rgba(255,255,255,0.05)] text-[var(--text-main)]"
                                          }`}
                                          key={`${row.id}-${index}`}
                                        >
                                          <div className="mb-1 flex items-center justify-between gap-4 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                                            <span>{item.role}</span>
                                            <span>{item.time || "-"}</span>
                                          </div>
                                          <p className="text-sm">{safeText(item.text)}</p>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </td>
                            </tr>
                          ) : null}

                          {showTimeline ? (
                            <tr className="border-b border-[var(--line)] bg-[rgba(255,255,255,0.02)]">
                              <td className="px-3 py-3" colSpan={8}>
                                {timeline.length === 0 ? (
                                  <p className="text-sm text-[var(--text-muted)]">No stage timeline available.</p>
                                ) : (
                                  <div className="space-y-3 rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.03)] p-3">
                                    <p className="text-sm text-[var(--text-muted)]">
                                      Failed stage: {stageLabel(row.analytics?.failure_stage || row.analytics?.stage_reached || stage)} | Reason:{" "}
                                      {stageLabel(row.analytics?.failure_reason)}
                                    </p>
                                    <div className="relative h-2 rounded-full bg-[rgba(255,255,255,0.08)]">
                                      {timeline.map((event) => {
                                        const left = Math.max(
                                          0,
                                          Math.min(100, (event.offset_seconds / durationForTimeline) * 100)
                                        );
                                        return (
                                          <span
                                            className={`absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border border-black ${toneDot(
                                              event.tone
                                            )}`}
                                            key={event.id}
                                            style={{ left: `calc(${left}% - 6px)` }}
                                            title={`${event.label} (${formatClock(event.offset_seconds)})`}
                                          />
                                        );
                                      })}
                                    </div>
                                    <div className="flex justify-between text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                                      <span>0:00</span>
                                      <span>{formatClock(durationForTimeline)}</span>
                                    </div>
                                    <div className="space-y-1.5">
                                      {timeline.map((event) => (
                                        <div className="flex items-start gap-2" key={`${row.id}-${event.id}`}>
                                          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${toneDot(event.tone)}`} />
                                          <div className="min-w-0 flex-1">
                                            <p className="text-sm text-white">{safeText(event.label)}</p>
                                            <p className="text-xs text-[var(--text-muted)]">{safeText(event.detail)}</p>
                                          </div>
                                          <span className="text-xs text-[var(--text-muted)]">{formatClock(event.offset_seconds)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
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
