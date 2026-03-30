"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

const FUNCTIONS = [
  "send_payment_link",
  "log_objection",
  "schedule_followup",
  "check_payment_status",
  "mark_do_not_call",
];

export default function VoiceTester() {
  const [copied, setCopied] = useState<"webhook" | "actions" | null>(null);

  const copyValue = async (value: string, key: "webhook" | "actions") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] p-4">
        <p className="text-sm text-white">ElevenLabs endpoints configured in this app</p>
        <div className="mt-3 space-y-2 text-xs text-[var(--text-muted)]">
          <div className="rounded-lg border border-[var(--line)] bg-[rgba(0,0,0,0.25)] px-3 py-2">
            <p>Post-call webhook URL</p>
            <p className="mt-1 text-sm text-white" data-mono="true">
              /api/elevenlabs/webhook
            </p>
            <Button
              className="mt-2"
              onClick={() => void copyValue("/api/elevenlabs/webhook", "webhook")}
              size="sm"
              type="button"
              variant="outline"
            >
              {copied === "webhook" ? "Copied" : "Copy path"}
            </Button>
          </div>

          <div className="rounded-lg border border-[var(--line)] bg-[rgba(0,0,0,0.25)] px-3 py-2">
            <p>Tool webhook URL (use for all 5 tools)</p>
            <p className="mt-1 text-sm text-white" data-mono="true">
              /api/elevenlabs/actions
            </p>
            <Button
              className="mt-2"
              onClick={() => void copyValue("/api/elevenlabs/actions", "actions")}
              size="sm"
              type="button"
              variant="outline"
            >
              {copied === "actions" ? "Copied" : "Copy path"}
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] p-4">
        <p className="text-sm text-white">ElevenLabs tool list</p>
        <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-[var(--text-muted)] md:grid-cols-2">
          {FUNCTIONS.map((name) => (
            <div
              className="rounded-lg border border-[var(--line)] bg-[rgba(0,0,0,0.25)] px-3 py-2"
              key={name}
            >
              <p data-mono="true">{name}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] p-4 text-xs text-[var(--text-muted)]">
        Calls are initiated from
        <span className="mx-1 text-white">Dashboard &rarr; Prospects &rarr; Call Now</span>
        via Twilio, then bridged to the ElevenLabs agent.
      </div>
    </div>
  );
}
