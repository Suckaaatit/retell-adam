"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Clock3, PhoneOutgoing, RefreshCw, Users } from "lucide-react";
import { Cell, Pie, PieChart, Tooltip } from "recharts";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LoadingSkeleton, TableLoadingSkeleton } from "@/components/loading-skeleton";
import { StatCard } from "@/components/stat-card";
import { safeText } from "@/lib/utils";

type ActivityItem = {
  id: string;
  text: string;
  tone: "green" | "blue" | "amber" | "red";
  time: string;
};

type DashboardResponse = {
  ok: boolean;
  summary: {
    prospects_total: number;
    prospects_pending: number;
    prospects_closed: number;
    calls_today: number;
    payments_paid: number;
    payments_pending: number;
    prospects_added_today: number;
    prospects_closed_this_week: number;
    pending_payment_emails_sent: number;
    today_outcomes: {
      connected: number;
      voicemail: number;
      no_answer: number;
      rejected: number;
    };
  };
  activity: ActivityItem[];
};

const outcomeColors: Record<string, string> = {
  connected: "#00FF88",
  voicemail: "#38B6FF",
  no_answer: "#FFB800",
  rejected: "#FF4444",
};

function relativeTime(value: string) {
  const now = Date.now();
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "-";
  const seconds = Math.max(1, Math.floor((now - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default function DashboardHomePage() {
  const [loading, setLoading] = useState(true);
  const [runningBatch, setRunningBatch] = useState(false);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const inFlightRef = useRef(false);

  const load = async (silent = false, signal?: AbortSignal) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    let timedOut = false;
    const timeoutId = silent
      ? null
      : window.setTimeout(() => {
          timedOut = true;
          setLoading(false);
          toast.error("Dashboard load timeout. Please retry.");
        }, 10000);

    if (!silent) setLoading(true);
    try {
      const dashboardRes = await fetch("/api/dashboard", { cache: "no-store", signal });

      const dashboardPayload = (await dashboardRes.json()) as DashboardResponse & { error?: string };
      if (!dashboardRes.ok || !dashboardPayload.ok) {
        throw new Error(dashboardPayload.error || "Failed to load dashboard.");
      }
      setDashboard(dashboardPayload);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error(error instanceof Error ? error.message : "Failed to load dashboard.");
    } finally {
      if (timeoutId) window.clearTimeout(timeoutId);
      if (!timedOut) setLoading(false);
      inFlightRef.current = false;
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    void load(false, controller.signal);
    const id = window.setInterval(() => void load(true), 30000);
    return () => {
      controller.abort();
      window.clearInterval(id);
    };
  }, []);

  const outcomes = useMemo(() => {
    return dashboard?.summary.today_outcomes || { connected: 0, voicemail: 0, no_answer: 0, rejected: 0 };
  }, [dashboard]);

  const outcomeChart = useMemo(
    () =>
      Object.entries(outcomes).map(([name, value]) => ({
        name: name.replace("_", " "),
        value,
        fill: outcomeColors[name],
      })),
    [outcomes]
  );

  const stagePerformance = useMemo(() => {
    const callsToday = Math.max(0, dashboard?.summary.calls_today || 0);
    const connected = Math.max(0, outcomes.connected || 0);
    const paymentAttempts = Math.max(
      0,
      (dashboard?.summary.payments_pending || 0) + (dashboard?.summary.payments_paid || 0)
    );
    const paid = Math.max(0, dashboard?.summary.payments_paid || 0);

    const pitch = callsToday > 0 ? Math.round((connected / callsToday) * 100) : 0;
    const objections = connected > 0 ? Math.round((Math.min(paymentAttempts, connected) / connected) * 100) : 0;
    const close = paymentAttempts > 0 ? Math.round((paid / paymentAttempts) * 100) : 0;

    return { pitch, objections, close };
  }, [dashboard, outcomes]);

  const activityItems = useMemo(() => {
    return dashboard?.activity || [];
  }, [dashboard]);

  const startBatch = async () => {
    setRunningBatch(true);
    try {
      const response = await fetch("/api/dashboard/run-cron", { method: "POST", cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || payload.error) {
        throw new Error(payload.error || "Batch trigger failed.");
      }
      toast.success("Batch trigger started.");
      void load(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Batch trigger failed.");
    } finally {
      setRunningBatch(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-white">Dashboard</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Live operations view for outbound calling and deal flow.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={runningBatch} onClick={startBatch}>
            {runningBatch ? "Starting..." : "Start Batch"}
          </Button>
          <Button onClick={() => void load()} variant="outline">
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Prospects In Queue"
          value={loading ? "-" : String(dashboard?.summary.prospects_pending || 0)}
          icon={Users}
          description={`+${dashboard?.summary.prospects_added_today || 0} added today`}
        />
        <StatCard
          title="Calls Today"
          value={loading ? "-" : String(dashboard?.summary.calls_today || 0)}
          icon={PhoneOutgoing}
          description={`${outcomes.connected} connected, ${outcomes.voicemail} voicemail, ${outcomes.no_answer} no answer`}
        />
        <StatCard
          title="Deals Closed"
          value={loading ? "-" : String(dashboard?.summary.prospects_closed || 0)}
          icon={CheckCircle2}
          tone="success"
          description={`${dashboard?.summary.prospects_closed_this_week || 0} this week`}
        />
        <StatCard
          title="Payments Pending"
          value={loading ? "-" : String(dashboard?.summary.payments_pending || 0)}
          icon={Clock3}
          tone="warning"
          description={`${dashboard?.summary.pending_payment_emails_sent || 0} emails sent, awaiting payment`}
        />
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Live Activity Feed</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              <TableLoadingSkeleton rows={8} />
            ) : activityItems.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No recent activity yet.</p>
            ) : (
              activityItems.map((item) => (
                <div
                  className="group flex items-center gap-3 rounded-xl border border-transparent px-3 py-3 transition-all hover:border-[var(--line-strong)] hover:bg-[rgba(56,182,255,0.08)]"
                  key={item.id}
                >
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      item.tone === "green"
                        ? "bg-[var(--green)]"
                        : item.tone === "blue"
                          ? "bg-[var(--cyan)]"
                          : item.tone === "amber"
                            ? "bg-[var(--amber)]"
                            : "bg-[var(--red)]"
                    }`}
                  />
                  <p className="min-w-0 flex-1 truncate text-sm text-[var(--text-main)]">{safeText(item.text)}</p>
                  <span className="text-xs text-[var(--text-muted)]">{relativeTime(item.time)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Today&apos;s Call Outcomes</CardTitle>
            </CardHeader>
            <CardContent className="h-[320px]">
              {loading ? (
                <LoadingSkeleton className="h-full w-full" />
              ) : (
                <PieChart width={280} height={280}>
                  <Pie
                    data={outcomeChart}
                    cx="50%"
                    cy="48%"
                    dataKey="value"
                    innerRadius={65}
                    outerRadius={100}
                    paddingAngle={4}
                  >
                    {outcomeChart.map((entry) => (
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
              )}
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                {outcomeChart.map((item) => (
                  <div className="flex items-center gap-2 text-[var(--text-muted)]" key={item.name}>
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.fill }} />
                    <span className="capitalize">{item.name}</span>
                    <strong className="ml-auto text-[var(--text-main)]">{item.value}</strong>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="items-center">
              <CardTitle>Stage Performance</CardTitle>
              <Link className="text-xs text-[#8ed5ff] hover:text-[#c7ecff]" href="/dashboard/analytics">
                View Full Analytics
              </Link>
            </CardHeader>
            <CardContent>
              {dashboard ? (
                <div className="space-y-3">
                  <div className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] p-3">
                    <div className="mb-1 flex items-center justify-between text-xs text-[var(--text-muted)]">
                      <span>Pitch</span>
                      <span>{stagePerformance.pitch}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-[rgba(255,255,255,0.06)]">
                      <div className="h-2 rounded-full bg-[#38B6FF]" style={{ width: `${stagePerformance.pitch}%` }} />
                    </div>
                  </div>
                  <div className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] p-3">
                    <div className="mb-1 flex items-center justify-between text-xs text-[var(--text-muted)]">
                      <span>Objections</span>
                      <span>{stagePerformance.objections}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-[rgba(255,255,255,0.06)]">
                      <div
                        className="h-2 rounded-full bg-[#00D4FF]"
                        style={{ width: `${stagePerformance.objections}%` }}
                      />
                    </div>
                  </div>
                  <div className="rounded-xl border border-[rgba(0,255,136,0.28)] bg-[rgba(0,255,136,0.08)] p-3">
                    <div className="mb-1 flex items-center justify-between text-xs text-[var(--text-muted)]">
                      <span>Close</span>
                      <span>{stagePerformance.close}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-[rgba(255,255,255,0.06)]">
                      <div className="h-2 rounded-full bg-[#00FF88]" style={{ width: `${stagePerformance.close}%` }} />
                    </div>
                  </div>
                </div>
              ) : (
                <LoadingSkeleton className="h-36 w-full" />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
