'use client';

// Accounts › Credit / debit notes (PRD 4.13, TASKS P4-01): notes of my branches with kind and
// status filters; new note → draft → submit → Finance Manager approves in My approvals → posted.
import { useQuery } from '@tanstack/react-query';
import { FileMinus2, Plus } from 'lucide-react';
import Link from 'next/link';
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs';
import { NOTE_TONE, noteStatusText } from '@/components/accounts/note-status';
import { DataTable } from '@/components/common/data-table';
import { PageHeader, ProblemAlert, Section, StatusBadge } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtPKR } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useSession } from '@/lib/session';

const columns = [
  {
    id: 'no',
    header: 'Note #',
    cell: ({ row }) => (
      <Link
        href={`/accounts/notes/${row.original.brnch}/${row.original.kind}/${row.original.srlNo}`}
        className="font-mono text-primary hover:underline"
      >
        {row.original.kind === 'D' ? 'DN' : 'CN'} {row.original.srlNo}
      </Link>
    ),
  },
  { id: 'd', header: 'Date', cell: ({ row }) => fmtDate(row.original.date) },
  {
    id: 't',
    header: 'Type',
    cell: ({ row }) => `${row.original.noteType} ${row.original.typeName ?? ''}`,
  },
  {
    id: 'c',
    header: 'Customer',
    cell: ({ row }) => `${row.original.customerCode} ${row.original.customerName ?? ''}`,
  },
  {
    id: 'a',
    header: 'Net',
    meta: { className: 'text-right' },
    cell: ({ row }) => (
      <span className="tabular-nums">
        {row.original.kind === 'D' ? 'Dr ' : 'Cr '}
        {fmtPKR(row.original.net)}
      </span>
    ),
  },
  {
    id: 's',
    header: 'Status',
    cell: ({ row }) => (
      <StatusBadge tone={NOTE_TONE[row.original.status] ?? 'neutral'}>
        {noteStatusText(row.original.status)}
      </StatusBadge>
    ),
  },
  {
    id: 'r',
    header: 'Remarks',
    cell: ({ row }) => (
      <span className="line-clamp-1 max-w-80 text-muted-foreground">
        {row.original.remarks ?? ''}
      </span>
    ),
  },
];

export default function NotesPage() {
  const s = useSession();
  const [f, setF] = useQueryStates({
    kind: parseAsString.withDefault('all'),
    status: parseAsString.withDefault('all'),
    page: parseAsInteger.withDefault(1),
  });
  const params = {
    ...(f.kind !== 'all' ? { kind: f.kind } : {}),
    ...(f.status !== 'all' ? { status: f.status } : {}),
    page: f.page,
    pageSize: 50,
  };
  const list = useQuery({
    queryKey: qk.notes(params),
    queryFn: () => api(`/notes${qs(params)}`),
    placeholderData: (p) => p,
  });
  return (
    <>
      <PageHeader
        icon={FileMinus2}
        title="Credit / debit notes"
        subtitle="Credits and debits to customer accounts. Posted notes are never edited: reverse them instead."
        crumbs={[{ label: 'Accounts' }, { label: 'Credit / debit notes' }]}
        actions={
          s.can('note.create') && (
            <Button asChild>
              <Link href="/accounts/notes/new">
                <Plus className="size-4" /> New note
              </Link>
            </Button>
          )
        }
      />
      <Section>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Tabs value={f.kind} onValueChange={(k) => setF({ kind: k, page: 1 })}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="C">Credit notes</TabsTrigger>
              <TabsTrigger value="D">Debit notes</TabsTrigger>
            </TabsList>
          </Tabs>
          <Select value={f.status} onValueChange={(v) => setF({ status: v, page: 1 })}>
            <SelectTrigger className="w-48" aria-label="Status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any status</SelectItem>
              {Object.keys(NOTE_TONE).map((k) => (
                <SelectItem key={k} value={k}>
                  {noteStatusText(k)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ProblemAlert error={list.error} className="mb-3" />
        <DataTable
          columns={columns}
          data={list.data}
          loading={list.isLoading}
          onPageChange={(p) => setF({ page: p })}
          rowKey={(r) => `${r.brnch}|${r.kind}|${r.srlNo}`}
          empty="No notes."
        />
      </Section>
    </>
  );
}
