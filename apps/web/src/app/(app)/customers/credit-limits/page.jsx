'use client';

// Credit Limit documents of the branch (TASKS P1-04): pending first for approvers.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard } from 'lucide-react';
import { parseAsString, useQueryState } from 'nuqs';
import { CreditDocuments } from '@/components/customers/credit';
import { PageHeader, ProblemAlert, Section } from '@/components/common/page';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, qs } from '@/lib/api';

export default function CreditLimitsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useQueryState(
    'status',
    parseAsString.withDefault('PENDING_APPROVAL'),
  );
  const params = { status: status === 'ALL' ? undefined : status };
  const q = useQuery({
    queryKey: ['credit-limits', params],
    queryFn: () => api(`/credit-limits${qs(params)}`),
  });
  return (
    <>
      <PageHeader
        icon={CreditCard}
        title="Credit limits"
        subtitle="A limit changes only through an approved Credit Limit document (BR-CUS-07). Request one from the customer's Credit limits tab."
        crumbs={[{ label: 'Customers', href: '/customers' }, { label: 'Credit limits' }]}
      />
      <Section>
        <Tabs value={status} onValueChange={setStatus} className="mb-4">
          <TabsList>
            <TabsTrigger value="PENDING_APPROVAL">Waiting for approval</TabsTrigger>
            <TabsTrigger value="APPROVED">Approved</TabsTrigger>
            <TabsTrigger value="REJECTED">Rejected</TabsTrigger>
            <TabsTrigger value="ALL">All</TabsTrigger>
          </TabsList>
        </Tabs>
        <ProblemAlert error={q.error} className="mb-3" />
        <CreditDocuments
          docs={q.data?.items ?? []}
          showCustomer
          onChanged={() => qc.invalidateQueries({ queryKey: ['credit-limits'] })}
        />
      </Section>
    </>
  );
}
