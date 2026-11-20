'use client';

// Branch access + roles per branch (PERMISSIONS model: user → roles per branch).
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

const BRANCHES = [
  { brnch: 1, name: 'Karachi' },
  { brnch: 2, name: 'Islamabad / Hattar' },
];

/**
 * @param {{ value: { brnch: number, isDefault: boolean, roles: string[] }[], onChange: (v: any[]) => void,
 *   roles: { code: string, name: string, active: boolean }[] }} props
 */
export function AccessEditor({ value, onChange, roles }) {
  const entry = (b) => value.find((a) => a.brnch === b);
  const setEntry = (b, patch) => {
    const cur = entry(b);
    if (!cur) return;
    onChange(
      value.map((a) =>
        a.brnch === b ? { ...a, ...patch } : patch.isDefault ? { ...a, isDefault: false } : a,
      ),
    );
  };
  const toggleBranch = (b, on) => {
    if (on) onChange([...value, { brnch: b, isDefault: value.length === 0, roles: [] }]);
    else onChange(value.filter((a) => a.brnch !== b));
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {BRANCHES.map((b) => {
        const e = entry(b.brnch);
        return (
          <fieldset key={b.brnch} className="rounded-lg border p-4">
            <legend className="sr-only">{b.name}</legend>
            <div className="flex items-center justify-between">
              <Label htmlFor={`br-${b.brnch}`} className="text-base font-semibold text-brand-navy">
                {b.name} <span className="font-normal text-muted-foreground">(.{b.brnch})</span>
              </Label>
              <Switch
                id={`br-${b.brnch}`}
                checked={Boolean(e)}
                onCheckedChange={(on) => toggleBranch(b.brnch, on)}
              />
            </div>
            {e && (
              <>
                <label className="mt-2 flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={e.isDefault}
                    onCheckedChange={(v) => setEntry(b.brnch, { isDefault: Boolean(v) })}
                  />
                  Default branch at sign-in
                </label>
                <div className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {roles
                    .filter((r) => r.active)
                    .map((r) => (
                      <label key={r.code} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={e.roles.includes(r.code)}
                          onCheckedChange={(v) =>
                            setEntry(b.brnch, {
                              roles: v ? [...e.roles, r.code] : e.roles.filter((x) => x !== r.code),
                            })
                          }
                        />
                        <span title={r.code}>{r.name}</span>
                      </label>
                    ))}
                </div>
              </>
            )}
          </fieldset>
        );
      })}
    </div>
  );
}
