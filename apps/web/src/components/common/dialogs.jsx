'use client';

// Standard dialogs. ReasonDialog is THE cancel/override dialog used everywhere (PRD 4.14):
// required reason (≥ 10 characters), optional impact preview, approval notice.
import { Copy, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ProblemAlert } from './page';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/**
 * @param {{ open: boolean, onOpenChange: (v: boolean) => void, title: string, description?: string,
 *   impact?: React.ReactNode, approvalNotice?: string, confirmLabel?: string, destructive?: boolean,
 *   minLength?: number, onConfirm: (reason: string) => Promise<void> }} props
 */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  impact,
  approvalNotice,
  confirmLabel = 'Confirm',
  destructive,
  minLength = 10,
  onConfirm,
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ok = reason.trim().length >= minLength;

  const submit = async (e) => {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
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
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          {impact && <div className="mt-4 rounded-lg border bg-muted/50 p-3 text-sm">{impact}</div>}
          <div className="mt-4 space-y-1.5">
            <Label htmlFor="reason">Reason</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              aria-describedby="reason-hint"
            />
            <p id="reason-hint" className="text-xs text-muted-foreground">
              Required, at least {minLength} characters. Saved in the audit log.
            </p>
          </div>
          {approvalNotice && (
            <p className="mt-3 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
              {approvalNotice}
            </p>
          )}
          <ProblemAlert error={error} className="mt-3" />
          <DialogFooter className="mt-5">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Back
            </Button>
            <Button
              type="submit"
              variant={destructive ? 'destructive' : 'default'}
              disabled={!ok || busy}
            >
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Shows a one-time secret (temporary password) with a copy button. */
export function OneTimeSecretDialog({ open, onOpenChange, title, secret, note }) {
  const copy = async () => {
    await navigator.clipboard.writeText(secret);
    toast.success('Copied');
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {note ?? 'Shown only once. Give it to the user; they must change it at first sign-in.'}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-2 flex items-center gap-2 rounded-lg border bg-muted px-3 py-2 font-mono text-lg">
          <span className="flex-1 select-all break-all">{secret}</span>
          <Button variant="ghost" size="icon" onClick={copy} aria-label="Copy">
            <Copy className="size-4" />
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
