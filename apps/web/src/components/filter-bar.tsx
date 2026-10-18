'use client';

import { Search } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export interface FilterField {
  name: string;
  label: string;
  type: 'search' | 'select';
  options?: { value: string; label: string }[];
  placeholder?: string;
}

const inputClass =
  'rounded-lg border border-line bg-raised px-3 py-2 text-sm text-fg placeholder:text-muted/70 focus-visible:border-accent';

/** Writes filters into the URL query string (resetting to page 1) so every filtered view is linkable. */
export function FilterBar({ fields }: { fields: FilterField[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [search, setSearch] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.filter((f) => f.type === 'search').map((f) => [f.name, params.get(f.name) ?? ''])),
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const push = (name: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(name, value);
    else next.delete(name);
    next.delete('page');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <form role="search" className="flex flex-wrap items-end gap-3 border-b border-line px-5 py-4" onSubmit={(e) => e.preventDefault()}>
      {fields.map((f) =>
        f.type === 'search' ? (
          <label key={f.name} className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs font-medium text-muted">
            {f.label}
            <span className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" aria-hidden />
              <input
                type="search"
                name={f.name}
                value={search[f.name] ?? ''}
                placeholder={f.placeholder}
                className={`${inputClass} w-full pl-8`}
                onChange={(e) => {
                  const v = e.target.value;
                  setSearch((s) => ({ ...s, [f.name]: v }));
                  if (timer.current) clearTimeout(timer.current);
                  timer.current = setTimeout(() => push(f.name, v.trim()), 300);
                }}
              />
            </span>
          </label>
        ) : (
          <label key={f.name} className="flex flex-col gap-1 text-xs font-medium text-muted">
            {f.label}
            <select name={f.name} className={inputClass} value={params.get(f.name) ?? ''} onChange={(e) => push(f.name, e.target.value)}>
              <option value="">All</option>
              {f.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ),
      )}
    </form>
  );
}
