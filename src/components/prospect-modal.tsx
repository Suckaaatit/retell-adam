"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type ProspectModalProps = {
  onCreated: () => void;
};

type ProspectForm = {
  phone: string;
  contact_name: string;
  company_name: string;
  email: string;
  source: string;
};

const defaultForm: ProspectForm = {
  phone: "",
  contact_name: "",
  company_name: "",
  email: "",
  source: "",
};

const e164Pattern = /^\+[1-9]\d{6,14}$/;

export function ProspectModal({ onCreated }: ProspectModalProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<ProspectForm>(defaultForm);

  const setField = (field: keyof ProspectForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const submit = async () => {
    if (!e164Pattern.test(form.phone.trim())) {
      toast.error("Phone must be valid E.164 format (example: +14155550123).");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/dashboard/prospects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await response.json();
      if (!response.ok || payload.error) {
        throw new Error(payload.error || "Failed to create prospect.");
      }
      toast.success("Prospect created.");
      setOpen(false);
      setForm(defaultForm);
      onCreated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create prospect.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button>Add Prospect</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Prospect</DialogTitle>
          <DialogDescription>Create a new prospect record and queue it for dialing.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-[var(--text-muted)]">Phone (required)</label>
            <Input onChange={(event) => setField("phone", event.target.value)} placeholder="+14155550123" value={form.phone} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-[var(--text-muted)]">Contact Name</label>
            <Input onChange={(event) => setField("contact_name", event.target.value)} value={form.contact_name} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-[var(--text-muted)]">Company</label>
            <Input onChange={(event) => setField("company_name", event.target.value)} value={form.company_name} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-[var(--text-muted)]">Email</label>
            <Input onChange={(event) => setField("email", event.target.value)} type="email" value={form.email} />
          </div>
          <div className="space-y-1 md:col-span-2">
            <label className="text-xs font-medium text-[var(--text-muted)]">Source</label>
            <Input onChange={(event) => setField("source", event.target.value)} value={form.source} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => setOpen(false)} type="button" variant="outline">
            Cancel
          </Button>
          <Button disabled={loading} onClick={submit} type="button">
            {loading ? "Creating..." : "Create Prospect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
