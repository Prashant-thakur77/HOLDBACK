// Copies the IDL produced by `anchor build` into the SDK, which ships it as
// the single source of truth for discriminators, layouts and error messages.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const from = resolve(root, 'target/idl/holdback.json');
const to = resolve(root, 'sdk/src/idl/holdback.json');

mkdirSync(dirname(to), { recursive: true });
copyFileSync(from, to);
console.log(`IDL synced to ${to}`);
