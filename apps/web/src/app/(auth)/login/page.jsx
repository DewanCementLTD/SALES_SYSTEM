'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, LogIn } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { ProblemAlert } from '@/components/common/page';
import { DclMark, PlantSkyline } from '@/components/shell/brand';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

const schema = z.object({
  usrid: z.string().trim().min(1, 'Enter your user id'),
  password: z.string().min(1, 'Enter your password'),
  brnch: z.string().min(1, 'Choose a branch'),
  fiscalYear: z.string().min(1, 'Choose a fiscal year'),
});

const LAST_KEY = 'dcl.login.last';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [error, setError] = useState(null);
  const options = useQuery({
    queryKey: qk.loginOptions,
    queryFn: () => api('/auth/login-options'),
  });
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { usrid: '', password: '', brnch: '1', fiscalYear: '' },
  });
  const brnch = useWatch({ control: form.control, name: 'brnch' });
  const years = options.data?.branches.find((b) => String(b.brnch) === brnch)?.fiscalYears ?? [];

  useEffect(() => {
    if (!options.data) return;
    let last = null;
    try {
      last = JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null');
    } catch {
      last = null;
    }
    if (last?.usrid) form.setValue('usrid', last.usrid);
    if (last?.brnch) form.setValue('brnch', String(last.brnch));
    form.setValue('fiscalYear', String(options.data.defaultFiscalYear));
    form.setFocus(last?.usrid ? 'password' : 'usrid');
  }, [options.data, form]);

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const me = await api('/auth/login', {
        method: 'POST',
        body: {
          usrid: v.usrid,
          password: v.password,
          brnch: Number(v.brnch),
          fiscalYear: Number(v.fiscalYear),
        },
      });
      try {
        localStorage.setItem(LAST_KEY, JSON.stringify({ usrid: v.usrid, brnch: Number(v.brnch) }));
      } catch {
        /* ignore */
      }
      qc.clear();
      qc.setQueryData(qk.me, me);
      // only same-site paths ("/x"), never "//host" or "/\host" (open redirect)
      const next = params.get('next');
      const safeNext = next && /^\/(?![/\\])/.test(next) ? next : '/';
      router.replace(me.mustChangePassword ? '/change-password' : safeNext);
    } catch (e) {
      setError(e);
      form.setValue('password', '');
      form.setFocus('password');
    }
  });

  const err = form.formState.errors;
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="usrid">User ID</Label>
        <Input
          id="usrid"
          autoComplete="username"
          {...form.register('usrid')}
          aria-invalid={!!err.usrid}
        />
        {err.usrid && <p className="text-xs text-danger">{err.usrid.message}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          {...form.register('password')}
          aria-invalid={!!err.password}
        />
        {err.password && <p className="text-xs text-danger">{err.password.message}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="brnch">Branch</Label>
          <Controller
            control={form.control}
            name="brnch"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="brnch" className="w-full">
                  <SelectValue placeholder="Branch" />
                </SelectTrigger>
                <SelectContent>
                  {(options.data?.branches ?? []).map((b) => (
                    <SelectItem key={b.brnch} value={String(b.brnch)}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fiscalYear">Fiscal year</Label>
          <Controller
            control={form.control}
            name="fiscalYear"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="fiscalYear" className="w-full">
                  <SelectValue placeholder="Year" />
                </SelectTrigger>
                <SelectContent>
                  {years.map((y) => (
                    <SelectItem key={y.year} value={String(y.year)}>
                      {y.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>
      </div>
      <ProblemAlert error={error} />
      <Button
        type="submit"
        className="h-11 w-full bg-brand-orange text-base hover:bg-brand-orange-hover"
        disabled={form.formState.isSubmitting}
      >
        {form.formState.isSubmitting ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <LogIn className="size-4" aria-hidden="true" />
        )}
        Sign in
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-navy to-brand-navy-deep p-10 text-white lg:flex">
        <div className="flex items-center gap-3">
          <DclMark className="h-12 w-auto" />
          <div className="border-l border-white/30 pl-3 leading-tight">
            <div className="text-lg font-semibold">Dewan Cement Limited</div>
            <div className="text-sm text-white/70">Sales &amp; Dispatch</div>
          </div>
        </div>
        <div className="relative z-10 max-w-md">
          <h2 className="text-3xl font-bold leading-tight">
            One system for orders, payments and plant dispatch.
          </h2>
          <p className="mt-3 text-white/70">
            Karachi and Hattar plants, head office and finance — on the same live record.
          </p>
        </div>
        <PlantSkyline className="pointer-events-none absolute inset-x-0 bottom-0 h-56 w-full opacity-80" />
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="inline-flex rounded-lg bg-brand-navy px-3 py-2">
              <DclMark className="h-8 w-auto" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-brand-navy">Sign in</h1>
          <p className="mb-6 mt-1 text-sm text-muted-foreground">
            Use your DCL user id. Choose the branch and fiscal year to work in.
          </p>
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
