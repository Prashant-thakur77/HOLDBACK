/** Query keys, in one place so invalidation cannot miss a spelling. */
export const queryKeys = {
  holds: (wallet: string, role: 'sender' | 'recipient') => ['holds', wallet, role] as const,
  allHolds: ['holds'] as const,
  hold: (pda: string) => ['hold', pda] as const,
  balances: (wallet: string) => ['balances', wallet] as const,
  allBalances: ['balances'] as const,
  trusted: (wallet: string) => ['trusted', wallet] as const,
  isTrusted: (wallet: string, recipient: string) => ['trusted', wallet, recipient] as const,
  programConfig: ['program-config'] as const,
  mint: (mint: string) => ['mint', mint] as const,
  seeker: (wallet: string) => ['seeker', wallet] as const,
  name: (name: string) => ['name', name] as const,
};
