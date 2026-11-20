'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  CalendarDays,
  ChevronDown,
  KeyRound,
  LogOut,
  MapPin,
  Menu,
  Search,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { BrandBlock } from './brand';
import { SidebarNav } from './sidebar';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { api } from '@/lib/api';
import { ago, initials } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useLogout, useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

const ROLE_LABEL = {
  SYS_ADMIN: 'System Administrator',
  BRANCH_ADMIN: 'Branch Administrator',
  MARKETING: 'Marketing / Sales',
  SALES_MANAGER: 'Sales Manager',
  FINANCE: 'Finance',
  FINANCE_MANAGER: 'Finance Manager',
  CFO: 'CFO',
  CUSTOMER_APPROVER: 'Customer Approver',
  GATE_OPERATOR: 'Gate Operator',
  WEIGH_OPERATOR: 'Weighbridge Operator',
  DISPATCH_SUPERVISOR: 'Dispatch Supervisor',
  PLANT_MANAGER: 'Plant Manager',
  MANAGEMENT: 'Management',
  AUDITOR: 'Auditor',
};

function useSwitchBranch() {
  const qc = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: (body) => api('/auth/switch-branch', { method: 'POST', body }),
    onSuccess: async (me) => {
      qc.clear();
      qc.setQueryData(qk.me, me);
      toast.success(
        `Switched to ${me.branches.find((b) => b.brnch === me.branch)?.name}, FY ${me.fiscalYear}`,
      );
      router.refresh();
    },
    onError: (e) => toast.error(e.message),
  });
}

