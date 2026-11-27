'use client';

import { useEffect } from 'react';

/** Catches errors thrown while rendering any route. Says what is and is not affected. */
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
    <main className="wrap lost">
      <div>
        <p className="label">Something went wrong</p>
        <h1 className="h2">This page could not be shown</h1>
        <p className="lead" style={{ marginTop: 'var(--s4)' }}>
          The fault is in this page, not in your wallet. Holds live on-chain and are not affected by
          it.
        </p>
        {error.digest ? (
          <p className="small quiet" style={{ marginTop: 'var(--s3)' }}>
            Reference: <span className="mono">{error.digest}</span>
          </p>
        ) : null}
        <div className="btn-row lost__links">
          <button type="button" className="btn" onClick={reset}>
            Try again
          </button>
        </div>
      </div>
    </main>
  );
}
