'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import { BrandBlock } from './brand';
import { BUILT_PHASES, navItemFor, visibleNav } from '@/lib/nav';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'dcl.sidebar.open';

/** Groups the user left open last time (the shell renders client-side only, after the session loads). */
function loadOpen() {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function SidebarNav({ onNavigate }) {
  const session = useSession();
  const pathname = usePathname();
  const groups = useMemo(() => visibleNav(session.permissionSet), [session.permissionSet]);
  const active = navItemFor(pathname);
  const [stored, setStored] = useState(loadOpen);
  // the group of the current page is always expanded
  const open = active ? [...new Set([...stored, active.group.id])] : stored;

  const toggle = (id) =>
    setStored((o) => {
      const next = o.includes(id) ? o.filter((x) => x !== id) : [...o, id];
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* storage blocked: keep in memory */
      }
      return next;
    });

  return (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-4">
      <ul className="space-y-1">
        {groups.map((g) => {
          const Icon = g.icon;
          const single = g.items.length === 1 && g.id === 'home';
          const isActiveGroup = active?.group.id === g.id;
          if (single) {
            const item = g.items[0];
            const isActive = active?.item.href === item.href;
            return (
              <li key={g.id}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'relative flex items-center gap-3 rounded-md px-3 py-2.5 text-[15px] font-medium text-sidebar-foreground transition-colors hover:bg-white/5 hover:text-white',
                    isActive &&
                      'bg-sidebar-active text-white before:absolute before:inset-y-1 before:left-0 before:w-1 before:rounded-r before:bg-brand-orange',
                  )}
                >
                  <Icon className="size-5 shrink-0" aria-hidden="true" />
                  {item.label === 'Dashboard' ? 'Dashboard' : g.label}
                </Link>
              </li>
            );
          }
          const expanded = open.includes(g.id);
          return (
            <li key={g.id}>
              <button
                type="button"
                onClick={() => toggle(g.id)}
                aria-expanded={expanded}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-[15px] font-medium text-sidebar-foreground transition-colors hover:bg-white/5 hover:text-white',
                  isActiveGroup && 'text-white',
                )}
              >
                <Icon className="size-5 shrink-0" aria-hidden="true" />
                <span className="flex-1">{g.label}</span>
                <ChevronRight
                  className={cn('size-4 transition-transform', expanded && 'rotate-90')}
                  aria-hidden="true"
                />
              </button>
              {expanded && (
                <ul className="mb-1 ml-5 mt-0.5 space-y-0.5 border-l border-sidebar-border pl-3">
                  {g.items.map((item) => {
                    const isActive = active?.item.href === item.href;
                    const planned = !BUILT_PHASES.has(item.phase) && !item.built;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={onNavigate}
                          aria-current={isActive ? 'page' : undefined}
                          className={cn(
                            'relative flex items-center justify-between gap-2 rounded-md px-3 py-1.5 text-sm text-sidebar-foreground/85 transition-colors hover:bg-white/5 hover:text-white',
                            isActive &&
                              'bg-sidebar-active font-medium text-white before:absolute before:inset-y-1 before:-left-[13px] before:w-1 before:rounded-r before:bg-brand-orange',
                          )}
                        >
                          <span className="truncate">{item.label}</span>
                          {planned && (
                            <span className="rounded bg-white/10 px-1.5 py-px text-[10px] font-medium tracking-wide text-sidebar-foreground/70">
                              {item.phase}
                            </span>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 flex-col bg-gradient-to-b from-brand-navy to-brand-navy-deep lg:flex">
      <BrandBlock />
      <SidebarNav />
      <div className="border-t border-sidebar-border px-5 py-3 text-[11px] text-sidebar-foreground/60">
        DCL Sales &amp; Dispatch · P1
      </div>
    </aside>
  );
}
