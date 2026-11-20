'use client';

import { useQuery } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { RequestCard } from '@/components/approvals/request-card';
import { EmptyState, PageHeader, ProblemAlert, Section } from '@/components/common/page';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';

export default function ApprovalsSentPage() {
  const q = useQuery({ queryKey: qk.approvalsSent, queryFn: () => api('/approvals/sent') });
  return (
    <>
      <PageHeader
        icon={Send}
        title="Sent by me"
        subtitle="Approval requests you raised."
        crumbs={[{ label: 'Approvals' }, { label: 'Sent by me' }]}
      />
      <ProblemAlert error={q.error} className="mb-3" />
      {q.data?.length ? (
        <div className="grid gap-3">
          {q.data.map((r) => (
            <RequestCard key={r.reqId} r={r} />
          ))}
        </div>
      ) : (
        <Section>
          <EmptyState
            icon={Send}
            title={q.isLoading ? 'Loading…' : 'You have not raised any request'}
          />
        </Section>
      )}
    </>
  );
}
