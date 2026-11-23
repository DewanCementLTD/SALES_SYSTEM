'use client';

// Outstanding DOs (PRD 4.8, report R10 live): issued, partly dispatched and held DOs.
import { ClipboardList } from 'lucide-react';
import { DoList } from '@/components/delivery/do-list';

export default function OutstandingDoPage() {
  return (
    <DoList
      icon={ClipboardList}
      title="Outstanding DOs"
      subtitle="Open DOs with the quantity still to dispatch (issued, partly dispatched, on hold)."
      crumb="Outstanding DOs"
      outstanding
    />
  );
}
