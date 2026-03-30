"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ background: "#000", color: "#fff", fontFamily: "monospace", padding: 40 }}>
        <h1 style={{ color: "#ff4444" }}>Client Error Caught</h1>
        <pre style={{ whiteSpace: "pre-wrap", color: "#ffaa44", marginTop: 16 }}>
          {error.message}
        </pre>
        <pre style={{ whiteSpace: "pre-wrap", color: "#888", marginTop: 8, fontSize: 12 }}>
          {error.stack}
        </pre>
        {error.digest ? <p style={{ color: "#666", marginTop: 8 }}>Digest: {error.digest}</p> : null}
        <button
          onClick={reset}
          style={{
            marginTop: 24,
            padding: "10px 20px",
            background: "#38B6FF",
            color: "#000",
            border: "none",
            borderRadius: 8,
            cursor: "pointer",
            fontWeight: "bold",
          }}
        >
          Try Again
        </button>
      </body>
    </html>
  );
}
