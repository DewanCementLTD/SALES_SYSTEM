'use client';

// New customer (PRD 4.2, mockup page 1 layout): placement decides the code (BR-CUS-03, shown as a
// preview), the customer then waits for approval by someone else (BR-CUS-02).
import { CUSTOMER_FIELDS, CUSTOMER_TABS, zCustomerCreate } from '@dcl/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Loader2, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { GeoPicker } from '@/components/customers/geo-picker';
import { PageHeader, ProblemAlert, Section } from '@/components/common/page';
import { FieldInput, initialValue } from '@/components/masters/master-form-dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useSession } from '@/lib/session';

const CREATE_TABS = ['info', 'tax', 'contacts'];

export default function NewCustomerPage() {
  const s = useSession();
  const router = useRouter();
  const lookups = useQuery({
    queryKey: qk.lookups(s.branch, 'channels,categories,customer-zones'),
    queryFn: () => api('/lookups?types=channels,categories,customer-zones'),
  });
  const form = useForm({
    resolver: zodResolver(zCustomerCreate),
    defaultValues: {
      geoCode: '',
      zoneCode: '',
      ...Object.fromEntries(CUSTOMER_FIELDS.map((f) => [f.name, initialValue(f, null)])),
      notifySms: true,
    },
  });
  const geoCode = useWatch({ control: form.control, name: 'geoCode' });
  const placed = geoCode && geoCode.split('-').length >= 3;
  const preview = useQuery({
    queryKey: ['customers', 'code-preview', geoCode],
    queryFn: () => api(`/customers/code-preview?geoCode=${encodeURIComponent(geoCode)}`),
    enabled: !!placed,
    retry: false,
  });
  const [error, setError] = useState(null);

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await api('/customers', { method: 'POST', body: values });
      toast.success(`Customer ${res.customer.customerCode} created — waiting for approval`);
      router.push(`/customers/${res.customer.brnch}/${res.customer.customerCode}`);
    } catch (e) {
      for (const fe of e.errors ?? [])
        form.setError(fe.path.replace(/^body\./, ''), { message: fe.message });
      setError(e);
    }
  });

  return (
    <>
      <PageHeader
        icon={UserPlus}
        title="New customer"
        subtitle="The code comes from the area or city. The customer can trade after another user approves it."
        crumbs={[{ label: 'Customers', href: '/customers' }, { label: 'New' }]}
      />
      <form onSubmit={onSubmit} noValidate className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Section title="Placement (customer code)">
            <Controller
              control={form.control}
              name="geoCode"
              render={({ field }) => <GeoPicker value={field.value} onChange={field.onChange} />}
            />
            {form.formState.errors.geoCode && (
              <p className="mt-2 text-xs text-danger">{form.formState.errors.geoCode.message}</p>
            )}
            <div className="mt-4 max-w-sm space-y-1.5">
              <Label htmlFor="zoneCode">Customer zone</Label>
              <Controller
                control={form.control}
                name="zoneCode"
                render={({ field }) => (
                  <Select value={field.value || ''} onValueChange={field.onChange}>
                    <SelectTrigger id="zoneCode" className="w-full">
                      <SelectValue placeholder="Same as geography zone" />
                    </SelectTrigger>
                    <SelectContent>
                      {(lookups.data?.['customer-zones'] ?? []).map((z) => (
                        <SelectItem key={z.value} value={z.value}>
                          {z.value} · {z.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {form.formState.errors.zoneCode && (
                <p className="text-xs text-danger">{form.formState.errors.zoneCode.message}</p>
              )}
            </div>
          </Section>
          {CREATE_TABS.map((tab) => (
            <Section key={tab} title={CUSTOMER_TABS.find((x) => x.id === tab).label}>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {CUSTOMER_FIELDS.filter((f) => f.tab === tab).map((f) => (
                  <FieldInput
                    key={f.name}
                    f={f}
                    form={form}
                    options={
                      f.kind === 'ref' ? lookups.data?.[f.ref]?.filter((o) => o.active) : undefined
                    }
                  />
                ))}
              </div>
            </Section>
          ))}
        </div>
        <aside className="space-y-4">
          <Section title="Customer summary" className="xl:sticky xl:top-20">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Customer code</dt>
                <dd className="font-mono text-2xl font-semibold text-brand-navy">
                  {!placed ? '—' : preview.isLoading ? '…' : (preview.data?.code ?? '—')}
                </dd>
                {preview.error && <dd className="text-xs text-danger">{preview.error.message}</dd>}
                <dd className="text-xs text-muted-foreground">
                  Preview only — the number is given when you save.
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Status after saving</dt>
                <dd className="font-medium text-warning">Pending approval</dd>
              </div>
            </dl>
            <ProblemAlert error={error} className="mt-4" />
            <div className="mt-4 flex gap-2">
              <Button
                type="submit"
                className="flex-1 bg-brand-orange hover:bg-brand-orange/90"
                disabled={form.formState.isSubmitting}
              >
                {form.formState.isSubmitting && <Loader2 className="size-4 animate-spin" />}
                Save & send for approval
              </Button>
              <Button type="button" variant="outline" onClick={() => router.push('/customers')}>
                Cancel
              </Button>
            </div>
          </Section>
        </aside>
      </form>
    </>
  );
}
