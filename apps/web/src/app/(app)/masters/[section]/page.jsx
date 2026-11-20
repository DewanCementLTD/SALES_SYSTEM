'use client';

// Masters screens (TASKS P1-01). Sections not built yet (trade prices, rate sheets …) fall back to
// the planned-screen page.
import { MASTERS } from '@dcl/shared';
import { Warehouse } from 'lucide-react';
import { parseAsString, useQueryState } from 'nuqs';
import { useParams } from 'next/navigation';
import PlannedPage from '@/app/(app)/[...slug]/page';
import { PageHeader, Section } from '@/components/common/page';
import { MasterTable } from '@/components/masters/master-table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MASTER_SECTIONS } from '@/lib/masters-sections';

export default function MasterSectionPage() {
  const { section } = useParams();
  const conf = MASTER_SECTIONS[section];
  const [tab, setTab] = useQueryState('tab', parseAsString.withDefault(conf?.tabs[0] ?? ''));
  if (!conf) return <PlannedPage />;
  const current = conf.tabs.includes(tab) ? tab : conf.tabs[0];

  return (
    <>
      <PageHeader
        icon={Warehouse}
        title={conf.title}
        subtitle="Masters are per branch. Records are deactivated, never deleted."
        crumbs={[{ label: 'Masters' }, { label: conf.title }]}
      />
      <Section>
        {conf.tabs.length === 1 ? (
          <MasterTable def={MASTERS[current]} />
        ) : (
          <Tabs value={current} onValueChange={setTab}>
            <TabsList className="mb-4">
              {conf.tabs.map((t) => (
                <TabsTrigger key={t} value={t}>
                  {MASTERS[t].title}
                </TabsTrigger>
              ))}
            </TabsList>
            {conf.tabs.map((t) => (
              <TabsContent key={t} value={t}>
                {t === current && <MasterTable def={MASTERS[t]} />}
              </TabsContent>
            ))}
          </Tabs>
        )}
      </Section>
    </>
  );
}
