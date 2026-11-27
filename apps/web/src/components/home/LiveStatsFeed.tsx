'use client';

import { useEffect } from 'react';

import { useLiveStats } from '@/hooks/useLiveStats';
import type { LiveStatsResult } from '@/lib/stats';

interface Props {
  initial: LiveStatsResult | null;
  onChange: (result: LiveStatsResult | null, status: 'loading' | 'ready' | 'unavailable') => void;
}

/**
 * Keeps the counters fresh. It renders nothing; it exists as its own module
 * so the agent and database clients load after the page is interactive
 * instead of sitting in the home page's first bundle.
 */
export default function LiveStatsFeed({ initial, onChange }: Props) {
  const { result, status } = useLiveStats(initial);
  useEffect(() => {
    onChange(result, status);
  }, [result, status, onChange]);
  return null;
}
