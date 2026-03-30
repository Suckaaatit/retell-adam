"use client";

import { useState } from "react";
import { PauseCircle, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

type AudioPlayerProps = {
  url: string | null;
};

export function AudioPlayer({ url }: AudioPlayerProps) {
  const [open, setOpen] = useState(false);

  if (!url) {
    return <span className="text-xs text-[var(--text-muted)]">No recording</span>;
  }

  return (
    <div className="space-y-2">
      <Button onClick={() => setOpen((prev) => !prev)} size="sm" variant="outline">
        {open ? <PauseCircle className="mr-1 h-4 w-4" /> : <PlayCircle className="mr-1 h-4 w-4" />}
        {open ? "Hide Player" : "Play"}
      </Button>
      {open ? (
        <div className="rounded-xl border border-[var(--line)] bg-[rgba(56,182,255,0.08)] p-2">
          <div className="mb-2 flex h-6 items-end gap-1">
            {Array.from({ length: 7 }).map((_, index) => (
              <span
                className="wave-bar w-1 rounded-full bg-gradient-to-t from-[#38B6FF] to-[#00D4FF]"
                key={index}
                style={{ animationDelay: `${index * 120}ms` }}
              />
            ))}
          </div>
          <audio className="w-full" controls src={url}>
            Your browser does not support audio playback.
          </audio>
        </div>
      ) : null}
    </div>
  );
}
