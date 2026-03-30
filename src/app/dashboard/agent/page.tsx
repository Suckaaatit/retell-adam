"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import VoiceTester from "@/components/voice-tester";
import { formatDuration, safeText } from "@/lib/utils";

type CallsResponse = {
  data: Array<{ duration_seconds: number | null; outcome: string | null; summary: string | null }> | null;
  error: string | null;
  count: number | null;
};

type DashboardResponse = {
  ok: boolean;
  summary: {
    prospects_total: number;
    prospects_closed: number;
  };
};

export default function AgentPage() {
  const [avgDuration, setAvgDuration] = useState("-");
  const [objectionRate, setObjectionRate] = useState("0%");
  const [closeRate, setCloseRate] = useState("0%");
  const [topObjection, setTopObjection] = useState("We already have someone (0)");

  useEffect(() => {
    const loadPerformance = async () => {
      try {
        const [callsRes, dashboardRes] = await Promise.all([
          fetch("/api/dashboard/calls?page=1&limit=100&sortBy=created_at&sortDirection=desc", { cache: "no-store" }),
          fetch("/api/dashboard", { cache: "no-store" }),
        ]);

        const callsPayload = (await callsRes.json()) as CallsResponse;
        const dashboardPayload = (await dashboardRes.json()) as DashboardResponse;

        if (callsRes.ok && callsPayload.data) {
          const durations = callsPayload.data.map((call) => Number(call.duration_seconds || 0)).filter((value) => value > 0);
          const avg = durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0;
          setAvgDuration(formatDuration(avg));

          const objectionSignals = callsPayload.data.filter((call) => (call.summary || "").toLowerCase().includes("objection")).length;
          const handledSignals = callsPayload.data.filter(
            (call) => (call.summary || "").toLowerCase().includes("resolved") || (call.outcome || "").toLowerCase() === "closed"
          ).length;
          const objectionPct =
            objectionSignals > 0 ? Math.round((Math.min(handledSignals, objectionSignals) / objectionSignals) * 100) : 0;
          setObjectionRate(`${objectionPct}%`);

          const buckets: Record<string, number> = {
            "We already have someone": 0,
            "Too expensive": 0,
            "Not interested": 0,
          };
          for (const call of callsPayload.data) {
            const summary = (call.summary || "").toLowerCase();
            if (summary.includes("already have")) buckets["We already have someone"] += 1;
            if (summary.includes("expensive") || summary.includes("budget")) buckets["Too expensive"] += 1;
            if (summary.includes("not interested")) buckets["Not interested"] += 1;
          }
          const top = Object.entries(buckets).sort((a, b) => b[1] - a[1])[0];
          setTopObjection(`${top[0]} (${top[1]})`);
        }

        if (dashboardRes.ok && dashboardPayload.ok) {
          const total = dashboardPayload.summary.prospects_total || 0;
          const closed = dashboardPayload.summary.prospects_closed || 0;
          setCloseRate(total > 0 ? `${Math.round((closed / total) * 100)}%` : "0%");
        }
      } catch {
        // Non-fatal stats failures should not block the panel.
      }
    };

    void loadPerformance();
    const id = window.setInterval(() => void loadPerformance(), 30000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-bold text-white">Agent</h1>
        <p className="text-sm text-[var(--text-muted)]">ADAM is powered by ElevenLabs Conversational AI. Calls are initiated via Twilio from the Prospects page.</p>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Agent Profile</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
            <div className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] px-3 py-2">
              <p className="text-xs text-[var(--text-muted)]">Name</p>
              <p>Adam</p>
            </div>
            <div className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] px-3 py-2">
              <p className="text-xs text-[var(--text-muted)]">Company</p>
              <p>God&apos;s Cleaning Crew</p>
            </div>
            <div className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] px-3 py-2">
              <p className="text-xs text-[var(--text-muted)]">Voice Platform</p>
              <p>ElevenLabs Conversational AI</p>
            </div>
            <div className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] px-3 py-2">
              <p className="text-xs text-[var(--text-muted)]">Telephony</p>
              <p>Twilio</p>
            </div>
            <div className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] px-3 py-2 md:col-span-2">
              <p className="text-xs text-[var(--text-muted)]">Status</p>
              <div className="mt-1 flex items-center gap-2 text-[#9dffcf]">
                <span className="pulse-dot h-2.5 w-2.5 rounded-full bg-[var(--green)]" />
                Active
              </div>
            </div>
            <div className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] px-3 py-2 md:col-span-2">
              <p className="text-xs text-[var(--text-muted)]">How it works</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                You click &ldquo;Call Now&rdquo; on a prospect &rarr; Twilio dials &rarr; audio streams to ElevenLabs agent ADAM &rarr; ADAM handles the entire conversation.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="glass-card flex w-full flex-col rounded-xl p-8">
          <h2 className="mb-1 text-xl font-bold text-white">Endpoints &amp; Tools</h2>
          <p className="mb-8 text-sm text-gray-400">Configure these in the ElevenLabs dashboard for agent ADAM.</p>
          <VoiceTester />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Performance Stats</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
            <div className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] px-3 py-2">
              <p className="text-xs text-[var(--text-muted)]">Average call duration</p>
              <p className="text-lg text-white">{safeText(avgDuration)}</p>
            </div>
            <div className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] px-3 py-2">
              <p className="text-xs text-[var(--text-muted)]">Objection handling rate</p>
              <p className="text-lg text-white">{safeText(objectionRate)}</p>
            </div>
            <div className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] px-3 py-2">
              <p className="text-xs text-[var(--text-muted)]">Close rate</p>
              <p className="text-lg text-white">{safeText(closeRate)}</p>
            </div>
            <div className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] px-3 py-2">
              <p className="text-xs text-[var(--text-muted)]">Top objection</p>
              <p className="text-white">{safeText(topObjection)}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
