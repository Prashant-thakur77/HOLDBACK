'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

/** Base58, 32 to 44 characters: the shape of a Solana address. */
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Opens any hold's public receipt from its address. Every hold is public. */
export function OpenReceipt() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const address = value.trim();
    if (!ADDRESS.test(address)) {
      setError('That does not look like a Solana address. A hold address is 32 to 44 characters.');
      return;
    }
    setError(null);
    router.push(`/h/${address}`);
  };

  return (
    <form className="open-receipt" onSubmit={onSubmit} noValidate>
      <div className="field">
        <label className="field__label" htmlFor="open-receipt-address">
          Have a hold address? Open its receipt.
        </label>
        <div className="open-receipt__row">
          <input
            id="open-receipt-address"
            className="input input--mono"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Hold address"
            autoComplete="off"
            spellCheck={false}
            aria-describedby="open-receipt-hint"
            aria-invalid={error ? true : undefined}
          />
          <button type="submit" className="btn">
            Open receipt
          </button>
        </div>
        <p id="open-receipt-hint" className="field__hint" role={error ? 'alert' : undefined}>
          {error ?? 'The receipt shows the evidence and lets you check its hash in your browser.'}
        </p>
      </div>
    </form>
  );
}
