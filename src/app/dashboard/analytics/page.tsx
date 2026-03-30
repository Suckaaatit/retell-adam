"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChartColumn, RefreshCw } from "lucide-react";
import { Bar, BarChart, Cell, Pie, PieChart, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingSkeleton, TableLoadingSkeleton } from "@/components/loading-skeleton";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { formatDateTime, formatDuration, formatCurrencyFromCents, safeText } from "@/lib/utils";

type Tone = "green" | "blue" | "amber" | "red";
type RangePreset = "today" | "week" | "month" | "custom";
type PropertyType = "all" | "condo" | "retirement_home" | "hotel" | "commercial" | "unknown";

type TimelineEvent = {
  id: string;
  label: string;
  detail: string;
  tone: "blue" | "green" | "amber" | "red" | "gray";
  offset_seconds: number;
  timestamp: string | null;
};

type BucketMember = {
  call_id: string;
  prospect_id: string | null;
  prospect_name: string;
  company_name: string;
  phone: string | null;
  stage_reached: string;
  failure_reason: string | null;
  outcome: string | null;
  duration_label: string;
  started_at: string | null;
};

type HeatmapRow = {
  category_id: number;
  category_label: string;
  category_key: string;
  frequency: number;
  overcome_count: number;
  kill_count: number;
  overcome_rate: number;
  kill_rate: number;
  specific_objections: Array<{
    text: string;
    count: number;
    overcome_count: number;
    kill_count: number;
  }>;
  failed_examples: Array<{
    call_id: string;
    prospect_name: string;
    company_name: string;
    statement: string;
    ai_response: string;
    result: string;
  }>;
};

type AnalyticsCall = {
  call_id: string;
  prospect_id: string | null;
  prospect_name: string;
  company_name: string;
  phone: string | null;
  property_type: string;
  outcome: string | null;
  duration_seconds: number;
  duration_label: string;
  started_at: string | null;
  recording_url: string | null;
  summary: string | null;
  stage_reached: "pitch" | "objections" | "closing" | "closed";
  failure_stage: "pitch" | "objections" | "closing" | null;
  failure_reason: string | null;
  objections_count: number;
  objections_overcome: number;
  objection_categories: Array<{ id: number; key: string; label: string }>;
  email_collected: boolean;
  payment_sent: boolean;
  payment_completed: boolean;
  timeline: TimelineEvent[];
};

type AnalyticsData = {
  generated_at: string;
  range: {
    preset: RangePreset;
    date_from: string;
    date_to: string;
    property_type_filter: string;
  };
  totals: {
    all_calls: number;
    reached_prospect: number;
    engaged: number;
    interested: number;
    closed_paid: number;
    total_revenue_cents: number;
    plan_650_count: number;
    plan_1100_count: number;
    pending_payment_count: number;
  };
  funnel: {
    all_calls: number;
    no_answer: number;
    voicemail: number;
    wrong_number: number;
    reached_prospect: number;
    hung_up_pitch: number;
    hard_no_pitch: number;
    gatekeeper_block: number;
    engaged: number;
    lost_to_objection: number;
    scheduled_followup: number;
    referred_elsewhere: number;
    interested: number;
    backed_out_close: number;
    payment_pending: number;
    payment_failed: number;
    closed_paid: number;
  };
  stage_rates: {
    pitch_success_rate: number;
    objection_overcome_rate: number;
    close_rate: number;
    email_to_payment_rate: number;
    pitch_breakdown: { engaged: number; hung_up: number; hard_no: number; gatekeeper_block: number };
    objection_breakdown: { overcame: number; lost: number; followup: number; referred: number };
    closing_breakdown: { paid: number; pending: number; failed: number; backed_out: number };
  };
  bucket_members: Record<string, BucketMember[]>;
  objection_heatmap: HeatmapRow[];
  top_killer_category: {
    category_id: number;
    category_label: string;
    frequency: number;
    kill_count: number;
    kill_rate: number;
  } | null;
  calls: AnalyticsCall[];
  property_performance: Array<{ key: string; label: string; total: number; closed: number; rate: number }>;
  recommendations: Array<{ id: string; title: string; detail: string; tone: Tone }>;
  trend: { pitch_delta: number; objections_delta: number; close_delta: number };
};

