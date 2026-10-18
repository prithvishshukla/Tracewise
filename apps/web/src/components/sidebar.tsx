'use client';

import clsx from 'clsx';
import { Activity, FolderGit2, GitPullRequestArrow, LayoutDashboard, Plug, Settings, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/findings', label: 'Findings', icon: ShieldAlert },
  { href: '/changes', label: 'API changes', icon: GitPullRequestArrow },
  { href: '/repositories', label: 'Repositories', icon: FolderGit2 },
  { href: '/providers', label: 'Providers', icon: Plug },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-surface px-3 py-5 md:flex">
      <Link href="/" className="mb-6 flex items-center gap-2 px-2 text-lg font-semibold tracking-tight">
        <Activity className="h-5 w-5 text-cyan-400" aria-hidden /> Tracewise
      </Link>
      <nav aria-label="Main" className="flex flex-col gap-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={clsx(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm',
                active ? 'bg-raised font-medium text-fg' : 'text-muted hover:bg-raised/60 hover:text-fg',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden /> {label}
            </Link>
          );
        })}
      </nav>
      <p className="mt-auto px-2 text-xs text-muted">
        Static analysis reports evidence and uncertainty. It does not prove runtime behaviour.
      </p>
    </aside>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main (mobile)" className="flex gap-1 overflow-x-auto border-b border-line bg-surface px-3 py-2 md:hidden">
      {NAV.map(({ href, label }) => {
        const active = pathname === href || pathname.startsWith(href + '/');
        return (
          <Link
            key={href}
            href={href}
            className={clsx('whitespace-nowrap rounded-md px-3 py-1.5 text-sm', active ? 'bg-raised text-fg' : 'text-muted')}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
