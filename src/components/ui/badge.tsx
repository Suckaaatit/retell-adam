import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-[rgba(56,182,255,0.22)] text-[#9cd9ff]",
        success: "border-[#0b7043] bg-[rgba(0,255,136,0.15)] text-[#80ffc4]",
        warning: "border-[#8b6613] bg-[rgba(255,184,0,0.16)] text-[#ffd47a]",
        danger: "border-[#8b2e2e] bg-[rgba(255,68,68,0.16)] text-[#ffabab]",
        neutral: "border-[var(--line)] bg-[rgba(255,255,255,0.08)] text-[var(--text-muted)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
