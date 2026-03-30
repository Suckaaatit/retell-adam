import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

export function formatDuration(seconds?: number | null) {
  if (!seconds || seconds <= 0) return "-";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function formatCurrencyFromCents(amountCents?: number | null) {
  const amount = Number(amountCents || 0) / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

/**
 * Safely coerce any value into a renderable string.
 * Guards against React Error #31 when objects (e.g. {role, content}) leak into JSX.
 */
export function safeText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "object" && item !== null && "content" in item) {
          return String((item as Record<string, unknown>).content || "");
        }
        return safeText(item);
      })
      .filter(Boolean)
      .join("\n");
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("content" in obj) return String(obj.content || "");
    if ("text" in obj) return String(obj.text || "");
    if ("message" in obj) return String(obj.message || "");
    try { return JSON.stringify(value); } catch { return "[object]"; }
  }
  return String(value);
}

export function getStatusTone(status: string) {
  const normalized = status.toLowerCase();
  if (
    normalized === "paid" ||
    normalized === "closed" ||
    normalized === "completed" ||
    normalized === "connected"
  ) {
    return "success";
  }
  if (
    normalized === "pending" ||
    normalized === "interested" ||
    normalized === "followup" ||
    normalized === "processing" ||
    normalized === "called"
  ) {
    return "warning";
  }
  if (normalized === "failed" || normalized === "error" || normalized === "rejected" || normalized === "do_not_call") {
    return "danger";
  }
  if (normalized === "no_answer" || normalized === "voicemail" || normalized === "expired" || normalized === "cancelled") {
    return "neutral";
  }
  return "neutral";
}
