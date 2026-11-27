'use client';

import { useEffect, useState } from 'react';

import { useLang } from '@/components/LangProvider';
import { onSoundChange, restoreSound, setSoundEnabled } from '@/lib/sound';

/** Turns the punch, stamp and gong sounds on or off. Off until pressed. */
export function SoundToggle({ className }: { className?: string }) {
  const { t } = useLang();
  const [on, setOn] = useState(false);

  useEffect(() => {
    setOn(restoreSound());
    return onSoundChange(setOn);
  }, []);

  return (
    <button
      type="button"
      className={['sound', className].filter(Boolean).join(' ')}
      aria-pressed={on}
      onClick={() => setSoundEnabled(!on)}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d="M3 9h4l6-5v16l-6-5H3z" fill="currentColor" />
        {on ? (
          <path d="M16 8q3 4 0 8M19 5q5 7 0 14" fill="none" stroke="currentColor" strokeWidth="2" />
        ) : (
          <path d="M16 9l6 6M22 9l-6 6" fill="none" stroke="currentColor" strokeWidth="2" />
        )}
      </svg>
      {t(on ? 'sound.on' : 'sound.off')}
    </button>
  );
}
