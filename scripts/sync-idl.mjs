// Copies the IDL produced by `anchor build` to every package that decodes
// program data, so discriminators, layouts and error messages have one source.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const from = resolve(root, 'target/idl/holdback.json');
const targets = [
  resolve(root, 'sdk/src/idl/holdback.json'),
  // Edge functions cannot import from outside supabase/functions.
  resolve(root, 'supabase/functions/_shared/holdback.idl.json'),
];

for (const to of targets) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log(`IDL synced to ${to}`);
}
