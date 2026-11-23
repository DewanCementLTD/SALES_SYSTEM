'use client';

// Permit detail (PRD 4.7): edit draft, issue (balance check), send to CFO, override, adjust, cancel,
// print.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Stamp } from 'lucide-react';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import { PageHeader, ProblemAlert } from '@/components/common/page';
import { PermitForm } from '@/components/permits/permit-form';
import { api } from '@/lib/api';
import { printAndOpen } from '@/lib/print';
import { fmtPKR } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useSession } from '@/lib/session';

const DONE = {
  'send-cfo': 'Sent to the CFO',
  'request-override': 'Balance override sent for approval',
  adjust: 'Quantities adjusted',
  cancel: 'Permit cancelled',
};

export default function PermitDetailPage() {
  const { brnch, permitNo } = useParams();
  const s = useSession();
  const qc = useQueryClient();
  const key = qk.permit(Number(brnch), permitNo);
  const q = useQuery({ queryKey: key, queryFn: () => api(`/permits/${brnch}/${permitNo}`) });
  const p = q.data;
  const base = `/permits/${brnch}/${permitNo}`;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ['permits', 'list'] });
    qc.invalidateQueries({ queryKey: ['customers', 'balance'] });
  };
  return (
    <>
      <PageHeader
        icon={Stamp}
        title={`Permit ${permitNo}`}
        subtitle={p ? `${p.customerCode} · ${p.customerName ?? ''}` : undefined}
        crumbs={[{ label: 'Permits', href: '/permits' }, { label: permitNo }]}
      />
      <ProblemAlert error={q.error} className="mb-3" />
      {q.isLoading && <Loader2 className="mx-auto size-6 animate-spin" aria-label="Loading" />}
      {p && (
        <PermitForm
          key={p.rowVer}
          brnch={Number(brnch)}
          permit={p}
          can={s.can}
          mine={Number(brnch) === s.branch}
          onSave={async (body) => {
            await api(base, { method: 'PUT', body, headers: { 'if-match': `"${p.rowVer}"` } });
            toast.success('Draft saved');
            refresh();
          }}
          command={async (path, body = {}) => {
            if (path === 'print') {
              await printAndOpen({
                path: `${base}/print`,
                entity: 'PERMIT_MST_CITY',
                entityKey: `${brnch}|${permitNo}`,
                label: 'permit',
              });
              return;
            }
            const res = await api(`${base}/${path}`, {
              method: 'POST',
              body,
              headers: { 'if-match': `"${p.rowVer}"` },
            });
            toast.success(
              path === 'issue'
                ? `Permit issued. Balance after: ${fmtPKR(res.balanceAfter, { brackets: true })}`
                : path === 'send'
                  ? res.outboxIds.length
                    ? `Queued to the dealer (${res.outboxIds.length} message(s))`
                    : 'No channel to send: the customer has no mobile number or e-mail'
                  : DONE[path],
            );
            refresh();
          }}
        />
      )}
    </>
  );
}
