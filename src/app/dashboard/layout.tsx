"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "@/components/sidebar";
import { AppToaster } from "@/components/ui/toaster";
import { DashboardErrorBoundary } from "@/components/error-boundary";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [health, setHealth] = useState<"ok" | "error">("ok");

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const response = await fetch("/api/dashboard/health", { cache: "no-store" });
        setHealth(response.ok ? "ok" : "error");
      } catch {
        setHealth("error");
      }
    };

    void checkHealth();
    const interval = window.setInterval(checkHealth, 30000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="relative flex min-h-screen bg-black">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(56,182,255,0.18),transparent_34%),radial-gradient(circle_at_100%_0%,rgba(0,212,255,0.12),transparent_36%)]" />
      <Sidebar health={health} />
      <div className="min-w-0 flex-1">
        <main className="page-enter h-screen overflow-y-auto p-5 pt-16 md:p-6 md:pt-6">
          <DashboardErrorBoundary>{children}</DashboardErrorBoundary>
        </main>
      </div>
      <AppToaster />
    </div>
  );
}
