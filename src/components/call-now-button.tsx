"use client";

import { useState } from "react";
import { PhoneCall } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type CallNowButtonProps = {
  prospectId: string;
  phone: string;
  contactName?: string | null;
  onSuccess?: () => void;
};

export function CallNowButton({ prospectId, phone, contactName, onSuccess }: CallNowButtonProps) {
  const [loading, setLoading] = useState(false);

  const callNow = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/dashboard/call-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prospect_id: prospectId,
          phone,
          contact_name: contactName || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok || payload.error) {
        throw new Error(payload.error || "Call initiation failed.");
      }
      toast.success("Call initiated successfully.");
      onSuccess?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Call initiation failed.";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button disabled={loading} onClick={callNow} size="sm" variant="outline">
      <PhoneCall className="mr-1 h-4 w-4" />
      {loading ? "Calling..." : "Call Now"}
    </Button>
  );
}
