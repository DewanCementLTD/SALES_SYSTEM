'use client';

import { useQuery } from '@tanstack/react-query';
import { Inbox, ShieldCheck } from 'lucide-react';
import { parseAsString, useQueryState } from 'nuqs';
import { RequestCard } from '@/components/approvals/request-card';
import { EmptyState, PageHeader, ProblemAlert, Section } from '@/components/common/page';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';

export default function ApprovalsInboxPage() {
  const [status, setStatus] = useQueryState('status', parseAsString.withDefault('PENDING'));
  const q = useQuery({
    queryKey: qk.approvalsInbox(status),
    queryFn: () => api(`/approvals/inbox?status=${status}`),
  });
  return (
    <>
      <PageHeader
        icon={ShieldCheck}
        title="My approvals"
        subtitle="Requests waiting for one of your roles, oldest first."
        crumbs={[{ label: 'Approvals' }, { label: 'My inbox' }]}
      />
      <Tabs value={status} onValueChange={setStatus} className="mb-4">
        <TabsList>
          <TabsTrigger value="PENDING">Waiting</TabsTrigger>
          <TabsTrigger value="APPROVED">Approved</TabsTrigger>
          <TabsTrigger value="REJECTED">Rejected</TabsTrigger>
        </TabsList>
      </Tabs>
      <ProblemAlert error={q.error} className="mb-3" />
      {q.data?.length ? (
        <div className="grid gap-3">
          {q.data.map((r) => (
            <RequestCard key={r.reqId} r={r} />
          ))}
        </div>
      ) : (
        <Section>
          <EmptyState icon={Inbox} title={q.isLoading ? 'Loading…' : 'Nothing here'}>
            {status === 'PENDING' && !q.isLoading ? 'No request is waiting for your roles.' : null}
          </EmptyState>
        </Section>
      )}
    </>
  );
}
