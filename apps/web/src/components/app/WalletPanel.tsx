'use client';

import { useWallet } from '@solana/wallet-adapter-react';

import { T } from '@/components/LangProvider';
import { Copy } from '@/components/site/Copy';
import { useWalletSession } from '@/hooks/useWalletSession';
import { shortAddress } from '@/lib/format';

/**
 * Connect, disconnect, and the optional sign-in that turns on live updates.
 * Signing a message is only ever started by a press.
 */
export function WalletPanel() {
  const { wallets, select, connect, disconnect, publicKey, wallet, connecting } = useWallet();
  const session = useWalletSession();

  if (publicKey) {
    const address = publicKey.toBase58();
    return (
      <section className="panel wallet" aria-labelledby="wallet-title">
        <h2 id="wallet-title" className="label">
          Your wallet
        </h2>
        <p className="wallet__addr">
          <span className="mono" title={address}>
            {shortAddress(address, 6)}
          </span>
          <Copy value={address} label="wallet address" />
        </p>
        <div className="btn-row">
          {session.status === 'ready' ? (
            <p className="small wallet__live">
              <span className="pill" data-ink="green">
                Live updates on
              </span>
            </p>
          ) : session.status !== 'unsupported' ? (
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              disabled={session.status === 'signing'}
              onClick={() => void session.signIn()}
            >
              {session.status === 'signing' ? 'Waiting for your wallet…' : 'Turn on live updates'}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => void disconnect()}
          >
            Disconnect
          </button>
        </div>
        {session.status !== 'ready' && session.status !== 'unsupported' ? (
          <p className="small quiet">
            Live updates need one signed message. It proves the wallet is yours and moves nothing.
            Without it, the list refreshes on a timer.
          </p>
        ) : null}
        {session.error ? (
          <p className="notice" data-ink="red" role="alert">
            {session.error}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section className="panel wallet" aria-labelledby="wallet-title">
      <h2 id="wallet-title" className="h3">
        <T k="action.connect" />
      </h2>
      {wallets.length === 0 ? (
        <p className="notice" data-ink="ochre">
          No Solana wallet was found in this browser. Install a wallet extension, or open this page
          inside your wallet app, then reload.
        </p>
      ) : (
        <>
          <p className="small quiet">Choose the wallet you want to send from. Devnet only.</p>
          <ul className="wallet__list">
            {wallets.map(({ adapter }) => (
              <li key={adapter.name}>
                <button
                  type="button"
                  className="wallet__choice"
                  aria-pressed={wallet?.adapter.name === adapter.name}
                  disabled={connecting}
                  onClick={() => select(adapter.name)}
                >
                  {adapter.name}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {wallet && !connecting ? (
        <button type="button" className="btn" onClick={() => void connect()}>
          Connect {wallet.adapter.name}
        </button>
      ) : null}
      {connecting ? <p role="status">Waiting for your wallet…</p> : null}
    </section>
  );
}
