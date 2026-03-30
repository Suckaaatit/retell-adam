import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LucideIcon } from "lucide-react";

type StatCardProps = {
  title: string;
  value: string;
  icon: LucideIcon;
  description?: string;
  tone?: "default" | "success" | "warning";
};

const toneStyles: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "border-[var(--line)]",
  success: "border-[#0b7043]",
  warning: "border-[#8b6613]",
};

export function StatCard({ title, value, icon: Icon, description, tone = "default" }: StatCardProps) {
  return (
    <Card className={`relative overflow-hidden ${toneStyles[tone]}`}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--line-strong)] to-transparent" />
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-[var(--text-muted)]">{title}</CardTitle>
        <Icon className="h-4 w-4 text-[var(--brand-1)]" />
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold text-[var(--text-main)]">{value}</p>
        {description ? <p className="mt-1 text-xs text-[var(--text-muted)]">{description}</p> : null}
      </CardContent>
    </Card>
  );
}
