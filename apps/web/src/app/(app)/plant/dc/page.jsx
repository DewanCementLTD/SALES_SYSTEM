'use client';

// Plant › Delivery challans (PRD 4.9, TASKS P3-06/07): one row per DC line = invoice, with its tax
// figures and FBR state. FBR rejections show FBR's text (BR-FBR-04); after a correction Finance
// sends the invoice again (invoice.fbr_retry).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, RotateCcw } from 'lucide-react';
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs';
import { toast } from 'sonner';
import { DataTable } from '@/components/common/data-table';
import { PageHeader, ProblemAlert, Section, StatusBadge } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtPKR, fmtQty } from '@/lib/format';
import { useSession } from '@/lib/session';

const TONE = {
  FINAL: 'info',
  FBR_PENDING: 'warning',
  FBR_ACCEPTED: 'success',
  FBR_REJECTED: 'danger',
  CANCELLED: 'neutral',
};
const LABEL = {
  FINAL: 'invoiced',
  FBR_PENDING: 'FBR pending',
  FBR_ACCEPTED: 'FBR accepted',
  FBR_REJECTED: 'FBR rejected',
  CANCELLED: 'cancelled',
};

export default function DcInvoicesPage() {
  const s = useSession();
  const qc = useQueryClient();
  const [f, setF] = useQueryStates({
    status: parseAsString.withDefault('all'),
    page: parseAsInteger.withDefault(1),
  });
  const params = {
    ...(f.status !== 'all' ? { status: f.status } : {}),
    page: f.page,
    pageSize: 50,
  };
  const list = useQuery({
    queryKey: ['invoices', params],
    queryFn: () => api(`/invoices${qs(params)}`),
    placeholderData: (p) => p,
  });
  const retry = async (inv) => {
    try {
      await api(`/invoices/${inv.brnch}/${inv.year}/${inv.invoiceNo}/fbr-retry`, {
        method: 'POST',
        body: {},
      });
      toast.success(`Invoice ${inv.invoiceNo} queued for FBR again`);
      qc.invalidateQueries({ queryKey: ['invoices'] });
    } catch (e) {
      toast.error(e.message);
    }
  };
  const columns = [
    {
      id: 'dc',
      header: 'DC',
      cell: ({ row }) => (
        <span className="font-mono">
          {row.original.dcType} {row.original.dcNo}
        </span>
      ),
    },
    {
      id: 'inv',
      header: 'Invoice',
      cell: ({ row }) => <span className="font-mono">{row.original.invoiceNo}</span>,
    },
    { id: 'd', header: 'Date', cell: ({ row }) => fmtDate(row.original.invoiceDate) },
    { id: 'do', header: 'DO', cell: ({ row }) => row.original.doNo ?? '—' },
    {
      id: 'c',
      header: 'Customer',
      cell: ({ row }) => `${row.original.customerCode} ${row.original.customerName ?? ''}`,
    },
    {
      id: 'q',
      header: 'Qty (t)',
      meta: { className: 'text-right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtQty(row.original.qtyTon)}</span>,
    },
    {
      id: 'sp',
      header: 'Sale proceeds',
      meta: { className: 'text-right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtPKR(row.original.saleProceeds)}</span>,
    },
    {
      id: 'st',
      header: 'Sales tax',
      meta: { className: 'text-right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtPKR(row.original.salesTax)}</span>,
    },
    {
      id: 'fbr',
      header: 'FBR',
      cell: ({ row }) => (
        <div className="space-y-0.5">
          <StatusBadge tone={TONE[row.original.status] ?? 'neutral'}>
            {LABEL[row.original.status] ?? row.original.status}
          </StatusBadge>
          {row.original.fbrInvoiceNo && (
            <div className="font-mono text-xs text-muted-foreground">
              {row.original.fbrInvoiceNo}
            </div>
          )}
          {row.original.fbrError && (
            <div className="max-w-xs text-xs text-danger">{row.original.fbrError}</div>
          )}
        </div>
      ),
    },
    {
      id: 'x',
      header: '',
      cell: ({ row }) =>
        ['FBR_REJECTED', 'FBR_PENDING'].includes(row.original.status) &&
        s.can('invoice.fbr_retry') ? (
          <Button size="sm" variant="outline" onClick={() => retry(row.original)}>
            <RotateCcw className="size-4" /> Send again
          </Button>
        ) : null,
    },
  ];
  return (
    <>
      <PageHeader
        icon={FileText}
        title="Delivery challans and invoices"
        subtitle="One invoice per DO on a DC, made right after the weighing, then sent to FBR."
        crumbs={[{ label: 'Plant' }, { label: 'Delivery challans' }]}
      />
      <Section>
        <Tabs value={f.status} onValueChange={(v) => setF({ status: v, page: 1 })} className="mb-3">
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="FBR_PENDING">FBR pending</TabsTrigger>
            <TabsTrigger value="FBR_REJECTED">FBR rejected</TabsTrigger>
            <TabsTrigger value="FBR_ACCEPTED">FBR accepted</TabsTrigger>
          </TabsList>
        </Tabs>
        <ProblemAlert error={list.error} className="mb-3" />
        <DataTable
          columns={columns}
          data={list.data}
          loading={list.isLoading}
          onPageChange={(p) => setF({ page: p })}
          rowKey={(r) => r.invoiceId}
          empty="No invoices yet."
        />
      </Section>
    </>
  );
}
