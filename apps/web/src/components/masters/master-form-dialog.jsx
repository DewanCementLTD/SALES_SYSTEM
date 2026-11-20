'use client';

// Create / edit form for one simple master, generated from the shared registry (same Zod rules as
// the API, TASKS P1-01). The key cannot change after create.
import { zodResolver } from '@hookform/resolvers/zod';
import { masterBodySchema } from '@dcl/shared';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { ProblemAlert } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';

const NONE = '__none__';

/** Form value for a field from an API row (strings for inputs). */
function initialValue(f, row) {
  const v = row?.[f.name];
  if (f.kind === 'flag01') return Boolean(v);
  if (v === null || v === undefined) return '';
  return String(v);
}

function FieldInput({ f, form, options, disabled }) {
  const id = `mf-${f.name}`;
  const error = form.formState.errors[f.name]?.message;
  let control;
  if (f.kind === 'flag01') {
    control = (
      <Controller
        control={form.control}
        name={f.name}
        render={({ field }) => (
          <Switch
            id={id}
            checked={!!field.value}
            onCheckedChange={field.onChange}
            disabled={disabled}
          />
        )}
      />
    );
  } else if (f.kind === 'enum' || f.kind === 'ref') {
    const opts = f.kind === 'enum' ? f.options : (options ?? []);
    control = (
      <Controller
        control={form.control}
        name={f.name}
        render={({ field }) => (
          <Select
            value={field.value === '' ? NONE : field.value}
            onValueChange={(v) => field.onChange(v === NONE ? '' : v)}
            disabled={disabled}
          >
            <SelectTrigger id={id} className="w-full" aria-invalid={!!error}>
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              {!f.required && <SelectItem value={NONE}>— none —</SelectItem>}
              {opts.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.value === o.label ? o.label : `${o.value} · ${o.label}`}
                  {o.active === false ? ' (inactive)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
    );
  } else {
    control = (
      <Input
        id={id}
        type={f.kind === 'date' ? 'date' : 'text'}
        inputMode={f.kind === 'int' || f.kind === 'decimal' ? 'decimal' : undefined}
        maxLength={f.kind === 'text' ? f.max : undefined}
        autoComplete="off"
        placeholder={f.auto ? 'Automatic' : undefined}
        className={f.upper ? 'uppercase' : undefined}
        disabled={disabled}
        aria-invalid={!!error}
        {...form.register(f.name)}
      />
    );
  }
  return (
    <div className={f.kind === 'flag01' ? 'flex items-center gap-3' : 'space-y-1.5'}>
      <Label htmlFor={id}>
        {f.label}
        {f.required && !f.auto && <span className="text-danger"> *</span>}
      </Label>
      {control}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

/**
 * @param {{ def: import('@dcl/shared').MasterDef, row?: any, open: boolean,
 *   onOpenChange: (v: boolean) => void, onSaved: (row: any) => void, canEdit: boolean, brnch: number }} props
 */
export function MasterFormDialog({ def, row, open, onOpenChange, onSaved, canEdit, brnch }) {
  const mode = row ? 'update' : 'create';
  const readOnly = def.readOnly || !canEdit;
  const refTypes = [...new Set(def.fields.filter((f) => f.kind === 'ref').map((f) => f.ref))];
  const refs = useQuery({
    queryKey: qk.lookups(brnch, refTypes.join(',')),
    queryFn: () => api(`/lookups?types=${refTypes.join(',')}&brnch=${brnch}`),
    enabled: open && refTypes.length > 0,
    staleTime: 60_000,
  });
  const keyFields = mode === 'create' ? def.key : [];
  const form = useForm({
    resolver: zodResolver(masterBodySchema(def, mode)),
    defaultValues: Object.fromEntries(
      [...keyFields, ...def.fields].map((f) => [f.name, initialValue(f, row)]),
    ),
  });
  const [error, setError] = useState(null);

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const saved =
        mode === 'create'
          ? await api(`/masters/${def.type}`, { method: 'POST', body: { brnch, ...values } })
          : await api(`/masters/${def.type}/${row.brnch}/${encodeURIComponent(row.__key)}`, {
              method: 'PUT',
              body: values,
              headers: { 'if-match': `"${row.rowVer}"` },
            });
      onSaved(saved);
    } catch (e) {
      for (const fe of e.errors ?? []) {
        const name = fe.path.replace(/^body\./, '');
        form.setError(name, { message: fe.message });
      }
      setError(e);
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create'
              ? `New ${def.singular.toLowerCase()}`
              : `${def.singular} ${row.__key.replaceAll('~', ' / ')}`}
          </DialogTitle>
          <DialogDescription>
            {def.readOnly
              ? def.note
              : mode === 'create'
                ? `Created in branch ${brnch}. The code cannot be changed later.`
                : 'Changes are recorded in the audit log.'}
          </DialogDescription>
        </DialogHeader>
        <form id="master-form" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
          {mode === 'update' &&
            def.key.map((k) => (
              <div key={k.name} className="space-y-1.5">
                <Label htmlFor={`mk-${k.name}`}>{k.label}</Label>
                <Input id={`mk-${k.name}`} value={String(row[k.name])} disabled readOnly />
              </div>
            ))}
          {[...keyFields, ...def.fields].map((f) => (
            <FieldInput
              key={f.name}
              f={f}
              form={form}
              options={f.kind === 'ref' ? refs.data?.[f.ref] : undefined}
              disabled={readOnly}
            />
          ))}
        </form>
        <ProblemAlert error={error} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {readOnly ? 'Close' : 'Cancel'}
          </Button>
          {!readOnly && (
            <Button type="submit" form="master-form" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Loader2 className="size-4 animate-spin" />}
              {mode === 'create' ? 'Create' : 'Save'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
