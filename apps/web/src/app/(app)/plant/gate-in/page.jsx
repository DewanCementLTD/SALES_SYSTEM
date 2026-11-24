'use client';

// Plant › Gate-in (PRD 4.9, TASKS P3-04): scan the DO QR (USB scanner types into the field and
// presses Enter) or look the DO up by number (gate.manual_lookup + reason), plan bags/tons per DO,
// vehicle + driver + transporter + bilty, then issue the gate pass and DC (BR-GATE-01…06).
import { useQuery } from '@tanstack/react-query';
import { DoorOpen, Loader2, QrCode, Search, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { QR_REASONS, offlineQrCheck } from '@dcl/shared';
import { ReasonDialog } from '@/components/common/dialogs';
import { PageHeader, ProblemAlert, Section, StatusBadge } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { OfflineBanner } from '@/components/plant/offline-banner';
import { api } from '@/lib/api';
import { cachedDocs, isOffline, queueEvent } from '@/lib/offline';
import { fmtQty } from '@/lib/format';
import { useSession } from '@/lib/session';

const REASON_TEXT = {
  ON_HOLD: 'on hold',
  OLD_VERSION: 'old print',
  BAD_SIGNATURE: 'forged?',
  WRONG_BRANCH: 'other plant',
  NOT_OPEN: 'closed',
  UNKNOWN: 'not found',
};
const blankDriver = { cnic: '', name: '', mobile: '' };

export default function GateInPage() {
  const s = useSession();
  const [scanText, setScanText] = useState('');
  const [docs, setDocs] = useState([]); // cards + plannedBags/plannedTon
  const [packingType, setPackingType] = useState('BAG');
  const [vehicleNo, setVehicleNo] = useState('');
  const [driver, setDriver] = useState(blankDriver);
  const [transpCode, setTranspCode] = useState('');
  const [biltyNo, setBiltyNo] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [lookupNo, setLookupNo] = useState('');
  const [done, setDone] = useState(null);
  const lookups = useQuery({
    queryKey: ['lookups', 'transporters', s.branch],
    queryFn: () => api('/lookups?types=transporters'),
  });

  const addCard = (card) => {
    if (card.docType !== 'DO') {
      setError({ message: 'Gate-in for permits is not available yet (delivery memo mapping).' });
      return;
    }
    if (docs.some((d) => d.docNo === card.docNo)) {
      toast.info(`DO ${card.doNo} is already on this truck`);
      return;
    }
    setDocs((x) => [...x, { ...card, plannedBags: '', plannedTon: '' }]);
    toast.success(`DO ${card.doNo} added: ${fmtQty(card.remainingTon)} t left`);
  };
  const scan = async (e) => {
    e.preventDefault();
    if (!scanText.trim()) return;
    setBusy('scan');
    setError(null);
    try {
      addCard(await api('/plant/scan', { method: 'POST', body: { qr: scanText.trim() } }));
      setScanText('');
    } catch (err) {
      if (isOffline(err)) {
        // BR-OFF-02: check the signed QR against the cached open documents
        const cache = await cachedDocs(s.branch);
        const r = offlineQrCheck(scanText.trim(), cache?.entries ?? [], s.branch);
        if (r.ok) {
          const [doType, doNo] = r.entry.docNo.split('-');
          addCard({ ...r.entry, doType, doNo });
          setScanText('');
          toast.info('Offline: checked against the cached documents');
        } else setError({ message: `${QR_REASONS[r.reason]} (offline check)` });
        return;
      }
      const reason = err.data?.reason;
      setError(
        reason ? { ...err, message: `${err.message} (${REASON_TEXT[reason] ?? reason})` } : err,
      );
    } finally {
      setBusy(null);
    }
  };
  const lookup = async (reason) => {
    const r = await api('/plant/lookup', {
      method: 'POST',
      body: { docType: 'DO', docNo: lookupNo.trim(), reason },
    });
    if (!r.items.length) throw new Error(`No DO ${lookupNo} in this plant`);
    for (const c of r.items) addCard(c);
    setLookupNo('');
  };
  const submit = async (e) => {
    e.preventDefault();
    setBusy('in');
    setError(null);
    const clientId = crypto.randomUUID();
    const body = {
      route: 'DO',
      packingType,
      vehicleNo,
      driver,
      transpCode,
      ...(biltyNo.trim() ? { biltyNo: biltyNo.trim() } : {}),
      docs: docs.map((d) =>
        packingType === 'BAG'
          ? { doType: d.doType, doNo: d.doNo, plannedBags: Number(d.plannedBags) }
          : { doType: d.doType, doNo: d.doNo, plannedTon: String(d.plannedTon).trim() },
      ),
    };
    const reset = () => {
      setDocs([]);
      setVehicleNo('');
      setDriver(blankDriver);
      setBiltyNo('');
    };
    try {
      const gp = await api('/plant/gate-passes', {
        method: 'POST',
        headers: { 'idempotency-key': crypto.randomUUID() },
        body: { ...body, clientId },
      });
      setDone(gp);
      reset();
      toast.success(`Gate pass ${gp.gpId} · DC ${gp.dcNo} issued`);
    } catch (err) {
      if (isOffline(err)) {
        // BR-OFF-03: saved here; the DC number comes when the event syncs
        await queueEvent('GATE_IN', body, clientId);
        setDone({ offline: true, clientId, vehicleNo, plannedKg: planned * 1000 });
        reset();
        toast.warning('Offline: gate-in saved on this tablet; the DC number comes after sync');
      } else setError(err);
    } finally {
      setBusy(null);
    }
  };
  const planned = docs.reduce(
    (t, d) =>
      t + (packingType === 'BAG' ? (Number(d.plannedBags) || 0) / 20 : Number(d.plannedTon) || 0),
    0,
  );

  return (
    <>
      <PageHeader
        icon={DoorOpen}
        title="Gate-in"
        subtitle="Scan the DO, plan the load, record the truck and driver. The gate pass and DC are issued here."
        crumbs={[{ label: 'Plant' }, { label: 'Gate-in' }]}
      />
      <OfflineBanner />
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Section title="1. Documents">
            <form onSubmit={scan} className="flex flex-wrap items-end gap-2">
              <div className="min-w-64 flex-1 space-y-1.5">
                <Label htmlFor="gi-scan">Scan the DO QR (or paste it)</Label>
                <Input
                  id="gi-scan"
                  value={scanText}
                  onChange={(e) => setScanText(e.target.value)}
                  placeholder="DCL|DO|1|…"
                />
              </div>
              <Button type="submit" disabled={busy === 'scan'}>
                {busy === 'scan' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <QrCode className="size-4" />
                )}{' '}
                Check
              </Button>
              {s.can('gate.manual_lookup') && (
                <div className="flex items-end gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="gi-no">DO number</Label>
                    <Input
                      id="gi-no"
                      className="w-40"
                      value={lookupNo}
                      onChange={(e) => setLookupNo(e.target.value)}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!lookupNo.trim()}
                    onClick={() => setLookupOpen(true)}
                  >
                    <Search className="size-4" /> Find without QR
                  </Button>
                </div>
              )}
            </form>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm [&_td]:px-2 [&_th]:px-2">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2">DO</th>
                    <th>Customer</th>
                    <th>Product · destination</th>
                    <th className="text-right">Left (t)</th>
                    <th className="w-36">{packingType === 'BAG' ? 'Bags' : 'Tons'}</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d, i) => (
                    <tr key={d.docNo} className="border-b">
                      <td className="py-2 font-mono">
                        {d.doType} {d.doNo}
                      </td>
                      <td>
                        {d.customerCode} {d.customerName ?? ''}
                      </td>
                      <td>
                        {d.productCode} · {d.destName ?? '—'}
                      </td>
                      <td className="text-right tabular-nums">{fmtQty(d.remainingTon)}</td>
                      <td>
                        <Input
                          aria-label={`Planned ${packingType === 'BAG' ? 'bags' : 'tons'} for DO ${d.doNo}`}
                          inputMode="decimal"
                          value={packingType === 'BAG' ? d.plannedBags : d.plannedTon}
                          onChange={(e) =>
                            setDocs((x) =>
                              x.map((y, j) =>
                                j === i
                                  ? {
                                      ...y,
                                      [packingType === 'BAG' ? 'plannedBags' : 'plannedTon']:
                                        e.target.value,
                                    }
                                  : y,
                              ),
                            )
                          }
                        />
                      </td>
                      <td>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Remove DO ${d.doNo}`}
                          onClick={() => setDocs((x) => x.filter((_, j) => j !== i))}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {!docs.length && (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-muted-foreground">
                        No DO yet. Scan the DO print the driver brought.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="2. Truck and driver">
            <form
              id="gate-in"
              onSubmit={submit}
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            >
              <div className="space-y-1.5">
                <Label htmlFor="gi-pack">Packing</Label>
                <Select value={packingType} onValueChange={setPackingType}>
                  <SelectTrigger id="gi-pack">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BAG">Bags</SelectItem>
                    <SelectItem value="BULK">Bulker (tons)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gi-veh">Vehicle no</Label>
                <Input
                  id="gi-veh"
                  value={vehicleNo}
                  onChange={(e) => setVehicleNo(e.target.value.toUpperCase())}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gi-tr">Transporter</Label>
                <Select value={transpCode} onValueChange={setTranspCode}>
                  <SelectTrigger id="gi-tr">
                    <SelectValue placeholder="Choose" />
                  </SelectTrigger>
                  <SelectContent>
                    {(lookups.data?.transporters ?? [])
                      .filter((x) => x.active)
                      .map((x) => (
                        <SelectItem key={x.value} value={x.value}>
                          {x.label}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gi-cnic">Driver CNIC</Label>
                <Input
                  id="gi-cnic"
                  inputMode="numeric"
                  placeholder="42101-1234567-1"
                  value={driver.cnic}
                  onChange={(e) => setDriver({ ...driver, cnic: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gi-dn">Driver name</Label>
                <Input
                  id="gi-dn"
                  value={driver.name}
                  onChange={(e) => setDriver({ ...driver, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gi-dm">Driver mobile</Label>
                <Input
                  id="gi-dm"
                  inputMode="tel"
                  placeholder="03XXXXXXXXX"
                  value={driver.mobile}
                  onChange={(e) => setDriver({ ...driver, mobile: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gi-bilty">Bilty no</Label>
                <Input id="gi-bilty" value={biltyNo} onChange={(e) => setBiltyNo(e.target.value)} />
              </div>
            </form>
          </Section>
        </div>

        <aside className="space-y-4">
          <Section title="Gate pass" className="xl:sticky xl:top-20">
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">DOs</dt>
                <dd>{docs.length}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Planned</dt>
                <dd className="tabular-nums">{fmtQty(planned)} t</dd>
              </div>
            </dl>
            <ProblemAlert error={error} className="mt-3" />
            <Button
              type="submit"
              form="gate-in"
              className="mt-4 w-full"
              disabled={!docs.length || busy === 'in'}
            >
              {busy === 'in' && <Loader2 className="size-4 animate-spin" />} Issue gate pass and DC
            </Button>
            {done && (
              <div className="mt-4 rounded-md border bg-success/10 p-3 text-sm">
                <div className="font-medium">
                  {done.offline ? (
                    <>
                      Saved offline · ref {done.clientId.slice(0, 8)}{' '}
                      <StatusBadge tone="warning">waiting to sync</StatusBadge>
                    </>
                  ) : (
                    <>
                      Gate pass {done.gpId} · DC {done.dcNo}{' '}
                      <StatusBadge tone="success">{done.status.toLowerCase()}</StatusBadge>
                    </>
                  )}
                </div>
                <div className="text-muted-foreground">
                  {done.vehicleNo} · {fmtQty(done.plannedKg / 1000)} t planned. Send the truck to
                  the weighbridge.
                </div>
                <Link
                  href="/plant/queue"
                  className="mt-2 inline-block text-primary hover:underline"
                >
                  Plant queue
                </Link>
              </div>
            )}
          </Section>
        </aside>
      </div>
      <ReasonDialog
        open={lookupOpen}
        onOpenChange={setLookupOpen}
        title={`Find DO ${lookupNo} without its QR`}
        description="Allowed when the print cannot be scanned. The reason is recorded in the audit log."
        confirmLabel="Find"
        onConfirm={lookup}
      />
    </>
  );
}
