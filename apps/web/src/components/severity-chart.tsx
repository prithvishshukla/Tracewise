'use client';

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Severity } from '@tracewise/shared';
import { SEVERITY_COLOR, SEVERITY_LABEL } from '@/lib/format';

export function SeverityChart({ data }: { data: { severity: Severity; count: number }[] }) {
  const rows = data.map((d) => ({ name: SEVERITY_LABEL[d.severity], count: d.count, severity: d.severity }));
  const total = rows.reduce((a, r) => a + r.count, 0);
  return (
    <div role="img" aria-label={`Open findings by severity: ${rows.map((r) => `${r.name} ${r.count}`).join(', ')}`} className="h-52 w-full">
      {total === 0 ? (
        <p className="flex h-full items-center justify-center text-sm text-muted">No open findings</p>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
            <XAxis dataKey="name" tick={{ fill: '#9aa7cc', fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fill: '#9aa7cc', fontSize: 12 }} axisLine={false} tickLine={false} />
            <Tooltip
              cursor={{ fill: 'rgba(91,141,239,0.08)' }}
              contentStyle={{ background: '#151f3d', border: '1px solid #222d52', borderRadius: 8, color: '#e8ecff' }}
            />
            <Bar dataKey="count" radius={[6, 6, 0, 0]}>
              {rows.map((r) => (
                <Cell key={r.severity} fill={SEVERITY_COLOR[r.severity]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