type AnalyticsApiPayload = {
  data: AnalyticsData | null;
  error: string | null;
  count: number | null;
};

type SegmentConfig = {
  bucketId?: string;
  label: string;
  count: number;
  denominator: number;
  color: string;
};

const rangeOptions: Array<{ label: string; value: RangePreset }> = [
  { label: "Today", value: "today" },
  { label: "This Week", value: "week" },
  { label: "This Month", value: "month" },
  { label: "Custom", value: "custom" },
];

const propertyOptions: Array<{ label: string; value: PropertyType }> = [
  { label: "All Properties", value: "all" },
  { label: "Condos", value: "condo" },
  { label: "Retirement Homes", value: "retirement_home" },
  { label: "Hotels", value: "hotel" },
  { label: "Commercial", value: "commercial" },
  { label: "Unknown", value: "unknown" },
];

const bucketLabels: Record<string, string> = {
  no_answer: "No Answer",
  voicemail: "Voicemail",
  wrong_number: "Wrong Number",
  hung_up_pitch: "Hung Up During Pitch",
  hard_no_pitch: "Hard No at Pitch",
  gatekeeper_block: "Gatekeeper Block",
  lost_to_objection: "Lost to Objection",
  scheduled_followup: "Scheduled Follow-up",
  referred_elsewhere: "Referred Elsewhere",
  backed_out_close: "Backed Out at Close",
  payment_pending: "Payment Pending",
  payment_failed: "Payment Failed",
  closed_paid: "Closed - Paid",
};

const tonePill: Record<Tone, string> = {
  green: "border-[rgba(0,255,136,0.35)] bg-[rgba(0,255,136,0.12)] text-[#98ffd2]",
  blue: "border-[rgba(56,182,255,0.45)] bg-[rgba(56,182,255,0.12)] text-[#bde9ff]",
  amber: "border-[rgba(255,184,0,0.4)] bg-[rgba(255,184,0,0.12)] text-[#ffd98a]",
  red: "border-[rgba(255,68,68,0.4)] bg-[rgba(255,68,68,0.14)] text-[#ffb0b0]",
};

function percent(count: number, total: number) {
  if (!total) return 0;
  return Number(((count / total) * 100).toFixed(1));
}

