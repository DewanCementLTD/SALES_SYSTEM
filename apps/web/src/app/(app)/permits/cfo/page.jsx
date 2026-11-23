'use client';

// CFO queue (BR-PMT-03): permits waiting for the CFO. The decision is taken in Approvals.
import { Stamp } from 'lucide-react';
import { PermitList } from '@/components/permits/permit-list';

export default function PermitCfoPage() {
  return (
    <PermitList
      icon={Stamp}
      title="Permits waiting for the CFO"
      subtitle="Approve or reject them in Approvals › My inbox. A permit waiting for the CFO cannot be dispatched."
      crumb="CFO queue"
      statuses={['PENDING_CFO']}
    />
  );
}
