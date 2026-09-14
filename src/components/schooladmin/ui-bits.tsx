"use client";

// Small shared UI helpers for School Admin tables/lists

import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { statusLabelFa } from "./shared";

export function TableSkeleton({ rows = 4, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="rounded-xl border border-border/60 overflow-hidden">
      <Table>
        <TableBody>
          {Array.from({ length: rows }).map((_, i) => (
            <TableRow key={i}>
              {Array.from({ length: cols }).map((_, j) => (
                <TableCell key={j} className="py-4">
                  <Skeleton className="h-5 w-full max-w-[150px]" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  if (status === "ACTIVE") {
    return <Badge variant="secondary">{statusLabelFa(status)}</Badge>;
  }
  return <Badge variant="destructive">{statusLabelFa(status)}</Badge>;
}
