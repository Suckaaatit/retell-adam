"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type CsvImportModalProps = {
  onImported: () => void;
};

type CsvRow = {
  phone: string;
  contact_name?: string;
  company_name?: string;
  email?: string;
  source?: string;
};

function parseCsv(input: string): CsvRow[] {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const headers = lines[0]
    .split(",")
    .map((header) => header.trim().replace(/^"|"$/g, "").toLowerCase());

  const rows: CsvRow[] = [];
  for (const line of lines.slice(1)) {
    const values = line
      .split(",")
      .map((value) => value.trim().replace(/^"|"$/g, ""));
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });
    if (row.phone) {
      rows.push({
        phone: row.phone,
        contact_name: row.contact_name || "",
        company_name: row.company_name || "",
        email: row.email || "",
        source: row.source || "",
      });
    }
  }
  return rows;
}

export function CsvImportModal({ onImported }: CsvImportModalProps) {
  const [open, setOpen] = useState(false);
  const [rawCsv, setRawCsv] = useState("");
  const [loading, setLoading] = useState(false);
  const parsedRows = useMemo(() => parseCsv(rawCsv), [rawCsv]);

  const importRows = async () => {
    if (parsedRows.length === 0) {
      toast.error("No valid rows to import.");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/dashboard/prospects/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: parsedRows }),
      });
      const payload = await response.json();
      if (!response.ok || payload.error) {
        throw new Error(payload.error || "Import failed.");
      }
      toast.success(`Import complete. Imported ${payload.data?.imported || 0}, skipped ${payload.data?.skipped || 0}.`);
      setOpen(false);
      setRawCsv("");
      onImported();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button variant="outline">Import CSV</Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import Prospects CSV</DialogTitle>
          <DialogDescription>
            Required column: phone. Optional: contact_name, company_name, email, source.
          </DialogDescription>
        </DialogHeader>
        <textarea
          className="h-44 w-full rounded-xl border border-[var(--line)] bg-[rgba(255,255,255,0.02)] p-3 text-sm text-[var(--text-main)] focus:outline-none focus:ring-2 focus:ring-[var(--cyan)]"
          onChange={(event) => setRawCsv(event.target.value)}
          placeholder={"phone,contact_name,company_name,email,source\n+14155550123,John Doe,Acme,john@example.com,LinkedIn"}
          value={rawCsv}
        />
        <div className="rounded-xl border border-[var(--line)]">
          <div className="border-b border-[var(--line)] bg-[rgba(255,255,255,0.03)] px-3 py-2 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
            Preview (first 5 rows)
          </div>
          <div className="max-h-56 overflow-auto p-2">
            {parsedRows.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">Paste CSV content to preview.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">
                    <th className="px-2 py-1">Phone</th>
                    <th className="px-2 py-1">Name</th>
                    <th className="px-2 py-1">Company</th>
                    <th className="px-2 py-1">Email</th>
                    <th className="px-2 py-1">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.slice(0, 5).map((row, index) => (
                    <tr className="border-t border-[var(--line)]" key={`${row.phone}-${index}`}>
                      <td className="px-2 py-1">{row.phone}</td>
                      <td className="px-2 py-1">{row.contact_name || "-"}</td>
                      <td className="px-2 py-1">{row.company_name || "-"}</td>
                      <td className="px-2 py-1">{row.email || "-"}</td>
                      <td className="px-2 py-1">{row.source || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => setOpen(false)} type="button" variant="outline">
            Cancel
          </Button>
          <Button disabled={loading} onClick={importRows} type="button">
            {loading ? "Importing..." : "Confirm Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
