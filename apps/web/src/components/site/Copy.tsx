'use client';

import { useState } from 'react';

/** Copies a value (an address, a hash) and says so. Every value on a receipt can be checked elsewhere. */
export function Copy({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be refused; the value is still on screen to select.
    }
  };
  return (
    <button
      type="button"
      className="copy"
      onClick={() => void onClick()}
      aria-label={`Copy ${label}`}
    >
      <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}
