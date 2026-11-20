// Customer status pill (mockup page 1 status panel colours).
import { StatusBadge } from '@/components/common/page';

const TONE = {
  APPROVED: 'success',
  PENDING_APPROVAL: 'warning',
  DRAFT: 'neutral',
  BLOCKED: 'danger',
  CLOSED: 'neutral',
};

export function CustomerStatusBadge({ status, active = true }) {
  return (
    <span className="inline-flex items-center gap-1">
      <StatusBadge tone={TONE[status] ?? 'neutral'}>
        {status.replace('_', ' ').toLowerCase()}
      </StatusBadge>
      {!active && <StatusBadge tone="neutral">inactive</StatusBadge>}
    </span>
  );
}
