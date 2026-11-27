'use client';

/**
 * Last resort: replaces the root layout when the layout itself fails, so it
 * renders its own document and carries its own few styles (the site's
 * stylesheets belong to the layout that just failed).
 */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          padding: '48px 24px',
          background: '#e7e8d6',
          color: '#221c44',
          fontFamily: 'system-ui, sans-serif',
          lineHeight: 1.5,
        }}
      >
        <main style={{ maxWidth: 640, margin: '0 auto' }}>
          <h1 style={{ fontSize: 36, lineHeight: 1.05, margin: '0 0 16px' }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: 18, margin: '0 0 24px' }}>
            The site could not be shown. Holds live on-chain and are not affected by this.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: 52,
              padding: '0 22px',
              border: '2px solid #221c44',
              background: '#221c44',
              color: '#e7e8d6',
              fontSize: 17,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
