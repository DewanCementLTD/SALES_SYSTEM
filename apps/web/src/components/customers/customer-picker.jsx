'use client';

// Customer search-and-pick (code, name, mobile, NTN) for document headers and ledger filters.
import { useQuery } from '@tanstack/react-query';
import { ChevronsUpDown } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { api, qs } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { cn } from '@/lib/utils';

/**
 * @param {{ brnch: number, value?: { customerCode: string, customerName?: string } | null,
 *   onChange: (c: any) => void, id?: string, label?: string, className?: string }} props
 */
export function CustomerPicker({ brnch, value, onChange, id, label = 'Customer', className }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const params = { brnch, q: q || undefined, pageSize: 20 };
  const list = useQuery({
    queryKey: qk.customers(params),
    queryFn: () => api(`/customers${qs(params)}`),
    enabled: open,
    placeholderData: (p) => p,
  });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          className={cn('w-full justify-between font-normal', className)}
        >
          <span className="truncate">
            {value ? (
              <>
                <span className="font-mono">{value.customerCode}</span>
                {value.customerName ? ` · ${value.customerName}` : ''}
              </>
            ) : (
              <span className="text-muted-foreground">Search customer…</span>
            )}
          </span>
          <ChevronsUpDown className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-80 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Code, name, mobile or NTN"
            value={q}
            onValueChange={setQ}
            aria-label="Search customers"
          />
          <CommandList>
            <CommandEmpty>{list.isFetching ? 'Searching…' : 'No customer found.'}</CommandEmpty>
            {(list.data?.items ?? []).map((c) => (
              <CommandItem
                key={c.customerCode}
                value={c.customerCode}
                onSelect={() => {
                  onChange(c);
                  setOpen(false);
                }}
              >
                <span className="font-mono">{c.customerCode}</span>
                <span className="truncate">{c.customerName}</span>
                <span className="ml-auto text-xs text-muted-foreground">{c.status}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
