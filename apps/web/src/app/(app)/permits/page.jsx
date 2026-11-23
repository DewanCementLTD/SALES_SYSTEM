'use client';

// Permits (PRD 4.7, TASKS P2-05).
import { Stamp } from 'lucide-react';
import { PermitList } from '@/components/permits/permit-list';

export default function PermitsPage() {
  return (
    <PermitList
      icon={Stamp}
      title="City-wise permits"
      subtitle="Quantity per city for permit customers, priced from the approved rate sheet. Issuing checks the customer's balance."
      crumb="Permits"
      showNew
    />
  );
}
