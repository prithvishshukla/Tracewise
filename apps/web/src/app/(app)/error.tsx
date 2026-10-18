'use client';

import { ErrorState, buttonClass } from '@/components/ui';

export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <ErrorState
      title="This page could not be loaded"
      message={error.message || 'Unexpected error'}
      action={
        <button type="button" className={buttonClass()} onClick={reset}>
          Try again
        </button>
      }
    />
  );
}
