'use client';

// BRV list (PRD 4.6, TASKS P2-04).
import { Receipt } from 'lucide-react';
import { BrvList } from '@/components/payments/brv-list';

export default function BrvPage() {
  return (
    <BrvList
      icon={Receipt}
      title="Bank Receipt Vouchers"
      subtitle="Customer payments. A BRV counts toward the customer's balance only after Finance verifies it with the bank."
      crumb="BRV"
      showNew
    />
  );
}
