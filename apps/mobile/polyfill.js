/**
 * Loaded before anything else (see index.js). `install()` provides
 * `global.crypto` (random values and WebCrypto) and `global.Buffer`, which
 * the Solana client, the HOLDBACK SDK and the Pollar client all expect.
 * `URL`, `TextEncoder` and `TextDecoder` already come from the Expo runtime.
 */
import { install } from 'react-native-quick-crypto';

install();
