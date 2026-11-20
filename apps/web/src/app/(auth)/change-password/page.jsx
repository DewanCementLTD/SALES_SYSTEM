'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { ProblemAlert } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useLogout } from '@/lib/session';

// Same policy as the API (PRD 4.1); the API is authoritative and also checks the last 5 passwords.
const schema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z
      .string()
      .min(10, 'At least 10 characters')
      .regex(/[A-Z]/, 'Needs an upper-case letter')
      .regex(/[a-z]/, 'Needs a lower-case letter')
      .regex(/\d/, 'Needs a digit'),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, {
    path: ['confirm'],
    message: 'Passwords do not match',
  });

export default function ChangePasswordPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const logout = useLogout();
  const [error, setError] = useState(null);
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
  });
  const err = form.formState.errors;

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await api('/auth/change-password', {
        method: 'POST',
        body: { currentPassword: v.currentPassword, newPassword: v.newPassword },
      });
      await qc.invalidateQueries({ queryKey: qk.me });
      toast.success('Password changed');
      router.replace('/');
    } catch (e) {
      setError(e);
    }
  });

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border bg-card p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-brand-sky text-brand-navy">
            <KeyRound className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-brand-navy">Change password</h1>
            <p className="text-sm text-muted-foreground">Required before you continue.</p>
          </div>
        </div>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {[
            ['currentPassword', 'Current password', 'current-password'],
            ['newPassword', 'New password', 'new-password'],
            ['confirm', 'Repeat new password', 'new-password'],
          ].map(([name, label, ac]) => (
            <div key={name} className="space-y-1.5">
              <Label htmlFor={name}>{label}</Label>
              <Input
                id={name}
                type="password"
                autoComplete={ac}
                {...form.register(name)}
                aria-invalid={!!err[name]}
              />
              {err[name] && <p className="text-xs text-danger">{err[name].message}</p>}
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            At least 10 characters with upper- and lower-case letters and a digit. Your last 5
            passwords cannot be reused.
          </p>
          <ProblemAlert error={error} />
          <div className="flex gap-2">
            <Button type="submit" className="flex-1" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              )}
              Change password
            </Button>
            <Button type="button" variant="outline" onClick={logout}>
              Sign out
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
