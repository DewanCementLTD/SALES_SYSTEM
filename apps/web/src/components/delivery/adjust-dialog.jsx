'use client';

// DO quantity adjustment advice (BR-DO-06): new quantity + reason, live preview of the difference
// (shared doAdjustment), sent for the DO_ADJUST approval.
import { doAdjustment } from '@dcl/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { fmtPKR, fmtQty } from '@/lib/format';

/**
 * @param {{ open: boolean, onOpenChange: (v: boolean) => void, d: any,
 *   onConfirm: (body: { qtyTon: string, reason: string }) => Promise<void> }} p
 */
export function AdjustDialog({ open, onOpenChange, d, onConfirm }) {
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const valid = /^\d{1,6}(\.\d{1,3})?$/.test(qty.trim());
  const calc = valid && d ? doAdjustment(d, qty.trim()) : null;
  const ok = calc && !calc.error && reason.trim().length >= 10;
  const submit = async (e) => {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm({ qtyTon: qty.trim(), reason: reason.trim() });
      setQty('');
      setReason('');
      onOpenChange(false);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-3">
          <DialogHeader>
            <DialogTitle>Adjust DO {d?.doNo} quantity</DialogTitle>
            <DialogDescription>
              Writes a DO adjustment advice. The Finance Manager approves it; then the DO and the
              customer&apos;s DO ledger change by the difference. Reprint the DO afterwards.
            </DialogDescription>
          </DialogHeader>
          {d && (
            <p className="text-sm text-muted-foreground">
              Now {fmtQty(d.qtyTon)} t, {fmtQty(d.dispatchedTon)} t dispatched
              {d.rate ? ` · ${fmtPKR(d.rate)}/t` : ''}
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="adj-qty">New quantity (t)</Label>
            <Input
              id="adj-qty"
              inputMode="decimal"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </div>
          {calc?.error && <p className="text-sm text-danger">{calc.error.detail}</p>}
          {calc && !calc.error && (
            <p className="rounded-md bg-muted p-2 text-sm" data-testid="adjust-impact">
              {calc.increase ? 'Increase' : 'Reduction'} of {fmtQty(calc.deltaTon.replace('-', ''))}{' '}
              t · {calc.increase ? 'debit' : 'credit'} {fmtPKR(calc.deltaValue.replace('-', ''))} ·
              new value {fmtPKR(calc.newValue)}
              {calc.increase ? ' (needs the available balance)' : ''}
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="adj-reason">Reason</Label>
            <Textarea
              id="adj-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">At least 10 characters.</p>
          </div>
          <ProblemAlert error={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button type="submit" disabled={!ok || busy}>
              {busy && <Loader2 className="size-4 animate-spin" />} Send for approval
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
