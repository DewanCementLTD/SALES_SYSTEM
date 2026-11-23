'use client';

// New BRV (PRD 4.6): saved as ENTERED; Finance verifies it from the queue or the BRV page.
import { Receipt } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/page';
import { BrvForm } from '@/components/payments/brv-form';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

export default function NewBrvPage() {
  const s = useSession();
  const router = useRouter();
  return (
    <>
      <PageHeader
        icon={Receipt}
        title="Bank Receipt Voucher (BRV)"
        crumbs={[{ label: 'Payments' }, { label: 'BRV', href: '/payments/brv' }, { label: 'New' }]}
      />
      <BrvForm
        brnch={s.branch}
        editable={s.can('brv.create')}
        can={s.can}
        mine
        onSave={async (body) => {
          const brv = await api('/brv', { method: 'POST', body: { ...body, brnch: s.branch } });
          toast.success(`BRV ${brv.receiptNo} saved: waiting for bank verification`);
          router.push(`/payments/brv/${brv.brnch}/${brv.receiptNo}`);
        }}
      />
    </>
  );
}
