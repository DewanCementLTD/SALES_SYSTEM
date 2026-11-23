'use client';

// SRF detail (PRD 4.4): edit while DRAFT, submit → draft OC (BR-SRF-05), cancel (BR-SRF-06),
// Contract Review Form print (BR-SRF-07, rendered by the worker; opens when ready).
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import { PageHeader, ProblemAlert } from '@/components/common/page';
import { SrfForm } from '@/components/orders/srf-form';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useSession } from '@/lib/session';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const filesOf = (entityKey) =>
  api(`/files?entity=SALES_REQUEST_MASTER&key=${encodeURIComponent(entityKey)}`);

/** Wait until a file that was not there before appears for the document, then open it. */
async function openWhenReady(entityKey, beforeIds) {
  for (let i = 0; i < 20; i += 1) {
    await sleep(1500);
    const f = (await filesOf(entityKey)).items.find((x) => !beforeIds.has(x.attId));
    if (f) {
      window.open(`/api/v1/files/${f.attId}`, '_blank', 'noopener');
      return true;
    }
  }
  return false;
}

export default function SrfDetailPage() {
  const { brnch, srfNo } = useParams();
  const s = useSession();
  const qc = useQueryClient();
  const key = qk.srf(Number(brnch), srfNo);
  const q = useQuery({ queryKey: key, queryFn: () => api(`/srf/${brnch}/${srfNo}`) });
  const srf = q.data;
  const mine = Number(brnch) === s.branch;
  const ifm = srf ? { 'if-match': `"${srf.rowVer}"` } : {};
  const refresh = (next) => {
    qc.setQueryData(key, next);
    qc.invalidateQueries({ queryKey: ['srf', 'list'] });
  };
  const base = `/srf/${brnch}/${srfNo}`;
  return (
    <>
      <PageHeader
        icon={FileText}
        title={`SRF ${srfNo}`}
        subtitle={srf ? `${srf.customerCode} · ${srf.customerName ?? ''}` : undefined}
        crumbs={[{ label: 'Orders' }, { label: 'SRF', href: '/orders/srf' }, { label: srfNo }]}
        actions={
          srf?.ocNo && (
            <Link
              href={`/orders/oc/${brnch}/${srf.ocNo}`}
              className="text-sm font-medium text-primary hover:underline"
            >
              Open OC {srf.ocNo} →
            </Link>
          )
        }
      />
      <ProblemAlert error={q.error} className="mb-3" />
      {q.isLoading && <Loader2 className="mx-auto size-6 animate-spin" aria-label="Loading" />}
      {srf && (
        <SrfForm
          key={srf.rowVer}
          brnch={Number(brnch)}
          srf={srf}
          editable={mine && srf.status === 'DRAFT' && s.can('srf.update')}
          canSubmit={mine && srf.status === 'DRAFT' && s.can('srf.create')}
          canCancel={mine && ['DRAFT', 'SUBMITTED'].includes(srf.status) && s.can('srf.cancel')}
          canPrint={s.can('srf.print')}
          onSave={async (body) => {
            const next = await api(base, { method: 'PUT', body, headers: ifm });
            toast.success('Draft saved');
            refresh(next);
          }}
          onSubmitSrf={async () => {
            const res = await api(`${base}/submit`, { method: 'POST', body: {}, headers: ifm });
            toast.success(
              res.oc.priced
                ? `Draft OC ${res.oc.ocNo} created at the trade price (${res.oc.priceCode})`
                : `Draft OC ${res.oc.ocNo} created without a trade price: enter the prices on the OC`,
            );
            refresh(res.srf);
          }}
          onCancelSrf={async (reason) => {
            const next = await api(`${base}/cancel`, {
              method: 'POST',
              body: { reason },
              headers: ifm,
            });
            toast.success(`SRF ${srfNo} cancelled`);
            refresh(next);
          }}
          onPrint={async () => {
            const entityKey = `${brnch}|${srfNo}`;
            const before = new Set((await filesOf(entityKey)).items.map((x) => x.attId));
            await api(`${base}/contract-review`, { method: 'POST', body: {} });
            toast.info('Preparing the Contract Review Form…');
            if (!(await openWhenReady(entityKey, before)))
              toast.warning('The print is still being prepared. Try again in a minute.');
          }}
        />
      )}
    </>
  );
}
