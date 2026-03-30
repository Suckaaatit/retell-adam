"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type TabsContextType = {
  value: string;
  setValue: (value: string) => void;
};

const TabsContext = React.createContext<TabsContextType | null>(null);

function useTabsContext() {
  const context = React.useContext(TabsContext);
  if (!context) throw new Error("Tabs components must be used inside Tabs");
  return context;
}

function Tabs({
  value,
  onValueChange,
  children,
}: {
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return <TabsContext.Provider value={{ value, setValue: onValueChange }}>{children}</TabsContext.Provider>;
}

function TabsList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("inline-flex rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] p-1", className)} {...props} />
  );
}

function TabsTrigger({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { value: activeValue, setValue } = useTabsContext();
  const active = activeValue === value;
  return (
    <button
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-[rgba(56,182,255,0.2)] text-[#a3deff] shadow-[0_0_0_1px_rgba(56,182,255,0.4)]"
          : "text-[var(--text-muted)] hover:text-[var(--text-main)]",
        className
      )}
      onClick={() => setValue(value)}
      type="button"
    >
      {children}
    </button>
  );
}

function TabsContent({
  value,
  className,
  children,
}: {
  value: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { value: activeValue } = useTabsContext();
  if (activeValue !== value) return null;
  return <div className={cn("mt-4", className)}>{children}</div>;
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
