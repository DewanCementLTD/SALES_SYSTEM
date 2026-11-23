'use client';

// BRV detail (PRD 4.6): edit while ENTERED, verify (another user), clear, bounce, cancel, print.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Receipt } from 'lucide-react';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import { PageHeader, ProblemAlert } from '@/components/common/page';
import { BrvForm } from '@/components/payments/brv-form';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useSession } from '@/lib/session';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const filesOf = (key) => api(`/files?entity=CASH_CHEQUE_RECEIPTS&key=${encodeURIComponent(key)}`);

const DONE = {
  verify: 'BRV verified: the customer’s ledgers are credited',
  clear: 'BRV marked cleared',
  cancel: 'BRV cancelled',
};

export default function BrvDetailPage() {
  const { brnch, receiptNo } = useParams();
  const s = useSession();
  const qc = useQueryClient();
  const key = qk.brv(Number(brnch), receiptNo);
  const q = useQuery({ queryKey: key, queryFn: () => api(`/brv/${brnch}/${receiptNo}`) });
  const brv = q.data;
  const base = `/brv/${brnch}/${receiptNo}`;
  const ifm = brv ? { 'if-match': `"${brv.rowVer}"` } : {};
  const after = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ['brv', 'list'] });
    qc.invalidateQueries({ queryKey: ['customers', 'balance'] });
  };
  return (
    <>
      <PageHeader
        icon={Receipt}
        title={`BRV ${receiptNo}`}
        subtitle={brv ? `${brv.customerCode} · ${brv.customerName ?? ''}` : undefined}
        crumbs={[
          { label: 'Payments' },
          { label: 'BRV', href: '/payments/brv' },
          { label: receiptNo },
        ]}
      />
      <ProblemAlert error={q.error} className="mb-3" />
      {q.isLoading && <Loader2 className="mx-auto size-6 animate-spin" aria-label="Loading" />}
      {brv && (
        <BrvForm
          key={brv.rowVer}
          brnch={Number(brnch)}
          brv={brv}
          mine={Number(brnch) === s.branch}
          editable={Number(brnch) === s.branch && brv.status === 'ENTERED' && s.can('brv.update')}
          can={s.can}
          onSave={async (body) => {
            await api(base, { method: 'PUT', body, headers: ifm });
            toast.success('BRV saved');
            after();
          }}
          onCommand={async (name, body) => {
            const res = await api(`${base}/${name}`, { method: 'POST', body, headers: ifm });
            if (name === 'bounce') {
              const { releasedOcs, confirmedOcs } = res.impact;
              toast.warning(
                [
                  'Bounce recorded.',
                  releasedOcs.length ? `Released from OCs ${releasedOcs.join(', ')}.` : '',
                  confirmedOcs.length
                    ? `Confirmed OCs to follow up: ${confirmedOcs.join(', ')}.`
                    : '',
                ]
                  .filter(Boolean)
                  .join(' '),
              );
            } else toast.success(DONE[name]);
            after();
          }}
          onPrint={async () => {
            const k = `${brnch}|${receiptNo}`;
            const before = new Set((await filesOf(k)).items.map((x) => x.attId));
            await api(`${base}/receipt`, { method: 'POST', body: {} });
            toast.info('Preparing the receipt…');
            for (let i = 0; i < 20; i += 1) {
              await sleep(1500);
              const f = (await filesOf(k)).items.find((x) => !before.has(x.attId));
              if (f) {
                window.open(`/api/v1/files/${f.attId}`, '_blank', 'noopener');
                return;
              }
            }
            toast.warning('The receipt is still being prepared. Try again in a minute.');
          }}
        />
      )}
    </>
  );
}
