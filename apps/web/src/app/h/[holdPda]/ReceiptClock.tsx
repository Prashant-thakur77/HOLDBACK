'use client';

import type { HoldRecord } from '@holdback/sdk';

import { Bowl } from '@/components/art/Bowl';
import { T } from '@/components/LangProvider';
import { useCountdown } from '@/hooks/useCountdown';

interface Props {
  status: HoldRecord['status'];
  createdAt: string;
  releaseAt: string;
}

/**
 * The hold's clock, drawn as the bowl: floating while the undo window is
 * open, lifted out when the sender took the money back, under water when the
 * payment went to the recipient. The text beside it always says the same
 * thing in words.
 */
export function ReceiptClock({ status, createdAt, releaseAt }: Props) {
  const countdown = useCountdown(status === 'PENDING' ? releaseAt : null);
  const total = Math.max(1, (Date.parse(releaseAt) - Date.parse(createdAt)) / 1000);
  const left = countdown.remainingSecs;
  const open = status === 'PENDING' && left !== null && left > 0;
  const fill = left === null ? 0 : 1 - left / total;

  let line: string;
  if (status === 'RECLAIMED') line = 'The sender took this payment back. The clock was stopped.';
  else if (status === 'RELEASED') line = 'The window ended and the payment went to the recipient.';
  else if (left === null) line = 'Reading the clock.';
  else if (open) line = `The sender can take this back for another ${countdown.label}.`;
  else line = 'The window has ended. Anyone can now release this payment to the recipient.';

  return (
    <div className="receipt-clock">
      <Bowl
        fill={status === 'PENDING' ? fill : 1}
        state={status === 'RECLAIMED' ? 'lifted' : open || left === null ? 'floating' : 'sunk'}
        title={line}
        still={!open}
      />
      <div className="receipt-clock__text">
        <p className="label">
          {status === 'PENDING' ? (
            open || left === null ? (
              <T k="demo.left" />
            ) : (
              'Window ended'
            )
          ) : status === 'RECLAIMED' ? (
            <T k="stamp.takenBack" />
          ) : (
            <T k="stamp.released" />
          )}
        </p>
        <p className="receipt-clock__time num" aria-hidden="true">
          {open ? countdown.label : status === 'PENDING' && left === null ? '…' : '0'}
        </p>
        <p role="status">{line}</p>
        {open ? (
          <div className="drain" aria-hidden="true">
            <i className="drain__left" style={{ ['--left' as string]: 1 - fill }} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
