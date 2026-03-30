"use client";

import { Toaster } from "sonner";

export function AppToaster() {
  return (
    <Toaster
      position="top-right"
      richColors
      closeButton
      theme="dark"
      toastOptions={{
        style: {
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(8,12,20,0.9)",
          color: "#f4fbff",
        },
      }}
    />
  );
}