function stageLabel(value: string | null | undefined) {
  if (!value) return "-";
  return value
    .replaceAll("_", " ")
    .split(" ")
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function toneClass(value: number, hardNo = false) {
  if (hardNo) return "text-[#bfc6d4]";
  if (value >= 65) return "text-[#87ffd0]";
  if (value >= 50) return "text-[#ffd88a]";
  return "text-[#ffafaf]";
}

function dotClass(tone: TimelineEvent["tone"]) {
  if (tone === "green") return "bg-[var(--green)]";
  if (tone === "amber") return "bg-[var(--amber)]";
  if (tone === "red") return "bg-[var(--red)]";
  if (tone === "gray") return "bg-[var(--text-muted)]";
  return "bg-[var(--brand-1)]";
}

function TrendChip({ value }: { value: number }) {
  const color = value > 0 ? "text-[#85ffd0]" : value < 0 ? "text-[#ffb0b0]" : "text-[var(--text-muted)]";
  const label = value > 0 ? `+${value}%` : `${value}%`;
  return <span className={`text-xs ${color}`}>{label} vs previous period</span>;
}

function BucketPreview({
  title,
  members,
  onClose,
}: {
  title: string;
  members: BucketMember[];
  onClose: () => void;
}) {
  return (
    <Card className="border-[var(--line-strong)]">
      <CardHeader className="items-center">
        <CardTitle>{title}</CardTitle>
        <Button onClick={onClose} size="sm" variant="outline">
          Close
        </Button>
      </CardHeader>
      <CardContent>
        {members.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No calls in this bucket for the selected range.</p>
        ) : (
          <div className="max-h-[260px] overflow-auto rounded-xl border border-[var(--line)]">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className="border-b border-[var(--line)] bg-[rgba(255,255,255,0.03)] text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">
                  <th className="px-3 py-2">Prospect</th>
                  <th className="px-3 py-2">Company</th>
                  <th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2">Stage</th>
                  <th className="px-3 py-2">Reason</th>
                  <th className="px-3 py-2">Duration</th>
                  <th className="px-3 py-2">Started</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr
                    className="border-b border-[var(--line)] text-sm transition-all hover:bg-[rgba(56,182,255,0.08)]"
                    key={member.call_id}
                  >
                    <td className="px-3 py-2">{safeText(member.prospect_name)}</td>
                    <td className="px-3 py-2">{safeText(member.company_name) || "-"}</td>
                    <td className="px-3 py-2" data-mono="true">
                      {member.phone || "-"}
                    </td>
                    <td className="px-3 py-2">{stageLabel(member.stage_reached)}</td>
                    <td className="px-3 py-2">{stageLabel(member.failure_reason)}</td>
                    <td className="px-3 py-2">{safeText(member.duration_label)}</td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">{formatDateTime(member.started_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FunnelSegment({
  segment,
  animate,
  onSelect,
}: {
  segment: SegmentConfig;
  animate: boolean;
  onSelect: (bucketId?: string) => void;
}) {
  const width = percent(segment.count, segment.denominator);
  return (
    <button
      className="w-full rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] px-3 py-2 text-left transition-all hover:border-[var(--line-strong)] hover:bg-[rgba(56,182,255,0.08)]"
      onClick={() => onSelect(segment.bucketId)}
      type="button"
    >
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-[var(--text-main)]">{segment.label}</span>
        <span className="text-[var(--text-muted)]">
          {segment.count} ({width}%)
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]">
        <div
          className="h-full rounded-full transition-[width] duration-700"
          style={{ backgroundColor: segment.color, width: `${animate ? width : 0}%` }}
        />
      </div>
    </button>
  );
}

export default function AnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [preset, setPreset] = useState<RangePreset>("week");
  const [propertyType, setPropertyType] = useState<PropertyType>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [animateBars, setAnimateBars] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError("");
      try {
        const query = new URLSearchParams();
        query.set("preset", preset);
        query.set("propertyType", propertyType);
        if (preset === "custom") {
          if (dateFrom) query.set("dateFrom", dateFrom);
          if (dateTo) query.set("dateTo", dateTo);
        }

        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 15000);
        const response = await fetch(`/api/dashboard/analytics?${query.toString()}`, { cache: "no-store", signal: controller.signal }).finally(() => window.clearTimeout(timeout));
        const payload = (await response.json()) as AnalyticsApiPayload;
        const analyticsData = payload.data;
        if (!response.ok || payload.error || !analyticsData) {
          throw new Error(payload.error || "Failed to load analytics.");
        }
        setData(analyticsData);
        setSelectedCategoryId((prev) =>
          prev === null ? (analyticsData.objection_heatmap[0]?.category_id ?? null) : prev
        );
        setSelectedCallId((prev) => (prev === null ? (analyticsData.calls[0]?.call_id ?? null) : prev));
        setAnimateBars(false);
        window.setTimeout(() => setAnimateBars(true), 40);
      } catch (error) {
        const message = error instanceof DOMException && error.name === "AbortError"
          ? "Analytics request timed out. Try a narrower date range or refresh."
          : error instanceof Error ? error.message : "Failed to load analytics.";
        setError(message);
        toast.error(message);
      } finally {
        setLoading(false);
      }
    },
    [preset, propertyType, dateFrom, dateTo]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => void load(true), 30000);
    return () => window.clearInterval(id);
  }, [load]);

  const selectedCategory = useMemo(
    () => data?.objection_heatmap.find((row) => row.category_id === selectedCategoryId) || null,
    [data, selectedCategoryId]
  );

  const selectedCall = useMemo(
    () => data?.calls.find((row) => row.call_id === selectedCallId) || data?.calls[0] || null,
    [data, selectedCallId]
  );

  useEffect(() => {
    if (!data) return;
    if (selectedCategoryId && data.objection_heatmap.some((row) => row.category_id === selectedCategoryId)) return;
    setSelectedCategoryId(data.objection_heatmap[0]?.category_id || null);
  }, [data, selectedCategoryId]);

  useEffect(() => {
    if (!data) return;
    if (selectedCallId && data.calls.some((row) => row.call_id === selectedCallId)) return;
    setSelectedCallId(data.calls[0]?.call_id || null);
  }, [data, selectedCallId]);

  const pitchDonut = useMemo(() => {
    if (!data) return [];
    return [
      { name: "Engaged", value: data.stage_rates.pitch_breakdown.engaged, fill: "#38B6FF" },
      { name: "Hung Up", value: data.stage_rates.pitch_breakdown.hung_up, fill: "#FF4444" },
      { name: "Hard No", value: data.stage_rates.pitch_breakdown.hard_no, fill: "#D94A4A" },
      { name: "Gatekeeper", value: data.stage_rates.pitch_breakdown.gatekeeper_block, fill: "#FFB800" },
    ];
  }, [data]);

  const closingDonut = useMemo(() => {
    if (!data) return [];
    return [
      { name: "Paid", value: data.stage_rates.closing_breakdown.paid, fill: "#00FF88" },
      { name: "Pending", value: data.stage_rates.closing_breakdown.pending, fill: "#FFB800" },
      { name: "Failed", value: data.stage_rates.closing_breakdown.failed, fill: "#FF4444" },
      { name: "Backed Out", value: data.stage_rates.closing_breakdown.backed_out, fill: "#A666FF" },
    ];
  }, [data]);

  const objectionBar = useMemo(() => {
    if (!data) return [];
    return data.objection_heatmap.slice(0, 7).map((row) => ({
      name: `${row.category_id}`,
      label: row.category_label,
      value: row.frequency,
    }));
  }, [data]);

  const funnelData = useMemo(() => {
    if (!data) return null;
    const totalCalls = Math.max(1, data.funnel.all_calls);
    const reachedProspect = Math.max(1, data.funnel.reached_prospect);
    const engaged = Math.max(1, data.funnel.engaged);
    const interested = Math.max(1, data.funnel.interested);
    return {
      stage0: [
        { bucketId: "no_answer", label: "No Answer", count: data.funnel.no_answer, denominator: totalCalls, color: "#6f7f90" },
        { bucketId: "voicemail", label: "Voicemail", count: data.funnel.voicemail, denominator: totalCalls, color: "#708ca7" },
        { bucketId: "wrong_number", label: "Wrong Number", count: data.funnel.wrong_number, denominator: totalCalls, color: "#8f99a3" },
      ] as SegmentConfig[],
      stage1: [
        { bucketId: "hung_up_pitch", label: "Hung Up During Pitch", count: data.funnel.hung_up_pitch, denominator: reachedProspect, color: "#FF4444" },
        { bucketId: "hard_no_pitch", label: "Hard No at Pitch", count: data.funnel.hard_no_pitch, denominator: reachedProspect, color: "#D94A4A" },
        { bucketId: "gatekeeper_block", label: "Gatekeeper Block", count: data.funnel.gatekeeper_block, denominator: reachedProspect, color: "#FFB800" },
      ] as SegmentConfig[],
      stage2: [
        { bucketId: "lost_to_objection", label: "Lost to Objection", count: data.funnel.lost_to_objection, denominator: engaged, color: "#FF4444" },
        { bucketId: "scheduled_followup", label: "Scheduled Follow-up", count: data.funnel.scheduled_followup, denominator: engaged, color: "#FFB800" },
        { bucketId: "referred_elsewhere", label: "Referred Elsewhere", count: data.funnel.referred_elsewhere, denominator: engaged, color: "#38B6FF" },
      ] as SegmentConfig[],
      stage3: [
        { bucketId: "backed_out_close", label: "Backed Out", count: data.funnel.backed_out_close, denominator: interested, color: "#FF4444" },
        { bucketId: "payment_pending", label: "Payment Pending", count: data.funnel.payment_pending, denominator: interested, color: "#FFB800" },
        { bucketId: "payment_failed", label: "Payment Failed", count: data.funnel.payment_failed, denominator: interested, color: "#DB5D5D" },
      ] as SegmentConfig[],
    };
  }, [data]);

  const selectedBucketMembers = selectedBucket ? data?.bucket_members[selectedBucket] || [] : [];
  const selectedBucketTitle = selectedBucket ? bucketLabels[selectedBucket] || selectedBucket : "";

  const jumpToTime = (seconds: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = seconds;
    void audioRef.current.play().catch(() => undefined);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-white">Call Analytics</h1>
          <p className="text-sm text-[var(--text-muted)]">Where calls win, where they break, and what to improve next.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select onChange={(event) => setPreset(event.target.value as RangePreset)} value={preset}>
            {rangeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <Select onChange={(event) => setPropertyType(event.target.value as PropertyType)} value={propertyType}>
            {propertyOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          {preset === "custom" ? (
            <>
              <Input onChange={(event) => setDateFrom(event.target.value)} type="date" value={dateFrom} />
              <Input onChange={(event) => setDateTo(event.target.value)} type="date" value={dateTo} />
            </>
          ) : null}
          <Button onClick={() => void load()} variant="outline">
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-[rgba(255,68,68,0.45)] bg-[rgba(255,68,68,0.12)] px-4 py-3 text-sm text-[#ffc4c4]">
          {error}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ChartColumn className="h-4 w-4 text-[var(--brand-1)]" />
            Workflow Funnel
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <TableLoadingSkeleton rows={8} />
          ) : !funnelData || !data ? (
            <p className="text-sm text-[var(--text-muted)]">
              {error || "No analytics data for the selected filters."}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-4">
                <div className="rounded-xl border border-[var(--line)] bg-[rgba(56,182,255,0.08)] p-3">
                  <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">All Calls</p>
                  <p className="mt-1 text-2xl font-semibold text-white">{data.funnel.all_calls}</p>
                  <p className="text-xs text-[var(--text-muted)]">{percent(data.funnel.reached_prospect, data.funnel.all_calls)}% reached prospect</p>
                </div>
                <div className="rounded-xl border border-[var(--line)] bg-[rgba(56,182,255,0.08)] p-3">
                  <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Engaged</p>
                  <p className="mt-1 text-2xl font-semibold text-white">{data.funnel.engaged}</p>
                  <p className="text-xs text-[var(--text-muted)]">{percent(data.funnel.engaged, data.funnel.reached_prospect)}% past pitch</p>
                </div>
                <div className="rounded-xl border border-[var(--line)] bg-[rgba(56,182,255,0.08)] p-3">
                  <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Interested</p>
                  <p className="mt-1 text-2xl font-semibold text-white">{data.funnel.interested}</p>
                  <p className="text-xs text-[var(--text-muted)]">{percent(data.funnel.interested, data.funnel.engaged)}% reached closing</p>
                </div>
                <div className="rounded-xl border border-[rgba(0,255,136,0.36)] bg-[rgba(0,255,136,0.1)] p-3">
                  <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Closed - Paid</p>
                  <p className="mt-1 text-2xl font-semibold text-[#9bffd1]">{data.funnel.closed_paid}</p>
                  <p className="text-xs text-[var(--text-muted)]">{percent(data.funnel.closed_paid, data.funnel.interested)}% close rate from closing</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] p-3">
                  <p className="mb-2 text-xs uppercase tracking-wide text-[var(--text-muted)]">Did Not Reach Prospect</p>
                  <div className="grid gap-2 md:grid-cols-3">
                    {funnelData.stage0.map((segment) => (
                      <FunnelSegment
                        animate={animateBars}
                        key={segment.label}
                        onSelect={(bucketId) => setSelectedBucket(bucketId || null)}
                        segment={segment}
                      />
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] p-3">
                  <p className="mb-2 text-xs uppercase tracking-wide text-[var(--text-muted)]">Failed at Pitch</p>
                  <div className="grid gap-2 md:grid-cols-3">
                    {funnelData.stage1.map((segment) => (
                      <FunnelSegment
                        animate={animateBars}
                        key={segment.label}
                        onSelect={(bucketId) => setSelectedBucket(bucketId || null)}
                        segment={segment}
                      />
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] p-3">
                  <p className="mb-2 text-xs uppercase tracking-wide text-[var(--text-muted)]">Objections Stage Outcomes</p>
                  <div className="grid gap-2 md:grid-cols-3">
                    {funnelData.stage2.map((segment) => (
                      <FunnelSegment
                        animate={animateBars}
                        key={segment.label}
                        onSelect={(bucketId) => setSelectedBucket(bucketId || null)}
                        segment={segment}
                      />
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] p-3">
                  <p className="mb-2 text-xs uppercase tracking-wide text-[var(--text-muted)]">Closing Stage Outcomes</p>
                  <div className="grid gap-2 md:grid-cols-3">
                    {funnelData.stage3.map((segment) => (
                      <FunnelSegment
                        animate={animateBars}
                        key={segment.label}
                        onSelect={(bucketId) => setSelectedBucket(bucketId || null)}
                        segment={segment}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {selectedBucket ? (
                <BucketPreview
                  members={selectedBucketMembers}
                  onClose={() => setSelectedBucket(null)}
                  title={selectedBucketTitle}
                />
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Pitch Stage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              <LoadingSkeleton className="h-[210px] w-full" />
            ) : !data ? (
              <p className="text-sm text-[var(--text-muted)]">{error || "No pitch data available."}</p>
            ) : (
              <>
                <p className="text-2xl font-semibold text-white">{data.stage_rates.pitch_success_rate}%</p>
                <TrendChip value={data.trend.pitch_delta} />
                <div className="h-[180px]">
                  <PieChart width={280} height={180}>
                    <Pie data={pitchDonut} cx="50%" cy="48%" dataKey="value" innerRadius={42} outerRadius={72} paddingAngle={2}>
                      {pitchDonut.map((entry) => (
                        <Cell fill={entry.fill} key={entry.name} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: "rgba(8,12,20,0.94)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12 }}
                      itemStyle={{ color: "#e8f6ff" }}
                      labelStyle={{ color: "#9fc8dd" }}
                    />
                  </PieChart>
                </div>
                <p className="text-xs text-[var(--text-muted)]">
                  {data.stage_rates.pitch_breakdown.hung_up} hung up during pitch. Test a shorter opening hook.
                </p>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Objection Stage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              <LoadingSkeleton className="h-[210px] w-full" />
            ) : !data ? (
              <p className="text-sm text-[var(--text-muted)]">{error || "No objection data available."}</p>
            ) : (
              <>
                <p className="text-2xl font-semibold text-white">{data.stage_rates.objection_overcome_rate}%</p>
                <TrendChip value={data.trend.objections_delta} />
                <div className="h-[180px]">
                  <BarChart width={280} height={180} data={objectionBar} layout="vertical" margin={{ top: 2, right: 12, left: 0, bottom: 2 }}>
                    <XAxis hide type="number" />
                    <YAxis axisLine={false} dataKey="name" tick={{ fill: "#8ca8bb", fontSize: 11 }} tickLine={false} type="category" width={28} />
                    <Tooltip
                      contentStyle={{
                        background: "rgba(8,12,20,0.94)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: 12,
                      }}
                    />
                    <Bar dataKey="value" fill="#38B6FF" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </div>
                <p className="text-xs text-[var(--text-muted)]">
                  Top blocker:{" "}
                  {data.top_killer_category
                    ? `${data.top_killer_category.category_id}. ${data.top_killer_category.category_label} (${data.top_killer_category.kill_rate}% kill rate)`
                    : "No objection data yet."}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Closing Stage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              <LoadingSkeleton className="h-[210px] w-full" />
            ) : !data ? (
              <p className="text-sm text-[var(--text-muted)]">{error || "No closing data available."}</p>
            ) : (
              <>
                <p className="text-2xl font-semibold text-white">{data.stage_rates.close_rate}%</p>
                <TrendChip value={data.trend.close_delta} />
                <div className="h-[180px]">
                  <PieChart width={280} height={180}>
                    <Pie
                      data={closingDonut}
                      cx="50%"
                      cy="48%"
                      dataKey="value"
                      innerRadius={42}
                      outerRadius={72}
                      paddingAngle={2}
                    >
                      {closingDonut.map((entry) => (
                        <Cell fill={entry.fill} key={entry.name} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: "rgba(8,12,20,0.94)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: 12,
                      }}
                      itemStyle={{ color: "#e8f6ff" }}
                      labelStyle={{ color: "#9fc8dd" }}
                    />
                  </PieChart>
                </div>
                <p className="text-xs text-[var(--text-muted)]">
                  Email to payment conversion: {data.stage_rates.email_to_payment_rate}%.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Objection Heatmap</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <TableLoadingSkeleton rows={9} />
          ) : !data ? (
            <p className="text-sm text-[var(--text-muted)]">{error || "No objection heatmap data."}</p>
          ) : data.objection_heatmap.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No objection data in the selected window.</p>
          ) : (
            <div className="overflow-auto rounded-2xl border border-[var(--line)]">
              <table className="w-full min-w-[980px]">
                <thead>
                  <tr className="border-b border-[var(--line)] bg-[rgba(255,255,255,0.03)] text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">
                    <th className="px-3 py-3">Objection Category</th>
                    <th className="px-3 py-3">Frequency</th>
                    <th className="px-3 py-3">Overcome</th>
                    <th className="px-3 py-3">Kill Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {data.objection_heatmap.map((row) => (
                    <tr
                      className={`cursor-pointer border-b border-[var(--line)] text-sm transition-all hover:bg-[rgba(56,182,255,0.08)] ${
                        selectedCategoryId === row.category_id ? "bg-[rgba(56,182,255,0.11)]" : ""
                      }`}
                      key={row.category_id}
                      onClick={() => setSelectedCategoryId(row.category_id)}
                    >
                      <td className="px-3 py-3">
                        {row.category_id}. {row.category_label}
                      </td>
                      <td className="px-3 py-3">{row.frequency}</td>
                      <td className="px-3 py-3">
                        {row.overcome_count} ({row.overcome_rate}%)
                      </td>
                      <td className={`px-3 py-3 font-medium ${toneClass(row.overcome_rate, row.category_id === 10)}`}>
                        {row.kill_count} ({row.kill_rate}%)
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>
              {selectedCategory
                ? `Category ${selectedCategory.category_id}: ${selectedCategory.category_label}`
                : "Objection Drilldown"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <LoadingSkeleton className="h-44 w-full" />
            ) : !selectedCategory ? (
              <p className="text-sm text-[var(--text-muted)]">
                {error || "No objection category is available for drilldown."}
              </p>
            ) : (
              <>
                <div className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] p-3">
                  <p className="text-sm text-[var(--text-muted)]">
                    {selectedCategory.frequency} occurrences | {selectedCategory.overcome_rate}% overcome rate
                  </p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    Top statements in this category and how often they were won vs lost.
                  </p>
                </div>

                <div className="space-y-2">
                  {selectedCategory.specific_objections.slice(0, 8).map((item) => (
                    <div
                      className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] p-3"
                      key={`${selectedCategory.category_id}-${item.text}`}
                    >
                      <p className="text-sm text-white">{safeText(item.text)}</p>
                      <p className="mt-1 text-xs text-[var(--text-muted)]">
                        {item.count} times | overcome {item.overcome_count} | killed {item.kill_count}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Failed Call Examples</p>
                  {selectedCategory.failed_examples.length === 0 ? (
                    <p className="text-sm text-[var(--text-muted)]">No failed examples captured for this category.</p>
                  ) : (
                    selectedCategory.failed_examples.slice(0, 4).map((example) => (
                      <div
                        className="rounded-xl border border-[rgba(255,68,68,0.28)] bg-[rgba(255,68,68,0.08)] p-3"
                        key={`${example.call_id}-${example.statement}`}
                      >
                        <p className="text-sm text-[#ffd6d6]">
                          {safeText(example.prospect_name)} - {safeText(example.company_name)}
                        </p>
                        <p className="mt-1 text-sm text-[#ffeaea]">&ldquo;{safeText(example.statement)}&rdquo;</p>
                        <p className="mt-1 text-xs text-[#ffd6d6]">Agent response: {safeText(example.ai_response)}</p>
                        <p className="mt-1 text-xs text-[#ffb0b0]">Result: {safeText(example.result)}</p>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Insights This Week</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              <TableLoadingSkeleton rows={6} />
            ) : !data ? (
              <p className="text-sm text-[var(--text-muted)]">{error || "No recommendations available."}</p>
            ) : data.recommendations.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No recommendations yet.</p>
            ) : (
              data.recommendations.map((insight) => (
                <div className={`rounded-xl border px-3 py-2 text-sm ${tonePill[insight.tone]}`} key={insight.id}>
                  <p className="font-medium">{safeText(insight.title)}</p>
                  <p className="mt-1 text-xs opacity-90">{safeText(insight.detail)}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader className="items-center">
          <CardTitle>Call Timeline View</CardTitle>
          {loading || !data ? null : (
            <Select
              onChange={(event) => setSelectedCallId(event.target.value)}
              value={selectedCall?.call_id || ""}
            >
              {(data.calls || []).map((call) => (
                <option key={call.call_id} value={call.call_id}>
                  {call.prospect_name} - {call.duration_label} - {stageLabel(call.stage_reached)}
                </option>
              ))}
            </Select>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <LoadingSkeleton className="h-56 w-full" />
          ) : !selectedCall ? (
            <p className="text-sm text-[var(--text-muted)]">{error || "No call timeline available."}</p>
          ) : (
            <>
              <div className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] p-3">
                <p className="text-sm text-white">
                  {selectedCall.prospect_name} - {selectedCall.company_name} - {selectedCall.duration_label}
                </p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Stage reached: {stageLabel(selectedCall.stage_reached)} | Failure reason: {stageLabel(selectedCall.failure_reason)}
                </p>
                {selectedCall.recording_url ? (
                  <audio className="mt-3 w-full" controls ref={audioRef} src={selectedCall.recording_url}>
                    Your browser does not support audio playback.
                  </audio>
                ) : null}
              </div>

              <div className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] p-4">
                <div className="relative h-2 rounded-full bg-[rgba(255,255,255,0.08)]">
                  {selectedCall.timeline.map((event) => {
                    const left = percent(event.offset_seconds, Math.max(selectedCall.duration_seconds, 1));
                    return (
                      <button
                        className={`absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border border-black ${dotClass(event.tone)} transition-transform hover:scale-110`}
                        key={event.id}
                        onClick={() => jumpToTime(event.offset_seconds)}
                        style={{ left: `calc(${left}% - 6px)` }}
                        title={`${event.label} (${formatDuration(event.offset_seconds)})`}
                        type="button"
                      />
                    );
                  })}
                </div>
                <div className="mt-3 flex justify-between text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                  <span>0:00</span>
                  <span>{selectedCall.duration_label}</span>
                </div>
              </div>

              <div className="space-y-2">
                {selectedCall.timeline.map((event) => (
                  <button
                    className="flex w-full items-start gap-3 rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] px-3 py-2 text-left transition-all hover:border-[var(--line-strong)] hover:bg-[rgba(56,182,255,0.08)]"
                    key={event.id}
                    onClick={() => jumpToTime(event.offset_seconds)}
                    type="button"
                  >
                    <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${dotClass(event.tone)}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white">{safeText(event.label)}</p>
                      <p className="text-xs text-[var(--text-muted)]">{safeText(event.detail)}</p>
                    </div>
                    <span className="text-xs text-[var(--text-muted)]">{formatDuration(event.offset_seconds)}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="items-center">
          <CardTitle>Summary</CardTitle>
          <Link
            className="inline-flex items-center gap-1 text-xs text-[#8ed5ff] transition-colors hover:text-[#c7ecff]"
            href="/dashboard/calls"
          >
            Open Calls
            <ArrowRight className="h-3 w-3" />
          </Link>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2 xl:grid-cols-4">
          {loading ? (
            <>
              <LoadingSkeleton className="h-14 w-full" />
              <LoadingSkeleton className="h-14 w-full" />
              <LoadingSkeleton className="h-14 w-full" />
              <LoadingSkeleton className="h-14 w-full" />
            </>
          ) : !data ? (
            <p className="text-sm text-[var(--text-muted)]">{error || "No summary data available."}</p>
          ) : (
            <>
              <div className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] p-3">
                <p className="text-xs text-[var(--text-muted)]">Total Calls</p>
                <p className="text-xl text-white">{data.totals.all_calls}</p>
              </div>
              <div className="rounded-xl border border-[rgba(0,255,136,0.32)] bg-[rgba(0,255,136,0.08)] p-3">
                <p className="text-xs text-[var(--text-muted)]">Closed Paid</p>
                <p className="text-xl text-[#9cffd2]">{data.totals.closed_paid}</p>
              </div>
              <div className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] p-3">
                <p className="text-xs text-[var(--text-muted)]">Pending Payments</p>
                <p className="text-xl text-[#ffd68e]">{data.totals.pending_payment_count}</p>
              </div>
              <div className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] p-3">
                <p className="text-xs text-[var(--text-muted)]">Collected Value</p>
                <p className="text-xl text-white">{formatCurrencyFromCents(data.totals.total_revenue_cents)}</p>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
