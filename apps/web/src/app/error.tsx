'use client';

import { useEffect } from 'react';

// Structure only, visual design pending. Catches errors thrown while rendering any route.
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main>
      <h1>Something went wrong</h1>
      <p>The page could not be shown. Your funds are not affected by this.</p>
      {error.digest ? <p>Reference: {error.digest}</p> : null}
      <button type="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
