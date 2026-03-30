"use client";

import { useCallback, useEffect, useState } from "react";
import { useConversation, ConversationProvider } from "@elevenlabs/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import VoiceTester from "@/components/voice-tester";
import { formatDuration, safeText } from "@/lib/utils";
import { toast } from "sonner";

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

const AGENT_ID = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID || "";

export default function AgentPage() {
  return (
    <ConversationProvider>
      <AgentPageContent />
    </ConversationProvider>
  );
}

function AgentPageContent() {
  const [avgDuration, setAvgDuration] = useState("-");
  const [objectionRate, setObjectionRate] = useState("0%");
  const [closeRate, setCloseRate] = useState("0%");
  const [topObjection, setTopObjection] = useState("We already have someone (0)");

  // Talk to Agent state
  const [transcript, setTranscript] = useState("");
  const [agentTalking, setAgentTalking] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);

  // Call a Number state
  const [phoneInput, setPhoneInput] = useState("");
  const [calling, setCalling] = useState(false);
  const [callResult, setCallResult] = useState<string | null>(null);

  // Send Payment Link state
  const [emailInput, setEmailInput] = useState("");
  const [planTier, setPlanTier] = useState<"one_incident" | "two_incident">("one_incident");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  // ElevenLabs conversation hook
  const conversation = useConversation({
    onConnect: () => {
      setCallError(null);
    },
    onDisconnect: () => {
      setAgentTalking(false);
    },
    onMessage: (message: { source?: string; message?: string }) => {
      if (message.message) {
        const role = message.source === "ai" ? "Agent" : "You";
        setTranscript((prev) => prev + (prev ? "\n" : "") + `${role}: ${message.message}`);
      }
    },
    onError: (error: unknown) => {
      const msg = typeof error === "string" ? error : error instanceof Error ? error.message : "Call failed.";
      setCallError(msg);
      setAgentTalking(false);
    },
  });

  const startCall = useCallback(async () => {
    setCallError(null);
    setTranscript("");
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      await conversation.startSession({ agentId: AGENT_ID });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to start the call.";
      setCallError(msg);
    }
  }, [conversation]);

  const endCall = useCallback(async () => {
    await conversation.endSession();
    setAgentTalking(false);
  }, [conversation]);

  // Call a number via Twilio
  const callNumber = async () => {
    let phone = phoneInput.trim();
    if (!phone) {
      toast.error("Please enter a phone number.");
      return;
    }
    // Auto-add + if missing
    if (!phone.startsWith("+")) phone = `+${phone}`;
    if (!/^\+[1-9]\d{6,14}$/.test(phone)) {
      toast.error("Phone must be valid E.164 format (e.g. +16477243865).");
      return;
    }

    setCalling(true);
    setCallResult(null);
    try {
      const res = await fetch("/api/dashboard/call-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prospect_id: undefined, phone }),
      });
      const payload = await res.json();
      if (!res.ok || payload.error) {
        throw new Error(payload.error || "Call failed.");
      }
      setCallResult(`Call initiated: ${payload.data?.callId || "success"}`);
      toast.success("Call initiated!");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Call failed.";
      toast.error(msg);
      setCallResult(msg);
    } finally {
      setCalling(false);
    }
  };

  // Send payment email
  const sendPaymentEmail = async () => {
    const trimmed = emailInput.trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast.error("Please enter a valid email address.");
      return;
    }
    setSendingEmail(true);
    setEmailSent(false);
    try {
      const res = await fetch("/api/dashboard/send-payment-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, plan_tier: planTier }),
      });
      const payload = await res.json();
      if (!res.ok || payload.error) {
        throw new Error(payload.error || "Failed to send email.");
      }
      setEmailSent(true);
      toast.success(`Payment link sent to ${trimmed}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send email.");
    } finally {
      setSendingEmail(false);
    }
  };

  // Load performance stats
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
        // Non-fatal
      }
    };

    void loadPerformance();
    const id = window.setInterval(() => void loadPerformance(), 30000);
    return () => window.clearInterval(id);
  }, []);

  const callStatus = conversation.status;
  const statusLabel = callStatus === "connected" ? "Active" : callStatus === "connecting" ? "Connecting" : "Ended";
  const statusColor = callStatus === "connected" ? "text-[var(--green)]" : callStatus === "connecting" ? "text-[var(--amber)]" : "text-[var(--red)]";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-bold text-white">Agent</h1>
        <p className="text-sm text-[var(--text-muted)]">Configure ADAM, test calls, and send payment links.</p>
      </div>

      <div className="space-y-4">
        {/* Agent Profile */}
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
          </CardContent>
        </Card>

        {/* Talk to Agent */}
        <div className="glass-card flex min-h-[400px] w-full flex-col rounded-xl p-8">
          <h2 className="mb-1 text-xl font-bold text-white">Talk to Agent</h2>
          <p className="mb-8 text-sm text-gray-400">Talk to Adam directly in your browser. No phone number needed.</p>

          <div className="mb-8 rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] p-6">
            <div className="flex flex-col items-center gap-4">
              <div className="flex items-center gap-3">
                <span
                  className={`h-3 w-3 rounded-full ${
                    callStatus === "connected" ? "pulse-dot bg-[var(--green)]" : "bg-[rgba(255,255,255,0.15)]"
                  }`}
                />
                <div>
                  <p className="text-xs text-[var(--text-muted)]">Status</p>
                  <p className={`text-sm font-semibold ${statusColor}`}>{safeText(statusLabel)}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-3">
                {callStatus === "connected" || callStatus === "connecting" ? (
                  <Button
                    className="h-12 min-w-[180px] bg-[var(--red)] text-white hover:bg-[#ff5a5a]"
                    onClick={() => void endCall()}
                    size="lg"
                    type="button"
                  >
                    End Call
                  </Button>
                ) : (
                  <Button
                    className="h-12 min-w-[180px] bg-[var(--green)] text-black hover:bg-[#3dff9c]"
                    onClick={() => void startCall()}
                    size="lg"
                    type="button"
                  >
                    Start Call
                  </Button>
                )}
              </div>

              {callError ? <p className="text-xs text-[var(--red)]">{safeText(callError)}</p> : null}
            </div>

            <div className="mt-6 rounded-xl border border-[var(--line)] bg-[rgba(0,0,0,0.35)] p-4">
              <div className="mb-2 flex items-center justify-between text-xs text-[var(--text-muted)]">
                <span>Live transcript</span>
                <span>{callStatus === "connected" ? (agentTalking ? "Agent speaking" : "Listening") : "Listening"}</span>
              </div>
              <div className="min-h-[120px] whitespace-pre-wrap text-sm text-white">
                {safeText(transcript) || "Transcript will appear here once the call starts."}
              </div>
            </div>
          </div>
        </div>

        {/* Call a Number */}
        <div className="glass-card flex w-full flex-col rounded-xl p-8">
          <h2 className="mb-1 text-xl font-bold text-white">Call a Number</h2>
          <p className="mb-6 text-sm text-gray-400">Enter a phone number and ADAM will call them via Twilio.</p>

          <div className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className="mb-1 block text-xs text-[var(--text-muted)]" htmlFor="call-phone">
                  Phone number (E.164)
                </label>
                <Input
                  disabled={calling}
                  id="call-phone"
                  onChange={(e) => { setPhoneInput(e.target.value); setCallResult(null); }}
                  placeholder="+16477243865"
                  type="tel"
                  value={phoneInput}
                />
              </div>
              <Button
                className="h-10 min-w-[160px] bg-[var(--green)] text-black hover:bg-[#3dff9c]"
                disabled={calling || !phoneInput.trim()}
                onClick={() => void callNumber()}
                type="button"
              >
                {calling ? "Calling..." : "Call Now"}
              </Button>
            </div>
            {callResult ? (
              <p className={`mt-3 text-xs ${callResult.includes("initiated") ? "text-[var(--green)]" : "text-[var(--red)]"}`}>
                {safeText(callResult)}
              </p>
            ) : null}
          </div>
        </div>

        {/* Send Payment Link */}
        <div className="glass-card flex w-full flex-col rounded-xl p-8">
          <h3 className="mb-1 text-xl font-bold text-white">Send Payment Link</h3>
          <p className="mb-6 text-sm text-gray-400">Send a Stripe payment link via email.</p>

          <div className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className="mb-1 block text-xs text-[var(--text-muted)]" htmlFor="prospect-email">
                  Email address
                </label>
                <Input
                  disabled={sendingEmail}
                  id="prospect-email"
                  onChange={(e) => { setEmailInput(e.target.value); setEmailSent(false); }}
                  placeholder="prospect@example.com"
                  type="email"
                  value={emailInput}
                />
              </div>
              <div className="w-full sm:w-48">
                <label className="mb-1 block text-xs text-[var(--text-muted)]" htmlFor="plan-tier">
                  Plan
                </label>
                <Select
                  disabled={sendingEmail}
                  id="plan-tier"
                  onChange={(e) => setPlanTier(e.target.value as "one_incident" | "two_incident")}
                  value={planTier}
                >
                  <option value="one_incident">1 Incident &mdash; $650/yr</option>
                  <option value="two_incident">2 Incidents &mdash; $1,100/yr</option>
                </Select>
              </div>
              <Button
                className="h-10 min-w-[160px] bg-[var(--brand-1)] text-white hover:bg-[#3da0ff]"
                disabled={sendingEmail || !emailInput.trim()}
                onClick={() => void sendPaymentEmail()}
                type="button"
              >
                {sendingEmail ? "Sending..." : "Send Payment Link"}
              </Button>
            </div>
            {emailSent ? (
              <p className="mt-3 text-xs text-[var(--green)]">Payment link email sent successfully!</p>
            ) : null}
          </div>
        </div>

        {/* Endpoints & Tools */}
        <div className="glass-card flex w-full flex-col rounded-xl p-8">
          <h2 className="mb-1 text-xl font-bold text-white">Endpoints &amp; Tools</h2>
          <p className="mb-8 text-sm text-gray-400">Configure these in the ElevenLabs dashboard for agent ADAM.</p>
          <VoiceTester />
        </div>

        {/* Performance Stats */}
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
