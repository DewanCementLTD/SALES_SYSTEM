'use client';

// Screens of later phases: the navigation is complete from day one (PRD §3); each planned screen
// says which release builds it. Unknown paths show a not-found message.
import { Construction, SearchX } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { EmptyState, PageHeader, Section } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { PHASE_NAMES, navItemFor } from '@/lib/nav';
import { useSession } from '@/lib/session';

export default function PlannedPage() {
  const pathname = usePathname();
  const s = useSession();
  const match = navItemFor(pathname);

  if (!match || match.item.href !== pathname) {
    return (
      <Section>
        <EmptyState icon={SearchX} title="Page not found">
          <Button asChild variant="link">
            <Link href="/">Back to the dashboard</Link>
          </Button>
        </EmptyState>
      </Section>
    );
  }
  const { group, item } = match;
  const allowed = !item.perm || item.perm.some((k) => s.permissionSet.has(k));
  return (
    <>
      <PageHeader
        icon={group.icon}
        title={item.label}
        crumbs={[{ label: group.label }, { label: item.label }]}
      />
      <Section>
        <EmptyState
          icon={Construction}
          title={
            allowed ? `Planned for ${item.phase} — ${PHASE_NAMES[item.phase]}` : 'Not available'
          }
        >
          {allowed
            ? 'This screen is part of the approved scope and is built in the phase shown. Your access to it is already set up.'
            : `You need ${item.perm.join(' or ')} to do this.`}
        </EmptyState>
      </Section>
    </>
  );
}
