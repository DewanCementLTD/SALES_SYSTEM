'use client';

// New SRF (PRD 4.4): saved as DRAFT; submit from the SRF page creates the draft OC.
import { FilePlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/page';
import { SrfForm } from '@/components/orders/srf-form';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

export default function NewSrfPage() {
  const s = useSession();
  const router = useRouter();
  return (
    <>
      <PageHeader
        icon={FilePlus}
        title="Sales Request Form (SRF)"
        crumbs={[{ label: 'Orders' }, { label: 'SRF', href: '/orders/srf' }, { label: 'New' }]}
      />
      <SrfForm
        brnch={s.branch}
        editable={s.can('srf.create')}
        canSubmit={false}
        canCancel={false}
        canPrint={false}
        onSave={async (body) => {
          const srf = await api('/srf', { method: 'POST', body: { ...body, brnch: s.branch } });
          toast.success(`SRF ${srf.srfNo} saved as draft`);
          router.push(`/orders/srf/${srf.brnch}/${srf.srfNo}`);
        }}
      />
    </>
  );
}
