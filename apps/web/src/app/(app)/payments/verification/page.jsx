'use client';

// Verification queue (PRD 4.6, BR-BRV-03): ENTERED BRVs, oldest first; verify per row.
import { ShieldCheck } from 'lucide-react';
import { BrvList } from '@/components/payments/brv-list';

export default function VerificationPage() {
  return (
    <BrvList
      icon={ShieldCheck}
      title="Bank verification"
      subtitle="Confirm each receipt with the bank, then verify it. You cannot verify a BRV you entered yourself."
      crumb="Verification"
      queue
    />
  );
}
