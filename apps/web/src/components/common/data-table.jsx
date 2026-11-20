'use client';

// Server-paginated table (TanStack Table v8). Lists stay fast: the API returns one page
// ({ items, page, pageSize, total }); this component only renders it.
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

/**
 * @param {{ columns: any[], data?: { items: any[], page: number, pageSize: number, total: number } | any[],
 *   loading?: boolean, onPageChange?: (page: number) => void, onRowClick?: (row: any) => void,
 *   empty?: React.ReactNode, rowKey?: (row: any) => string|number }} props
 */
export function DataTable({
  columns,
  data,
  loading,
  onPageChange,
  onRowClick,
  empty = 'No records.',
  rowKey,
}) {
  const items = Array.isArray(data) ? data : (data?.items ?? []);
  const table = useReactTable({
    data: items,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: rowKey ? (row) => String(rowKey(row)) : undefined,
  });
  const paged = !Array.isArray(data) && data;
  const pages = paged ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader className="bg-secondary/70">
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                {hg.headers.map((h) => (
                  <TableHead
                    key={h.id}
                    className={cn(
                      'h-10 font-semibold text-brand-navy',
                      h.column.columnDef.meta?.className,
                    )}
                  >
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  <Loader2
                    className="mx-auto size-5 animate-spin text-muted-foreground"
                    aria-label="Loading"
                  />
                </TableCell>
              </TableRow>
            )}
            {!loading && items.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  {empty}
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  className={cn(onRowClick && 'cursor-pointer')}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn('py-2.5', cell.column.columnDef.meta?.className)}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>
      {paged && data.total > data.pageSize && (
        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.total)}{' '}
            of {data.total}
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              disabled={data.page <= 1}
              onClick={() => onPageChange?.(data.page - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="px-2 py-1">
              Page {data.page} / {pages}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              disabled={data.page >= pages}
              onClick={() => onPageChange?.(data.page + 1)}
              aria-label="Next page"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
