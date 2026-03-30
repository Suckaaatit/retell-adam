"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingSkeleton } from "@/components/loading-skeleton";

type SettingsPayload = {
  data:
    | {
        elevenlabs_agent_id_masked: string;
        twilio_from_number_masked: string;
        stripe_link_650_masked: string;
        stripe_link_1100_masked: string;
        stripe_webhook_active: boolean;
        supabase_url_masked: string;
        integrations: {
          elevenlabs: boolean;
          twilio: boolean;
          stripe: boolean;
          resend: boolean;
          supabase: boolean;
        };
      }
    | null;
  error: string | null;
  count: number | null;
};

type PhoneRow = {
  id: string;
  number: string;
  daily_call_count: number;
  active: boolean;
};

type PhonePayload = {
  data: PhoneRow[] | null;
  error: string | null;
  count: number | null;
};

function statusDot(ok: boolean) {
  return (
    <span className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? "bg-[var(--green)] pulse-dot" : "bg-[var(--red)]"}`} />
  );
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<SettingsPayload["data"]>(null);
  const [phones, setPhones] = useState<PhoneRow[]>([]);
  const [newNumber, setNewNumber] = useState("");
  const [adding, setAdding] = useState(false);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [settingsRes, phonesRes] = await Promise.all([
        fetch("/api/dashboard/settings", { cache: "no-store" }),
        fetch("/api/dashboard/phone-numbers", { cache: "no-store" }),
      ]);
      const settingsPayload = (await settingsRes.json()) as SettingsPayload;
      const phonesPayload = (await phonesRes.json()) as PhonePayload;

      if (!settingsRes.ok || settingsPayload.error || !settingsPayload.data) {
        throw new Error(settingsPayload.error || "Failed to load settings.");
      }
      if (!phonesRes.ok || phonesPayload.error) {
        throw new Error(phonesPayload.error || "Failed to load phone numbers.");
      }

      setSettings(settingsPayload.data);
      setPhones(phonesPayload.data || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load settings.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const testElevenLabs = async () => {
    try {
      const response = await fetch("/api/dashboard/settings", { cache: "no-store" });
      const payload = (await response.json()) as SettingsPayload;
      if (!response.ok || payload.error || !payload.data) throw new Error(payload.error || "ElevenLabs check failed.");
      if (!payload.data.integrations.elevenlabs) throw new Error("ElevenLabs API key is not configured.");
      if (!payload.data.integrations.twilio) throw new Error("Twilio credentials are not configured.");
      toast.success("ElevenLabs + Twilio configuration looks healthy.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ElevenLabs check failed.");
    }
  };

  const testStripeWebhook = async () => {
    try {
      const response = await fetch("/api/dashboard/settings", { cache: "no-store" });
      const payload = (await response.json()) as SettingsPayload;
      if (!response.ok || payload.error || !payload.data) throw new Error(payload.error || "Check failed.");
      if (!payload.data.stripe_webhook_active) throw new Error("Stripe webhook secret is not configured.");
      toast.success("Stripe webhook configuration looks active.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Stripe check failed.");
    }
  };

  const testSupabase = async () => {
    try {
      const response = await fetch("/api/dashboard/stats", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || payload.error) throw new Error(payload.error || "Supabase test failed.");
      toast.success("Supabase connection healthy.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Supabase test failed.");
    }
  };

  const runCron = async () => {
    try {
      const response = await fetch("/api/dashboard/run-cron", { method: "POST", cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || payload.error) throw new Error(payload.error || "Cron failed.");
      toast.success("Cron run completed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Cron run failed.");
    }
  };

  const addNumber = async () => {
    const e164 = /^\+[1-9]\d{6,14}$/;
    if (!e164.test(newNumber)) {
      toast.error("Phone number must be valid E.164.");
      return;
    }
    setAdding(true);
    try {
      const response = await fetch("/api/dashboard/phone-numbers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: newNumber }),
      });
      const payload = await response.json();
      if (!response.ok || payload.error) throw new Error(payload.error || "Failed to add number.");
      toast.success("Phone number added.");
      setNewNumber("");
      void load(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add number.");
    } finally {
      setAdding(false);
    }
  };

  const toggleNumber = async (row: PhoneRow) => {
    try {
      const response = await fetch(`/api/dashboard/phone-numbers/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !row.active }),
      });
      const payload = await response.json();
      if (!response.ok || payload.error) throw new Error(payload.error || "Failed to update number.");
      toast.success("Phone number updated.");
      void load(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update number.");
    }
  };

  const resetDailyCounts = async () => {
    try {
      const response = await fetch("/api/dashboard/phone-numbers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset_daily_counts" }),
      });
      const payload = await response.json();
      if (!response.ok || payload.error) throw new Error(payload.error || "Reset failed.");
      toast.success("Daily call counts reset.");
      void load(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Reset failed.");
    }
  };

  const loadingBlock = (
    <div className="space-y-2">
      <LoadingSkeleton className="h-10 w-full" />
      <LoadingSkeleton className="h-10 w-full" />
      <LoadingSkeleton className="h-10 w-full" />
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold text-white">Settings</h1>
        <div className="flex gap-2">
          <Button onClick={runCron}>Run Cron</Button>
          <Button onClick={() => void load()} variant="outline">
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>ElevenLabs + Twilio</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {loading ? (
              loadingBlock
            ) : (
              <>
                <div className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] px-3 py-2">
                  <span className="text-[var(--text-muted)]">ElevenLabs Agent ID</span>
                  <span data-mono="true">{settings?.elevenlabs_agent_id_masked || "-"}</span>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] px-3 py-2">
                  <span className="text-[var(--text-muted)]">Twilio From Number</span>
                  <span data-mono="true">{settings?.twilio_from_number_masked || "-"}</span>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] px-3 py-2">
                  <span className="text-[var(--text-muted)]">ElevenLabs</span>
                  <span className="flex items-center gap-2">
                    {statusDot(Boolean(settings?.integrations.elevenlabs))}
                    {settings?.integrations.elevenlabs ? "Active" : "Inactive"}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] px-3 py-2">
                  <span className="text-[var(--text-muted)]">Twilio</span>
                  <span className="flex items-center gap-2">
                    {statusDot(Boolean(settings?.integrations.twilio))}
                    {settings?.integrations.twilio ? "Active" : "Inactive"}
                  </span>
                </div>
              </>
            )}
            <Button onClick={testElevenLabs} variant="outline">
              Test Connection
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Stripe Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {loading ? (
              loadingBlock
            ) : (
              <>
                <div className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] px-3 py-2">
                  <span className="text-[var(--text-muted)]">Payment Link 650</span>
                  <span data-mono="true">{settings?.stripe_link_650_masked || "-"}</span>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] px-3 py-2">
                  <span className="text-[var(--text-muted)]">Payment Link 1100</span>
                  <span data-mono="true">{settings?.stripe_link_1100_masked || "-"}</span>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] px-3 py-2">
                  <span className="text-[var(--text-muted)]">Webhook Status</span>
                  <span className="flex items-center gap-2">
                    {statusDot(Boolean(settings?.stripe_webhook_active))}
                    {settings?.stripe_webhook_active ? "Active" : "Inactive"}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] px-3 py-2">
                  <span className="text-[var(--text-muted)]">API Status</span>
                  <span className="flex items-center gap-2">
                    {statusDot(Boolean(settings?.integrations.stripe))}
                    {settings?.integrations.stripe ? "Active" : "Inactive"}
                  </span>
                </div>
              </>
            )}
            <Button onClick={testStripeWebhook} variant="outline">
              Test Webhook
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Supabase Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {loading ? (
              loadingBlock
            ) : (
              <>
                <div className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] px-3 py-2">
                  <span className="text-[var(--text-muted)]">Project URL</span>
                  <span data-mono="true">{settings?.supabase_url_masked || "-"}</span>
                </div>
                <div className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] px-3 py-2">
                  <span className="text-[var(--text-muted)]">Connection</span>
                  <span className="flex items-center gap-2">
                    {statusDot(Boolean(settings?.integrations.supabase))}
                    {settings?.integrations.supabase ? "Connected" : "Disconnected"}
                  </span>
                </div>
              </>
            )}
            <Button onClick={testSupabase} variant="outline">
              Test Connection
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Phone Numbers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Input onChange={(event) => setNewNumber(event.target.value)} placeholder="+14155551001" value={newNumber} />
              <Button disabled={adding} onClick={addNumber}>
                <Plus className="mr-1 h-4 w-4" />
                Add Number
              </Button>
              <Button onClick={resetDailyCounts} variant="outline">
                Reset Daily Counts
              </Button>
            </div>
            <div className="overflow-auto rounded-2xl border border-[var(--line)]">
              <table className="w-full min-w-[420px]">
                <thead>
                  <tr className="border-b border-[var(--line)] bg-[rgba(255,255,255,0.03)] text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">
                    <th className="px-3 py-3">Number</th>
                    <th className="px-3 py-3">Daily Count</th>
                    <th className="px-3 py-3">Active</th>
                  </tr>
                </thead>
                <tbody>
                  {phones.length === 0 ? (
                    <tr>
                      <td className="px-3 py-8 text-center text-sm text-[var(--text-muted)]" colSpan={3}>
                        No numbers configured.
                      </td>
                    </tr>
                  ) : (
                    phones.map((row) => (
                      <tr className="border-b border-[var(--line)] text-sm" key={row.id}>
                        <td className="px-3 py-3" data-mono="true">
                          {row.number}
                        </td>
                        <td className="px-3 py-3">{row.daily_call_count}</td>
                        <td className="px-3 py-3">
                          <button
                            className={`rounded-full border px-2 py-1 text-xs ${
                              row.active
                                ? "border-[#0b7043] bg-[rgba(0,255,136,0.15)] text-[#95ffcf]"
                                : "border-[var(--line)] bg-[rgba(255,255,255,0.06)] text-[var(--text-muted)]"
                            }`}
                            onClick={() => void toggleNumber(row)}
                            type="button"
                          >
                            {row.active ? "Active" : "Inactive"}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Calling Hours</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] px-3 py-2">
              <p className="text-[var(--text-muted)]">Active window</p>
              <p className="mt-1 text-white" data-mono="true">
                Monday-Saturday, 9:00 AM - 6:00 PM (local)
              </p>
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              Calls outside this window are skipped by scheduling logic.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Integration Summary</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2 md:grid-cols-4">
          {[
            { label: "ElevenLabs", ok: settings?.integrations.elevenlabs || false },
            { label: "Twilio", ok: settings?.integrations.twilio || false },
            { label: "Stripe", ok: settings?.integrations.stripe || false },
            { label: "Resend", ok: settings?.integrations.resend || false },
            { label: "Supabase", ok: settings?.integrations.supabase || false },
          ].map((item) => (
            <div className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] px-3 py-2" key={item.label}>
              <span>{item.label}</span>
              <span className="flex items-center gap-2 text-sm">
                {item.ok ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-[var(--green)]" />
                    Healthy
                  </>
                ) : (
                  <>
                    <span className="h-2.5 w-2.5 rounded-full bg-[var(--red)]" />
                    Error
                  </>
                )}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
