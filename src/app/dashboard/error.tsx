"use client";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center gap-4 p-8">
      <p className="text-lg text-[var(--red)]">Client Error Caught</p>
      <pre className="max-w-2xl whitespace-pre-wrap text-center text-sm text-[var(--text-muted)]">
        {String(error?.message || "Unknown error")}
      </pre>
      <pre className="max-w-2xl whitespace-pre-wrap text-xs text-[rgba(255,255,255,0.3)]">
        {String(error?.stack || "")}
      </pre>
      <button
        className="rounded-xl border border-[var(--line)] bg-[rgba(56,182,255,0.15)] px-4 py-2 text-sm text-white"
        onClick={reset}
        type="button"
      >
        Try Again
      </button>
    </div>
  );
}
