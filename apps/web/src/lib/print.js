// Queue a document print and open the PDF once the worker has stored it (GET /files lists the
// files of an entity; the new attachment is the one that was not there before).
import { toast } from 'sonner';
import { api } from '@/lib/api';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {{ path: string, entity: string, entityKey: string, label: string }} p
 *   path = the print command (e.g. `/oc/2/227000758/print`)
 */
export async function printAndOpen({ path, entity, entityKey, label }) {
  const filesOf = () =>
    api(`/files?entity=${entity}&key=${encodeURIComponent(entityKey)}`).then((r) => r.items);
  const before = new Set((await filesOf()).map((x) => x.attId));
  await api(path, { method: 'POST', body: {} });
  toast.info(`Preparing the ${label} print…`);
  for (let i = 0; i < 20; i += 1) {
    await sleep(1500);
    const f = (await filesOf()).find((x) => !before.has(x.attId));
    if (f) {
      window.open(`/api/v1/files/${f.attId}`, '_blank', 'noopener');
      return true;
    }
  }
  toast.warning('The print is still being prepared. Try again in a minute.');
  return false;
}
