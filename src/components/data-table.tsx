import type React from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type DataTableProps<T> = {
  columns: Array<{
    key: string;
    header: string;
    cell: (row: T) => React.ReactNode;
    className?: string;
  }>;
  data: T[];
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  rowClassName?: (row: T) => string | undefined;
};

export function DataTable<T>({
  columns,
  data,
  getRowId,
  onRowClick,
  emptyMessage = "No data found.",
  rowClassName,
}: DataTableProps<T>) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column.key} className={column.className}>
              {column.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.length === 0 ? (
          <TableRow>
            <TableCell className="py-8 text-center text-[var(--text-muted)]" colSpan={columns.length}>
              {emptyMessage}
            </TableCell>
          </TableRow>
        ) : (
          data.map((row) => (
            <TableRow
              className={`${onRowClick ? "cursor-pointer" : ""} ${rowClassName?.(row) || ""}`}
              key={getRowId(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((column) => (
                <TableCell className={column.className} key={column.key}>
                  {column.cell(row)}
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
