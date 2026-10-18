import { FlaskConical, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import type { StatusDTO } from '@tracewise/shared';
import { MobileNav, Sidebar } from '@/components/sidebar';
import { apiGet } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  let status: StatusDTO | null = null;
  let apiError: string | null = null;
  try {
    status = await apiGet<StatusDTO>('/api/status');
  } catch (e) {
    apiError = (e as Error).message;
  }
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="min-w-0 flex-1">
        <MobileNav />
        {apiError && (
          <div role="alert" className="flex items-center gap-2 border-b border-red-400/40 bg-red-500/10 px-6 py-2 text-sm text-red-200">
            <WifiOff className="h-4 w-4" aria-hidden /> {apiError}
          </div>
        )}
        {status?.mode === 'demo' && (
          <div className="flex items-center gap-2 border-b border-violet-400/30 bg-violet-500/10 px-6 py-2 text-xs text-violet-200">
            <FlaskConical className="h-3.5 w-3.5" aria-hidden />
            Demo mode: provider changes marked DEMO DATA are simulated, and the sample repository is a fixture. Live feeds are only
            contacted if enabled in Settings.
          </div>
        )}
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
