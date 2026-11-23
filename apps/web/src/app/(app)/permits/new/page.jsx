'use client';

// New permit (PRD 4.7): saved as DRAFT; issue from the permit page.
import { Stamp } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { PageHeader } from '@/components/common/page';
import { PermitForm } from '@/components/permits/permit-form';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

export default function NewPermitPage() {
  const s = useSession();
  const router = useRouter();
  return (
    <>
      <PageHeader
        icon={Stamp}
        title="City-wise permit"
        crumbs={[{ label: 'Permits', href: '/permits' }, { label: 'New' }]}
      />
      <PermitForm
        brnch={s.branch}
        can={s.can}
        mine
        onSave={async (body) => {
          const p = await api('/permits', { method: 'POST', body: { ...body, brnch: s.branch } });
          toast.success(`Permit ${p.permitNo} saved as draft`);
          router.push(`/permits/${p.brnch}/${p.permitNo}`);
        }}
      />
    </>
  );
}
