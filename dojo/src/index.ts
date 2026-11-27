/**
 * Scam Dojo: the engine, the scenario corpus, the HTTP handler and the stores.
 *
 * The web app mounts `createDojoHandler` under `/api/dojo` and renders the
 * spectator page from its `watch` endpoint. The mobile app plays offline by
 * calling `startRun` and `applyMove` directly with a seed of its own.
 */
export * from './types';
export * from './rules';
export * from './engine';
export * from './http';
export * from './stores';
export { dealRun } from './deal';
export { SCENARIOS, ADVISORY, findScenario, scamAddressFixtures } from './scenarios';
export { isSolanaAddress, shortAddress } from './base58';
export { sha256Hex } from './sha256';
