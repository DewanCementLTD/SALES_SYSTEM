'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  Building2,
  CheckCircle2,
  ChevronRight,
  Circle,
  LayoutDashboard,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';
import { PageHeader, Section, StatusBadge } from '@/components/common/page';
import { api } from '@/lib/api';
import { ago } from '@/lib/format';
import { PHASE_NAMES } from '@/lib/nav';
import { qk } from '@/lib/query-keys';
import { useSession } from '@/lib/session';

function greeting(d = new Date()) {
  const h = Number(
    new Intl.DateTimeFormat('en-GB', {
      hour: 'numeric',
      hour12: false,
      timeZone: 'Asia/Karachi',
    }).format(d),
  );
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function Kpi({ icon: Icon, label, value, hint, href, tone = 'bg-brand-sky text-brand-navy' }) {
  const body = (
    <div className="flex items-center gap-4 rounded-xl border bg-card p-5 shadow-xs transition-colors hover:border-ring/40">
      <div className={`grid size-12 place-items-center rounded-xl ${tone}`}>
        <Icon className="size-6" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold text-brand-navy">{value}</div>
        {hint && <div className="truncate text-xs text-muted-foreground">{hint}</div>}
      </div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

const ROADMAP = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5'];

export default function HomePage() {
  const s = useSession();
  const inbox = useQuery({
    queryKey: qk.approvalsInbox('PENDING'),
    queryFn: () => api('/approvals/inbox'),
    enabled: s.can('approval.inbox'),
  });
  const notes = useQuery({ queryKey: qk.notifications, queryFn: () => api('/notifications') });
  const fy =
    s.currentBranch?.fiscalYears.find((y) => y.year === s.fiscalYear)?.label ?? s.fiscalYear;

  return (
    <>
      <PageHeader
        icon={LayoutDashboard}
        title={`${greeting()}, ${s.user.fullName.split(' ')[0]}`}
        subtitle={`${s.currentBranch?.name} (.${s.branch}) · Fiscal year ${fy}`}
        crumbs={[{ label: 'Dashboard' }]}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {s.can('approval.inbox') && (
          <Kpi
            icon={ShieldCheck}
            label="Approvals waiting for you"
            value={inbox.data?.length ?? '…'}
            hint="Open your inbox"
            href="/approvals"
            tone="bg-warning-soft text-warning"
          />
        )}
        <Kpi
          icon={Bell}
          label="Unread notifications"
          value={notes.data?.unread ?? '…'}
          hint="From the bell in the top bar"
        />
        <Kpi
          icon={Building2}
          label="Working in"
          value={s.currentBranch?.name}
          hint={`Roles: ${s.roles.join(', ') || 'none in this branch'}`}
          tone="bg-info-soft text-info"
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Section title="Alerts & to-dos" icon={ShieldCheck}>
          {s.can('approval.inbox') && (inbox.data ?? []).length > 0 ? (
            <ul className="divide-y">
              {inbox.data.slice(0, 8).map((r) => (
                <li key={r.reqId}>
                  <Link
                    href={`/approvals/${r.reqId}`}
                    className="flex items-center gap-3 py-3 hover:text-brand-teal"
                  >
                    <StatusBadge status="PENDING">Level {r.currentLevel}</StatusBadge>
                    <span className="flex-1 truncate text-sm">
                      <span className="font-medium">{r.docType.replace(/_/g, ' ')}</span> ·{' '}
                      {r.docKey}
                    </span>
                    <span className="text-xs text-muted-foreground">{ago(r.requestedOn)}</span>
                    <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nothing waiting for you. Sales and plant KPIs (orders, dispatch, collections, trucks
              inside) appear here when those modules go live (P2–P5).
            </p>
          )}
        </Section>

        <Section title="Build roadmap" icon={CheckCircle2}>
          <ol className="space-y-3">
            {ROADMAP.map((p) => (
              <li key={p} className="flex items-center gap-3">
                {p === 'P0' ? (
                  <CheckCircle2 className="size-5 text-success" aria-hidden="true" />
                ) : (
                  <Circle className="size-5 text-muted-foreground/50" aria-hidden="true" />
                )}
                <span className="w-8 font-semibold text-brand-navy">{p}</span>
                <span className="flex-1 text-sm">{PHASE_NAMES[p]}</span>
                {p === 'P0' && <StatusBadge tone="info">In review</StatusBadge>}
              </li>
            ))}
          </ol>
        </Section>
      </div>
    </>
  );
}
