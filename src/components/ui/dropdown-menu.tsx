"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type DropdownContextType = {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

const DropdownContext = React.createContext<DropdownContextType | null>(null);
type TriggerChildProps = {
  onClick?: (event: React.MouseEvent) => void;
};

function useDropdownContext() {
  const context = React.useContext(DropdownContext);
  if (!context) throw new Error("Dropdown components must be used inside DropdownMenu");
  return context;
}

function DropdownMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  return <DropdownContext.Provider value={{ open, setOpen }}>{children}</DropdownContext.Provider>;
}

function DropdownMenuTrigger({ asChild, children }: { asChild?: boolean; children: React.ReactElement<TriggerChildProps> }) {
  const { setOpen } = useDropdownContext();
  if (asChild) {
    return React.cloneElement(children, {
      onClick: (event: React.MouseEvent) => {
        children.props.onClick?.(event);
        setOpen((prev: boolean) => !prev);
      },
    });
  }
  return (
    <button onClick={() => setOpen(true)} type="button">
      {children}
    </button>
  );
}

function DropdownMenuContent({
  className,
  children,
  align = "end",
}: {
  className?: string;
  children: React.ReactNode;
  align?: "start" | "end";
}) {
  const { open, setOpen } = useDropdownContext();
  const ref = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open, setOpen]);

  if (!open) return null;
  return (
    <div
      className={cn(
        "absolute z-50 mt-2 min-w-44 rounded-xl border border-[var(--line)] bg-[rgba(9,14,22,0.96)] p-1 shadow-[0_14px_42px_rgba(0,0,0,0.5)] backdrop-blur-xl",
        align === "end" ? "right-0" : "left-0",
        className
      )}
      ref={ref}
    >
      {children}
    </div>
  );
}

function DropdownMenuItem({
  className,
  onSelect,
  children,
}: {
  className?: string;
  onSelect?: () => void;
  children: React.ReactNode;
}) {
  const { setOpen } = useDropdownContext();
  return (
    <button
      className={cn(
        "flex w-full items-center rounded-lg px-2 py-1.5 text-sm text-[var(--text-main)] hover:bg-[rgba(56,182,255,0.12)]",
        className
      )}
      onClick={() => {
        onSelect?.();
        setOpen(false);
      }}
      type="button"
    >
      {children}
    </button>
  );
}

export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem };
