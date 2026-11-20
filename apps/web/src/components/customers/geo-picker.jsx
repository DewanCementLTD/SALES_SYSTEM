'use client';

// Zone → Territory → Area → City picker (BR-CUS-03: a customer sits in an area or a city).
import { GEO_LEVELS } from '@dcl/shared';
import { useQuery } from '@tanstack/react-query';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, qs } from '@/lib/api';
import { qk } from '@/lib/query-keys';

function LevelSelect({ level, parentCode, value, onChange, disabled }) {
  const enabled = level === 1 || !!parentCode;
  const params = {
    ...(level === 1 ? { level: 1 } : { parentCode }),
    active: 'true',
    pageSize: 200,
  };
  const list = useQuery({
    queryKey: qk.geoNodes(params),
    queryFn: () => api(`/geo/nodes${qs(params)}`),
    enabled,
  });
  const lv = GEO_LEVELS[level - 1];
  const id = `geo-${lv.field}`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {lv.name}
        {level <= 3 && <span className="text-danger"> *</span>}
      </Label>
      <Select value={value ?? ''} onValueChange={onChange} disabled={disabled || !enabled}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={enabled ? `Select ${lv.name.toLowerCase()}` : '—'} />
        </SelectTrigger>
        <SelectContent>
          {(list.data?.items ?? []).map((n) => (
            <SelectItem key={n.geoCode} value={n.geoCode}>
              {n.code} · {n.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** @param {{ value: string, onChange: (geoCode: string) => void, disabled?: boolean }} props */
export function GeoPicker({ value, onChange, disabled }) {
  const parts = value ? value.split('-') : [];
  const codeAt = (level) => (parts.length >= level ? parts.slice(0, level).join('-') : null);
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[1, 2, 3, 4].map((level) => (
        <LevelSelect
          key={level}
          level={level}
          parentCode={level === 1 ? null : codeAt(level - 1)}
          value={codeAt(level)}
          disabled={disabled}
          onChange={(code) => onChange(code)}
        />
      ))}
    </div>
  );
}
