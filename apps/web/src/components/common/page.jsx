// Page building blocks in the mockup style: breadcrumb, icon tile + large title, white cards,
// status pills, problem alerts.
import { AlertTriangle, ChevronRight, Home } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export function PageHeader({ icon: Icon, title, subtitle, crumbs = [], actions }) {
  return (
    <div className="mb-6">
      <nav
        aria-label="Breadcrumb"
        className="mb-3 flex items-center gap-1.5 text-sm text-muted-foreground"
      >
        <Link href="/" className="hover:text-foreground" aria-label="Home">
          <Home className="size-4" aria-hidden="true" />
        </Link>
        {crumbs.map((c, i) => (
          <span key={`${i}-${c.label}`} className="flex items-center gap-1.5">
            <ChevronRight className="size-3.5" aria-hidden="true" />
            {c.href && i < crumbs.length - 1 ? (
              <Link href={c.href} className="hover:text-foreground">
                {c.label}
              </Link>
            ) : (
              <span className={cn(i === crumbs.length - 1 && 'font-medium text-foreground')}>
                {c.label}
              </span>
            )}
          </span>
        ))}
      </nav>
      <div className="flex flex-wrap items-center gap-4">
        {Icon && (
          <div className="grid size-12 place-items-center rounded-xl border bg-white text-brand-navy shadow-xs">
            <Icon className="size-6" aria-hidden="true" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-brand-navy md:text-[28px]">
            {title}
          </h1>
          {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Section({ title, icon: Icon, actions, children, className, bodyClassName }) {
  return (
    <section className={cn('rounded-xl border bg-card shadow-xs', className)}>
      {(title || actions) && (
        <header className="flex items-center gap-3 border-b px-5 py-3.5">
          {Icon && <Icon className="size-5 text-brand-navy" aria-hidden="true" />}
          <h2 className="flex-1 text-lg font-semibold text-brand-navy">{title}</h2>
          {actions}
        </header>
      )}
      <div className={cn('p-5', bodyClassName)}>{children}</div>
    </section>
  );
}

const TONES = {
  success: 'bg-success-soft text-success border-success/20',
  warning: 'bg-warning-soft text-warning border-warning/25',
  danger: 'bg-danger-soft text-danger border-danger/20',
  info: 'bg-info-soft text-info border-info/20',
  neutral: 'bg-muted text-muted-foreground border-border',
};

const STATUS_TONE = {
  ACTIVE: 'success',
  APPROVED: 'success',
  SENT: 'success',
  VERIFIED: 'success',
  PENDING: 'warning',
  PENDING_APPROVAL: 'warning',
  PROCESSING: 'info',
  LOCKED: 'danger',
  REJECTED: 'danger',
  FAILED: 'danger',
  DEAD: 'danger',
  DISABLED: 'neutral',
  CANCELLED: 'neutral',
  EXPIRED: 'neutral',
};

export function StatusBadge({ status, tone, children, className }) {
  const t = tone ?? STATUS_TONE[status] ?? 'neutral';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold',
        TONES[t],
        className,
      )}
    >
      {children ??
        String(status ?? '')
          .replace(/_/g, ' ')
          .toLowerCase()
          .replace(/^\w/, (c) => c.toUpperCase())}
    </span>
  );
}

/** Problem+json error shown in plain words with the request id for support. */
export function ProblemAlert({ error, className }) {
  if (!error) return null;
  return (
    <div
      role="alert"
      className={cn(
        'flex gap-3 rounded-lg border border-danger/25 bg-danger-soft px-4 py-3 text-sm text-danger',
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div>
        <div className="font-medium">{error.message}</div>
        {error.errors?.length > 0 && (
          <ul className="mt-1 list-disc pl-4">
            {error.errors.map((e) => (
              <li key={e.path}>
                {e.path.replace(/^body\./, '')}: {e.message}
              </li>
            ))}
          </ul>
        )}
        {error.ruleId && <div className="mt-1 text-xs opacity-80">Rule {error.ruleId}</div>}
        {error.requestId && (
          <div className="mt-1 text-xs opacity-70">Reference: {error.requestId}</div>
        )}
      </div>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      {Icon && <Icon className="size-10 text-muted-foreground/60" aria-hidden="true" />}
      <div className="font-medium">{title}</div>
      {children && <div className="max-w-md text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}
