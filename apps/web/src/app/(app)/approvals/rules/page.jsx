'use client';

// Approval rules admin (BR-APR-01/04): who approves what, at which levels and thresholds.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, Plus, Scale } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { APPROVAL_DOC_TYPES, ROLE_CODES } from '@dcl/shared';
import { docLabel } from '@/components/approvals/request-card';
import { DataTable } from '@/components/common/data-table';
import { PageHeader, ProblemAlert, Section, StatusBadge } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
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
import { api } from '@/lib/api';
import { fmtPKR } from '@/lib/format';
import { qk } from '@/lib/query-keys';

const EMPTY = {
  brnch: 0,
  docType: 'OC_PRICE_OVERRIDE',
  name: '',
  minAmount: '',
  minQty: '',
  levelRoles: ['SALES_MANAGER'],
  sameUserAllowed: false,
  expireHours: '',
  priority: 100,
  active: true,
};

function RuleDialog({ rule, onClose }) {
  const qc = useQueryClient();
  const [f, setF] = useState(() =>
    rule
      ? {
          ...rule,
          minAmount: rule.minAmount ?? '',
          minQty: rule.minQty ?? '',
          expireHours: rule.expireHours ?? '',
        }
      : EMPTY,
  );
  const save = useMutation({
    mutationFn: () => {
      const body = {
        brnch: Number(f.brnch),
        docType: f.docType,
        name: f.name,
        minAmount: f.minAmount === '' ? null : String(f.minAmount),
        minQty: f.minQty === '' ? null : String(f.minQty),
        conditionCode: f.conditionCode ?? null,
        levelRoles: f.levelRoles.filter(Boolean),
        sameUserAllowed: f.sameUserAllowed,
        expireHours: f.expireHours === '' ? null : Number(f.expireHours),
        priority: Number(f.priority),
        active: f.active,
      };
      return rule
        ? api(`/admin/approval-rules/${rule.ruleId}`, { method: 'PUT', body })
        : api('/admin/approval-rules', { method: 'POST', body });
    },
    onSuccess: () => {
      toast.success('Rule saved');
      qc.invalidateQueries({ queryKey: qk.approvalRules });
      onClose();
    },
  });
  const setLevel = (i, v) => {
    const roles = [...f.levelRoles];
    if (v === '-') roles.splice(i);
    else roles[i] = v;
    setF({ ...f, levelRoles: roles });
  };
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{rule ? 'Edit rule' : 'New rule'}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="r-name">Name</Label>
            <Input
              id="r-name"
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
              required
              minLength={3}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-doc">Document / action</Label>
            <Select value={f.docType} onValueChange={(v) => setF({ ...f, docType: v })}>
              <SelectTrigger id="r-doc" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {APPROVAL_DOC_TYPES.map((d) => (
                  <SelectItem key={d} value={d}>
                    {docLabel(d)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-br">Branch</Label>
            <Select value={String(f.brnch)} onValueChange={(v) => setF({ ...f, brnch: Number(v) })}>
              <SelectTrigger id="r-br" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">All branches</SelectItem>
                <SelectItem value="1">Karachi</SelectItem>
                <SelectItem value="2">Islamabad / Hattar</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-amt">Applies from amount (PKR)</Label>
            <Input
              id="r-amt"
              inputMode="decimal"
              value={f.minAmount}
              onChange={(e) => setF({ ...f, minAmount: e.target.value })}
              placeholder="any amount"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-qty">Applies from quantity (t)</Label>
            <Input
              id="r-qty"
              inputMode="decimal"
              value={f.minQty}
              onChange={(e) => setF({ ...f, minQty: e.target.value })}
              placeholder="any quantity"
            />
          </div>
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-1.5">
              <Label htmlFor={`r-l${i}`}>Level {i + 1} role</Label>
              <Select
                value={f.levelRoles[i] ?? '-'}
                onValueChange={(v) => setLevel(i, v)}
                disabled={i > f.levelRoles.length}
              >
                <SelectTrigger id={`r-l${i}`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {i > 0 && <SelectItem value="-">— none —</SelectItem>}
                  {ROLE_CODES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
          <div className="space-y-1.5">
            <Label htmlFor="r-exp">Expires after (hours)</Label>
            <Input
              id="r-exp"
              inputMode="numeric"
              value={f.expireHours}
              onChange={(e) => setF({ ...f, expireHours: e.target.value })}
              placeholder="never"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="r-pri">Priority (lower wins)</Label>
            <Input
              id="r-pri"
              type="number"
              min={1}
              max={999}
              value={f.priority}
              onChange={(e) => setF({ ...f, priority: e.target.value })}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={f.active}
              onCheckedChange={(v) => setF({ ...f, active: Boolean(v) })}
            />{' '}
            Active
          </label>
          <label className="flex items-center gap-2 text-sm text-warning">
            <Checkbox
              checked={f.sameUserAllowed}
              onCheckedChange={(v) => setF({ ...f, sameUserAllowed: Boolean(v) })}
            />{' '}
            Requester may approve (not recommended)
          </label>
          <ProblemAlert error={save.error} className="sm:col-span-2" />
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              Save rule
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ApprovalRulesPage() {
  const q = useQuery({ queryKey: qk.approvalRules, queryFn: () => api('/admin/approval-rules') });
  const [editing, setEditing] = useState(undefined);
  const columns = [
    {
      accessorKey: 'docType',
      header: 'Document / action',
      cell: ({ getValue }) => <span className="font-medium">{docLabel(getValue())}</span>,
    },
    { accessorKey: 'name', header: 'Rule' },
    {
      accessorKey: 'brnch',
      header: 'Branch',
      cell: ({ getValue }) => (getValue() === 0 ? 'All' : `.${getValue()}`),
    },
    {
      id: 'when',
      header: 'Applies when',
      cell: ({ row }) =>
        [
          row.original.minAmount && `≥ PKR ${fmtPKR(row.original.minAmount)}`,
          row.original.minQty && `≥ ${row.original.minQty} t`,
        ]
          .filter(Boolean)
          .join(', ') || 'always',
    },
    {
      accessorKey: 'levelRoles',
      header: 'Approvers (in order)',
      cell: ({ getValue }) => getValue().join(' → '),
    },
    { accessorKey: 'priority', header: 'Priority', meta: { className: 'num' } },
    {
      accessorKey: 'active',
      header: 'Status',
      cell: ({ getValue }) => (
        <StatusBadge status={getValue() ? 'ACTIVE' : 'DISABLED'}>
          {getValue() ? 'Active' : 'Off'}
        </StatusBadge>
      ),
    },
    {
      id: 'edit',
      header: '',
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => setEditing(row.original)}
          aria-label={`Edit ${row.original.name}`}
        >
          <Pencil className="size-4" />
        </Button>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        icon={Scale}
        title="Approval rules"
        subtitle="Approvers marked as defaults follow PERMISSIONS §3; confirm them with the business (see TASKS P0 report)."
        crumbs={[{ label: 'Approvals' }, { label: 'Rules' }]}
        actions={
          <Button onClick={() => setEditing(null)}>
            <Plus className="size-4" aria-hidden="true" /> New rule
          </Button>
        }
      />
      <Section>
        <ProblemAlert error={q.error} className="mb-3" />
        <DataTable
          columns={columns}
          data={q.data ?? []}
          loading={q.isLoading}
          rowKey={(r) => r.ruleId}
        />
      </Section>
      {editing !== undefined && <RuleDialog rule={editing} onClose={() => setEditing(undefined)} />}
    </>
  );
}
