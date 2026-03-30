"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-xl text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cyan)] focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        default:
          "border border-[#0b67c5] bg-gradient-to-r from-[#38B6FF] to-[#0066CC] text-white shadow-[0_8px_24px_rgba(0,102,204,0.32)] hover:shadow-[0_10px_30px_rgba(0,212,255,0.45)]",
        outline:
          "border border-[var(--line)] bg-[rgba(255,255,255,0.02)] text-[var(--text-main)] hover:border-[var(--line-strong)] hover:bg-[rgba(56,182,255,0.08)]",
        ghost: "text-[var(--text-muted)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--text-main)]",
        danger: "border border-[#7f2727] bg-[#3a1010] text-[#ffb2b2] hover:bg-[#4d1313]",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-11 px-6",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
