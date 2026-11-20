'use client';

// Excel import of trade prices (TASKS P1-06): upload → preview with per-row errors → save (one
// approval for the whole file).
import { useMutation } from '@tanstack/react-query';
import { FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { DataTable } from '@/components/common/data-table';
import { ProblemAlert, StatusBadge } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';

const COLUMNS = [
  { id: 'row', header: 'Row', cell: ({ row }) => row.original.row },
  { id: 'cust', header: 'Customer', cell: ({ row }) => row.original.customerCode },
  { id: 'prod', header: 'Product', cell: ({ row }) => row.original.productCode },
  {
    id: 'geo',
    header: 'City code',
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.geoCode}</span>,
  },
  {
    id: 'price',
    header: 'Price',
    meta: { className: 'text-right' },
    cell: ({ row }) => row.original.invoicePrice,
  },
  { id: 'from', header: 'From', cell: ({ row }) => row.original.efDate },
  {
    id: 'result',
    header: 'Result',
    cell: ({ row }) =>
      row.original.ok ? (
        <StatusBadge tone="success">{row.original.priceCode}</StatusBadge>
      ) : (
        <span className="text-sm text-danger">{row.original.error}</span>
      ),
  },
];

export function TradePriceImport({ onDone }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const upload = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('file', file);
      return api('/pricing/trade-prices/import', { method: 'POST', body: fd });
    },
    onSuccess: setPreview,
  });
  const commit = useMutation({
    mutationFn: () =>
      api(`/pricing/trade-prices/import/${preview.importId}/commit`, { method: 'POST', body: {} }),
    onSuccess: (r) => {
      toast.success(`${r.created} prices saved${r.requestId ? ' — sent for approval' : ''}`);
      setPreview(null);
      setFile(null);
      setOpen(false);
      onDone?.();
    },
  });
  if (!open) {
    return (
      <Button variant="outline" className="mb-3" onClick={() => setOpen(true)}>
        <FileSpreadsheet className="size-4" /> Import from Excel
      </Button>
    );
  }
  return (
    <div className="mb-4 space-y-3 rounded-lg border bg-secondary/40 p-4">
      <p className="text-sm text-muted-foreground">
        First sheet, header row:{' '}
        <code>customer_code, product_code, geo_code, price, effective_from</code> (optional{' '}
        <code>target</code>). <code>geo_code</code> is the city code from Masters → Geography (e.g.
        Z12-T12-A01-C2172). Every row is checked like a single new price; the file is saved only
        when all rows are valid.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="tp-file">Workbook (.xlsx)</Label>
          <Input
            id="tp-file"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
            }}
          />
        </div>
        <Button onClick={() => upload.mutate()} disabled={!file || upload.isPending}>
          {upload.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Upload className="size-4" />
          )}{' '}
          Check file
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
      <ProblemAlert error={upload.error ?? commit.error} />
      {preview && (
        <>
          <p className="text-sm">
            {preview.valid} of {preview.total} rows are valid.
            {!preview.importId && ' Fix the marked rows and upload again.'}
          </p>
          <DataTable columns={COLUMNS} data={preview.rows} rowKey={(r) => r.row} />
          {preview.importId && (
            <Button onClick={() => commit.mutate()} disabled={commit.isPending}>
              {commit.isPending && <Loader2 className="size-4 animate-spin" />} Save {preview.total}{' '}
              prices
            </Button>
          )}
        </>
      )}
    </div>
  );
}
