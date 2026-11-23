'use client';

// OC detail (PRD 4.5): edit, review/approve/reject, BRV links, live balance, confirm → DOs,
// overrides, cancel, duplicate.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileCheck2, Loader2 } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { PageHeader, ProblemAlert } from '@/components/common/page';
import { OcView } from '@/components/orders/oc-view';
import { api } from '@/lib/api';
import { fmtPKR } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useSession } from '@/lib/session';

const DONE = {
  '': 'OC saved',
  review: 'OC marked reviewed',
  approve: 'OC approved',
  reject: 'OC returned to draft',
  brvs: 'Payment links saved',
  cancel: 'OC cancelled',
};

export default function OcDetailPage() {
  const { brnch, ocNo } = useParams();
  const s = useSession();
  const qc = useQueryClient();
  const router = useRouter();
  const key = qk.oc(Number(brnch), ocNo);
  const q = useQuery({ queryKey: key, queryFn: () => api(`/oc/${brnch}/${ocNo}`) });
  const oc = q.data;
  return (
    <>
      <PageHeader
        icon={FileCheck2}
        title={`Order confirmation ${ocNo}`}
        subtitle={oc ? `${oc.customerCode} · ${oc.customerName ?? ''}` : undefined}
        crumbs={[
          { label: 'Orders' },
          { label: 'Order confirmation', href: '/orders/oc' },
          { label: ocNo },
        ]}
      />
      <ProblemAlert error={q.error} className="mb-3" />
      {q.isLoading && <Loader2 className="mx-auto size-6 animate-spin" aria-label="Loading" />}
      {oc && (
        <OcView
          key={oc.rowVer}
          oc={oc}
          can={s.can}
          mine={Number(brnch) === s.branch}
          onChanged={() => {
            qc.invalidateQueries({ queryKey: key });
            qc.invalidateQueries({ queryKey: ['oc', 'list'] });
            qc.invalidateQueries({ queryKey: ['customers', 'balance'] });
          }}
          command={async (path, body = {}, method = 'POST') => {
            const res = await api(`/oc/${brnch}/${ocNo}${path ? `/${path}` : ''}`, {
              method,
              body,
              headers: { 'if-match': `"${oc.rowVer}"` },
            });
            if (path === 'duplicate') {
              toast.success(`New draft OC ${res.ocNo}`);
              router.push(`/orders/oc/${brnch}/${res.ocNo}`);
            } else if (path === 'confirm') {
              toast.success(
                `OC confirmed: ${res.dos.length} DO(s) issued (${res.dos.map((d) => d.doNo).join(', ')}). Balance after: ${fmtPKR(res.balanceAfter, { brackets: true })}`,
              );
            } else if (path === 'request-override') {
              toast.success(
                res.requestId
                  ? `Sent for approval (request #${res.requestId})`
                  : 'Override recorded (no approval rule active)',
              );
            } else toast.success(DONE[path] ?? 'Done');
            return res;
          }}
        />
      )}
    </>
  );
}
