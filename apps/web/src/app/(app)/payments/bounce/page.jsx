'use client';

// Bounce work list (BR-BRV-05): verified / cleared BRVs; open one to record a returned cheque.
import { RotateCcw } from 'lucide-react';
import { BrvList } from '@/components/payments/brv-list';

export default function BouncePage() {
  return (
    <BrvList
      icon={RotateCcw}
      title="Cheque returns"
      subtitle="Open a verified BRV to record that the bank returned it. The receipt is reversed in the customer's ledgers."
      crumb="Bounce"
      statuses={['VERIFIED', 'CLEARED', 'BOUNCED']}
    />
  );
}
