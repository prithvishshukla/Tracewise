import Link from 'next/link';
import { buttonClass } from '@/components/ui';

export default function NotFound() {
  return (
    <div className="py-20 text-center">
      <p className="text-sm text-muted">404</p>
      <h1 className="mt-1 text-2xl font-semibold">Not found</h1>
      <p className="mt-2 text-sm text-muted">That record does not exist, or the link is malformed.</p>
      <Link href="/dashboard" className={buttonClass('primary') + ' mt-6'}>
        Back to dashboard
      </Link>
    </div>
  );
}
