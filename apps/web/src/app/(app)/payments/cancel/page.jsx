'use client';

// BRV cancel work list (BR-BRV-06): only unverified (ENTERED) BRVs can be cancelled.
import { XCircle } from 'lucide-react';
import { BrvList } from '@/components/payments/brv-list';

export default function BrvCancelPage() {
  return (
    <BrvList
      icon={XCircle}
      title="Cancel BRV"
      subtitle="Only a BRV that is not verified yet can be cancelled. After verification, record a bounce or a debit note."
      crumb="BRV cancel"
      statuses={['ENTERED', 'CANCELLED']}
    />
  );
}
