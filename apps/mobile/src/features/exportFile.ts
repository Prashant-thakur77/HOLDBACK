import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { mergeHistory, toCsv, toJson } from '@/lib/exportHistory';
import type { HoldList } from '@/data/holds';

export type ExportFormat = 'csv' | 'json';

/**
 * Writes the wallet's hold history to a file in the app cache and opens the
 * Android share sheet for it. Resolves `false` when there is nothing to
 * export. The file never leaves the phone unless the user shares it.
 */
export async function shareHistory(
  format: ExportFormat,
  wallet: string,
  sent: HoldList | undefined,
  received: HoldList | undefined,
): Promise<boolean> {
  const entries = mergeHistory(sent?.records ?? [], received?.records ?? []);
  if (entries.length === 0) return false;

  const exportedAt = new Date().toISOString();
  const body = format === 'csv' ? toCsv(entries) : toJson(entries, wallet, exportedAt);
  const file = new File(Paths.cache, `holdback-history-${exportedAt.slice(0, 10)}.${format}`);
  if (file.exists) file.delete();
  file.create();
  file.write(body);

  if (!(await Sharing.isAvailableAsync()))
    throw new Error('Sharing is not available on this device');
  await Sharing.shareAsync(file.uri, {
    mimeType: format === 'csv' ? 'text/csv' : 'application/json',
    dialogTitle: file.name,
  });
  return true;
}
