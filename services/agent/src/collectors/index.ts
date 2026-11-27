import { baselineCollector } from './baseline';
import { blocklistCollector } from './blocklist';
import { chainabuseCollector } from './chainabuse';
import { contextCollector } from './context';
import { heliusCollector } from './helius';
import { onchainCollector } from './onchain';
import { snsCollector } from './sns';
import type { Collector } from './types';
import { webCollector } from './web';

/** The eight evidence collectors, in the order of `COLLECTORS`. */
export const ALL_COLLECTORS: Collector[] = [
  onchainCollector,
  heliusCollector,
  blocklistCollector,
  chainabuseCollector,
  webCollector,
  snsCollector,
  contextCollector,
  baselineCollector,
];