function BranchSwitcher() {
  const s = useSession();
  const sw = useSwitchBranch();
  const change = (brnch) => {
    const b = s.branches.find((x) => x.brnch === Number(brnch));
    const fy = b.fiscalYears.find((y) => y.year === s.fiscalYear)?.year ?? b.fiscalYears[0]?.year;
    sw.mutate({ brnch: b.brnch, fiscalYear: fy });
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="h-10 gap-2 bg-white"
          disabled={sw.isPending}
          data-testid="branch-switcher"
        >
          <MapPin className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="hidden text-muted-foreground sm:inline">Branch:</span>
          <span className="font-semibold">{s.currentBranch?.name}</span>
          <ChevronDown className="size-4 opacity-60" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Branch</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={String(s.branch)} onValueChange={change}>
          {s.branches.map((b) => (
            <DropdownMenuRadioItem key={b.brnch} value={String(b.brnch)}>
              {b.name} <span className="ml-auto text-xs text-muted-foreground">.{b.brnch}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FiscalYearSwitcher() {
  const s = useSession();
  const sw = useSwitchBranch();
  const years = s.currentBranch?.fiscalYears ?? [];
  const label = years.find((y) => y.year === s.fiscalYear)?.label ?? s.fiscalYear;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="hidden h-10 gap-2 bg-white md:inline-flex"
          disabled={sw.isPending}
        >
          <CalendarDays className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="text-muted-foreground">FY:</span>
          <span className="font-semibold">{label}</span>
          <ChevronDown className="size-4 opacity-60" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuLabel>Fiscal year</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={String(s.fiscalYear)}
          onValueChange={(y) => sw.mutate({ brnch: s.branch, fiscalYear: Number(y) })}
        >
          {years.map((y) => (
            <DropdownMenuRadioItem key={y.year} value={String(y.year)}>
              {y.label}
              {y.closed && <span className="ml-auto text-xs text-muted-foreground">closed</span>}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NotificationsBell() {
  const qc = useQueryClient();
  const router = useRouter();
  const q = useQuery({
    queryKey: qk.notifications,
    queryFn: () => api('/notifications'),
    refetchInterval: 60_000,
  });
  const readAll = useMutation({
    mutationFn: () => api('/notifications/read-all', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.notifications }),
  });
  const open = async (n) => {
    if (!n.readOn) await api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => {});
    qc.invalidateQueries({ queryKey: qk.notifications });
    if (n.link) router.push(n.link);
  };
  const unread = q.data?.unread ?? 0;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-10"
          aria-label={`Notifications, ${unread} unread`}
        >
          <Bell className="size-5" aria-hidden="true" />
          {unread > 0 && (
            <span className="absolute right-1 top-1 grid min-w-[18px] place-items-center rounded-full bg-brand-orange px-1 text-[10px] font-bold leading-[18px] text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="font-semibold">Notifications</span>
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0"
            disabled={!unread}
            onClick={() => readAll.mutate()}
          >
            Mark all read
          </Button>
        </div>
        <ul className="max-h-96 overflow-y-auto">
          {(q.data?.items ?? []).length === 0 && (
            <li className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing new.</li>
          )}
          {(q.data?.items ?? []).map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => open(n)}
                className={cn(
                  'flex w-full gap-3 border-b px-4 py-3 text-left hover:bg-muted',
                  !n.readOn && 'bg-brand-sky/60',
                )}
              >
                <span
                  className={cn(
                    'mt-1.5 size-2 shrink-0 rounded-full',
                    n.readOn ? 'bg-transparent' : 'bg-brand-orange',
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{n.title}</span>
                  {n.body && (
                    <span className="block truncate text-xs text-muted-foreground">{n.body}</span>
                  )}
                  <span className="text-[11px] text-muted-foreground">{ago(n.createdOn)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function ApprovalsBadge() {
  const s = useSession();
  const q = useQuery({
    queryKey: qk.approvalsInbox('PENDING'),
    queryFn: () => api('/approvals/inbox'),
    enabled: s.can('approval.inbox'),
    refetchInterval: 60_000,
  });
  if (!s.can('approval.inbox')) return null;
  const n = q.data?.length ?? 0;
  return (
    <Button
      asChild
      variant="ghost"
      size="icon"
      className="relative size-10"
      aria-label={`Approvals, ${n} waiting`}
    >
      <Link href="/approvals">
        <ShieldCheck className="size-5" aria-hidden="true" />
        {n > 0 && (
          <span className="absolute right-1 top-1 grid min-w-[18px] place-items-center rounded-full bg-brand-teal px-1 text-[10px] font-bold leading-[18px] text-white">
            {n}
          </span>
        )}
      </Link>
    </Button>
  );
}

function UserMenu() {
  const s = useSession();
  const logout = useLogout();
  // most senior role first (ROLE_LABEL is ordered by seniority)
  const top = Object.keys(ROLE_LABEL).find((r) => s.roles.includes(r)) ?? s.roles[0];
  const role = ROLE_LABEL[top] ?? top ?? 'No role in this branch';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-3 rounded-md px-1.5 py-1 hover:bg-muted"
          data-testid="user-menu"
        >
          <Avatar className="size-10">
            <AvatarFallback className="bg-brand-navy font-semibold text-white">
              {initials(s.user.fullName)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden max-w-44 text-left leading-tight md:block">
            <span className="block truncate text-sm font-semibold">{s.user.fullName}</span>
            <span className="block truncate text-xs text-muted-foreground">{role}</span>
          </span>
          <ChevronDown className="hidden size-4 opacity-60 md:block" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="text-sm font-semibold">{s.user.fullName}</div>
          <div className="text-xs text-muted-foreground">{s.user.usrid}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/change-password">
            <KeyRound className="size-4" aria-hidden="true" /> Change password
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={logout} data-testid="sign-out">
          <LogOut className="size-4" aria-hidden="true" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Topbar({ onOpenSearch }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 flex h-[68px] items-center gap-3 border-b bg-white/95 px-4 backdrop-blur lg:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={() => setMobileOpen(true)}
        aria-label="Open menu"
      >
        <Menu className="size-5" aria-hidden="true" />
      </Button>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 border-0 bg-brand-navy p-0 text-white">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <BrandBlock />
          <SidebarNav onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <button
        type="button"
        onClick={onOpenSearch}
        className="hidden h-10 w-full max-w-md items-center gap-3 rounded-lg border bg-white px-3 text-sm text-muted-foreground shadow-xs hover:border-ring/50 md:flex"
      >
        <Search className="size-4" aria-hidden="true" />
        <span className="flex-1 text-left">Search customers, orders, invoices…</span>
        <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[11px] font-medium">Ctrl K</kbd>
      </button>
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={onOpenSearch}
        aria-label="Search"
      >
        <Search className="size-5" aria-hidden="true" />
      </Button>

      <div className="ml-auto flex items-center gap-2">
        <BranchSwitcher />
        <FiscalYearSwitcher />
        <ApprovalsBadge />
        <NotificationsBell />
        <UserMenu />
      </div>
    </header>
  );
}
