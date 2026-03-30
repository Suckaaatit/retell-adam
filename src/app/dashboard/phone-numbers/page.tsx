"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table";
import { TableLoadingSkeleton } from "@/components/loading-skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/utils";

type PhoneNumberRow = {
  id: string;
  number: string;
  daily_call_count: number;
  total_calls: number;
  answered_calls: number;
  answer_rate: number;
  active: boolean;
  last_used_at: string | null;
};

type ResponsePayload = {
  data: PhoneNumberRow[] | PhoneNumberRow | { reset: boolean } | null;
  error: string | null;
  count: number | null;
};

function AnswerRateBar({ value }: { value: number }) {
  const percent = Math.max(0, Math.min(100, Math.round((value || 0) * 100)));
  const color = percent > 25 ? "bg-emerald-500" : percent >= 15 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="w-32">
      <div className="mb-1 flex justify-between text-xs text-slate-500">
        <span>{percent}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-slate-200">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export default function PhoneNumbersPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<PhoneNumberRow[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [newNumber, setNewNumber] = useState("");
  const [adding, setAdding] = useState(false);

  const loadNumbers = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/dashboard/phone-numbers", { cache: "no-store" });
      const payload = (await response.json()) as ResponsePayload;
      if (!response.ok || payload.error) throw new Error(payload.error || "Failed to load phone numbers.");
      setRows((payload.data as PhoneNumberRow[]) || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load phone numbers.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadNumbers();
  }, []);

  const toggleActive = async (row: PhoneNumberRow) => {
    try {
      const response = await fetch(`/api/dashboard/phone-numbers/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !row.active }),
      });
      const payload = (await response.json()) as ResponsePayload;
      if (!response.ok || payload.error) throw new Error(payload.error || "Failed to update number.");
      toast.success("Phone number updated.");
      void loadNumbers();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update number.");
    }
  };

  const addNumber = async () => {
    const e164 = /^\+[1-9]\d{6,14}$/;
    if (!e164.test(newNumber)) {
      toast.error("Phone number must be valid E.164 format.");
      return;
    }
    setAdding(true);
    try {
      const response = await fetch("/api/dashboard/phone-numbers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: newNumber }),
      });
      const payload = (await response.json()) as ResponsePayload;
      if (!response.ok || payload.error) throw new Error(payload.error || "Failed to add number.");
      toast.success("Phone number added.");
      setAddOpen(false);
      setNewNumber("");
      void loadNumbers();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add number.");
    } finally {
      setAdding(false);
    }
  };

  const resetDailyCounts = async () => {
    const confirmed = window.confirm("Reset daily_call_count for all phone numbers?");
    if (!confirmed) return;
    try {
      const response = await fetch("/api/dashboard/phone-numbers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset_daily_counts" }),
      });
      const payload = (await response.json()) as ResponsePayload;
      if (!response.ok || payload.error) throw new Error(payload.error || "Reset failed.");
      toast.success("Daily counts reset.");
      void loadNumbers();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Reset failed.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Phone Numbers</h1>
          <p className="text-sm text-slate-500">Manage outbound number pool rotation and health metrics.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={resetDailyCounts} variant="outline">
            Reset Daily Counts
          </Button>
          <Dialog onOpenChange={setAddOpen} open={addOpen}>
            <DialogTrigger asChild>
              <Button>Add Number</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Phone Number</DialogTitle>
                <DialogDescription>Number must be in E.164 format.</DialogDescription>
              </DialogHeader>
              <Input onChange={(event) => setNewNumber(event.target.value)} placeholder="+14155551001" value={newNumber} />
              <DialogFooter>
                <Button onClick={() => setAddOpen(false)} variant="outline">
                  Cancel
                </Button>
                <Button disabled={adding} onClick={addNumber}>
                  {adding ? "Adding..." : "Add"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button onClick={() => void loadNumbers()} variant="outline">
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Number Pool</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <TableLoadingSkeleton rows={10} />
          ) : (
            <DataTable
              columns={[
                { key: "number", header: "Number", cell: (row) => row.number },
                { key: "daily", header: "Daily Count", cell: (row) => row.daily_call_count },
                { key: "total", header: "Total Calls", cell: (row) => row.total_calls },
                { key: "answered", header: "Answered", cell: (row) => row.answered_calls },
                { key: "rate", header: "Answer Rate", cell: (row) => <AnswerRateBar value={row.answer_rate} /> },
                {
                  key: "active",
                  header: "Active",
                  cell: (row) => (
                    <button
                      className={`rounded-full px-2 py-1 text-xs font-medium ${
                        row.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"
                      }`}
                      onClick={(event) => {
                        event.stopPropagation();
                        void toggleActive(row);
                      }}
                      type="button"
                    >
                      {row.active ? "Active" : "Inactive"}
                    </button>
                  ),
                },
                { key: "last_used", header: "Last Used", cell: (row) => formatDateTime(row.last_used_at) },
              ]}
              data={rows}
              emptyMessage="No phone numbers configured yet."
              getRowId={(row) => row.id}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
