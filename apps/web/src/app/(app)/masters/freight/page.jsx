'use client';

// Freight sheets (TASKS P1-07): freight per city (ZONE_CITY_FRIEGHT_M/D). The last freight rate
// (LFR) of a city is the one on the latest sheet dated on or before the day.
import { useQuery } from '@tanstack/react-query';
import { Truck } from 'lucide-react';
import { useState } from 'react';
import { DataTable } from '@/components/common/data-table';
import { PageHeader, ProblemAlert, Section } from '@/components/common/page';
import { api } from '@/lib/api';
import { fmtDate, fmtPKR } from '@/lib/format';

export default function FreightPage() {
  const list = useQuery({
    queryKey: ['pricing', 'freight-sheets'],
    queryFn: () => api('/pricing/freight-sheets'),
  });
  const [sel, setSel] = useState(null);
  const lines = useQuery({
    queryKey: ['pricing', 'freight-sheet', sel?.brnch, sel?.serno],
    queryFn: () => api(`/pricing/freight-sheets/${sel.brnch}/${sel.serno}`),
    enabled: !!sel,
  });
  return (
    <>
      <PageHeader
        icon={Truck}
        title="Freight sheets"
        subtitle="Freight per city; used as the last freight rate (LFR) on rate sheets and permits."
        crumbs={[{ label: 'Masters' }, { label: 'Freight sheets' }]}
      />
      <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
        <Section title="Sheets">
          <ProblemAlert error={list.error} className="mb-3" />
          <DataTable
            columns={[
              { id: 'no', header: 'No.', cell: ({ row }) => row.original.serno },
              { id: 'd', header: 'From', cell: ({ row }) => fmtDate(row.original.date) },
              { id: 'n', header: 'Cities', cell: ({ row }) => row.original.lines },
            ]}
            data={list.data?.items ?? []}
            loading={list.isLoading}
            onRowClick={setSel}
            rowKey={(r) => `${r.brnch}|${r.serno}`}
            empty="No freight sheets in this branch."
          />
        </Section>
        <Section title={sel ? `Sheet ${sel.serno} · ${fmtDate(sel.date)}` : 'Freight per city'}>
          {sel ? (
            <DataTable
              columns={[
                {
                  id: 'c',
                  header: 'City',
                  cell: ({ row }) => row.original.city ?? row.original.areaDoc,
                },
                { id: 'a', header: 'Code', cell: ({ row }) => row.original.areaDoc },
                {
                  id: 'f',
                  header: 'Freight / ton',
                  meta: { className: 'text-right' },
                  cell: ({ row }) => (
                    <span className="tabular-nums">{fmtPKR(row.original.freight ?? 0)}</span>
                  ),
                },
              ]}
              data={lines.data?.items ?? []}
              loading={lines.isLoading}
              rowKey={(r) => r.areaDoc}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Choose a sheet.</p>
          )}
        </Section>
      </div>
    </>
  );
}
