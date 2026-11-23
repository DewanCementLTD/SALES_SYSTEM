'use client';

// Adjust quantity (BR-PMT-06): issued permits; open one to change area quantities with a reason.
import { SlidersHorizontal } from 'lucide-react';
import { PermitList } from '@/components/permits/permit-list';

export default function PermitAdjustPage() {
  return (
    <PermitList
      icon={SlidersHorizontal}
      title="Adjust permit quantity"
      subtitle="Open an issued permit and enter the new area quantities. Increases are checked against the balance."
      crumb="Adjust quantity"
      statuses={['ISSUED', 'PARTLY_DISPATCHED']}
    />
  );
}
