'use client';

// Command palette (Ctrl+K or "/"): jump to any screen the user may open. Document/customer
// search joins here when those modules exist (P1/P2).
import { useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { visibleNav } from '@/lib/nav';
import { useSession } from '@/lib/session';

export function CommandMenu({ open, onOpenChange }) {
  const router = useRouter();
  const session = useSession();
  const groups = useMemo(() => visibleNav(session.permissionSet), [session.permissionSet]);

  useEffect(() => {
    const onKey = (e) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(
        document.activeElement?.tagName ?? '',
      );
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        onOpenChange(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onOpenChange]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Go to"
      description="Search screens"
    >
      <CommandInput placeholder="Type a screen name… (customer and document search arrive with P1/P2)" />
      <CommandList>
        <CommandEmpty>No match.</CommandEmpty>
        {groups.map((g) => (
          <CommandGroup key={g.id} heading={g.label}>
            {g.items.map((i) => (
              <CommandItem
                key={i.href}
                value={`${g.label} ${i.label}`}
                onSelect={() => {
                  onOpenChange(false);
                  router.push(i.href);
                }}
              >
                <g.icon className="size-4" aria-hidden="true" />
                {i.label}
                {i.phase !== 'P0' && (
                  <span className="ml-auto text-xs text-muted-foreground">{i.phase}</span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
