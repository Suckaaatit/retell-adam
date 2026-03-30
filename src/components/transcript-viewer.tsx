"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { MessageSquareText } from "lucide-react";

type TranscriptValue =
  | string
  | Array<{
      role?: string;
      message?: string;
      text?: string;
      content?: string;
    }>
  | Record<string, unknown>
  | null;

type TranscriptViewerProps = {
  transcript: TranscriptValue;
  summary?: string | null;
};

function normalizeTranscript(transcript: TranscriptValue) {
  if (!transcript) return [];
  if (typeof transcript === "string") {
    return [{ role: "assistant", text: transcript }];
  }
  if (Array.isArray(transcript)) {
    return transcript.map((item) => ({
      role: item.role || "assistant",
      text: item.message || item.text || item.content || "",
    }));
  }
  const raw = transcript as Record<string, unknown>;
  const nested = raw.messages;
  if (Array.isArray(nested)) {
    return nested.map((item) => {
      const message = item as Record<string, unknown>;
      return {
        role: typeof message.role === "string" ? message.role : "assistant",
        text:
          typeof message.message === "string"
            ? message.message
            : typeof message.text === "string"
              ? message.text
              : "",
      };
    });
  }
  return [];
}

export function TranscriptViewer({ transcript, summary }: TranscriptViewerProps) {
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => normalizeTranscript(transcript), [transcript]);

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <MessageSquareText className="mr-1 h-4 w-4" />
          Transcript
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Transcript</DialogTitle>
        </DialogHeader>
        {summary ? (
          <p className="rounded-xl border border-[var(--line)] bg-[rgba(56,182,255,0.08)] p-3 text-sm text-[var(--text-muted)]">
            {summary}
          </p>
        ) : null}
        <div className="max-h-[55vh] space-y-3 overflow-y-auto">
          {rows.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No transcript available.</p>
          ) : (
            rows.map((row, index) => (
              <div
                className={`max-w-[88%] rounded-xl border px-3 py-2 text-sm ${
                  row.role === "assistant"
                    ? "border-[#0f5aa7] bg-[rgba(56,182,255,0.18)] text-[#b6e7ff]"
                    : "ml-auto border-[var(--line)] bg-[rgba(255,255,255,0.05)] text-[var(--text-main)]"
                }`}
                key={`${row.role}-${index}`}
              >
                <p className="mb-1 text-xs uppercase tracking-wide text-[var(--text-muted)]">{row.role}</p>
                <p>{row.text}</p>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
