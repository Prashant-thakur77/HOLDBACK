/**
 * Seeker checks on mainnet, done server-side so a client cannot fake them.
 *
 * "Verified Seeker owner" means: the wallet holds a Seeker Genesis Token.
 * That is a statement about a device, not about a person.
 *
 * Addresses below are the ones Solana Mobile publishes: the Genesis Token
 * group in its developer documentation, the SKR mint on its SKR page, and
 * the .skr name accounts in its `skr-domain` package.
 */
import { sha256 } from '@noble/hashes/sha256';
import { PublicKey, type Connection } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, type SeekerVerification } from '@holdback/sdk';

import { utf8 } from './lib/encoding';
import type { Services } from './services';

/** Token group every Seeker Genesis Token belongs to (also its metadata address). */
export const SGT_GROUP = new PublicKey('GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te');
export const SKR_MINT = new PublicKey('SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3');

const TLD_HOUSE_PROGRAM = new PublicKey('TLDHkysf5pCnKsVA4gXpNvmy7psXLPEu4LAdDJthT9S');
const NAME_SERVICE_PROGRAM = new PublicKey('ALTNSZ46uaAUU7XUV6awvdorLGqAsPwa9shm7h4uP2FK');
const SKR_PARENT = new PublicKey('F3A8kuikEiu6k2399oSJ1PWfcJYDHqpwoQ2e8psSDNuF');
const NAME_HASH_PREFIX = 'ALT Name Service';

// Token-2022 layout: a mint is padded to the size of a token account (165
// bytes), then one account-type byte (1 = mint), then TLV extensions.
const ACCOUNT_TYPE_OFFSET = 165;
const ACCOUNT_TYPE_MINT = 1;
const EXTENSIONS_OFFSET = 166;
const EXT_METADATA_POINTER = 18;
const EXT_TOKEN_GROUP_MEMBER = 23;

const CACHE_TTL_SECS = 10 * 60;
/** Token-2022 holdings inspected per wallet. */
const MAX_MINTS = 300;

function extensions(data: Uint8Array): Map<number, Uint8Array> {
  const found = new Map<number, Uint8Array>();
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = EXTENSIONS_OFFSET;
  while (offset + 4 <= data.length) {
    const type = view.getUint16(offset, true);
    const length = view.getUint16(offset + 2, true);
    if (type === 0 || offset + 4 + length > data.length) break;
    found.set(type, data.subarray(offset + 4, offset + 4 + length));
    offset += 4 + length;
  }
  return found;
}

const equals = (bytes: Uint8Array | undefined, key: PublicKey) =>
  bytes !== undefined && bytes.length === 32 && key.equals(new PublicKey(bytes));

/**
 * True when `data` is a Token-2022 mint that is a member of the Seeker
 * Genesis Token group and whose metadata pointer is that group's address.
 * The caller checks that the account is owned by the Token-2022 program.
 */
export function isSeekerGenesisMint(data: Uint8Array): boolean {
  if (data.length <= EXTENSIONS_OFFSET || data[ACCOUNT_TYPE_OFFSET] !== ACCOUNT_TYPE_MINT) {
    return false;
  }
  const found = extensions(data);
  // MetadataPointer: authority (32), metadata address (32).
  const pointer = found.get(EXT_METADATA_POINTER);
  // TokenGroupMember: mint (32), group (32), member number (8).
  const member = found.get(EXT_TOKEN_GROUP_MEMBER);
  return (
    equals(pointer?.subarray(32, 64), SGT_GROUP) && equals(member?.subarray(32, 64), SGT_GROUP)
  );
}

function tokenAmount(data: Uint8Array): bigint {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(64, true);
}

/** The mint of a Seeker Genesis Token held by `wallet`, or `null`. */
export async function findGenesisMint(
  connection: Connection,
  wallet: PublicKey,
): Promise<string | null> {
  const { value } = await connection.getTokenAccountsByOwner(wallet, {
    programId: TOKEN_2022_PROGRAM_ID,
  });
  const mints = value
    .filter(({ account }) => account.data.length >= 72 && tokenAmount(account.data) > 0n)
    .map(({ account }) => new PublicKey(account.data.subarray(0, 32)))
    .slice(0, MAX_MINTS);
  for (let start = 0; start < mints.length; start += 100) {
    const batch = mints.slice(start, start + 100);
    const infos = await connection.getMultipleAccountsInfo(batch);
    const index = infos.findIndex(
      (info) =>
        info !== null && info.owner.equals(TOKEN_2022_PROGRAM_ID) && isSeekerGenesisMint(info.data),
    );
    if (index >= 0) return batch[index]!.toBase58();
  }
  return null;
}

/** SKR held by `wallet`, in base units. */
export async function skrBalance(connection: Connection, wallet: PublicKey): Promise<string> {
  const { value } = await connection.getTokenAccountsByOwner(wallet, { mint: SKR_MINT });
  return value
    .filter(({ account }) => account.data.length >= 72)
    .reduce((sum, { account }) => sum + tokenAmount(account.data), 0n)
    .toString();
}

/** Reads a length-prefixed UTF-8 string; returns it and the offset after it. */
function readString(data: Uint8Array, offset: number): [string, number] | null {
  if (offset + 4 > data.length) return null;
  const length = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(
    offset,
    true,
  );
  const end = offset + 4 + length;
  if (end > data.length) return null;
  return [new TextDecoder().decode(data.subarray(offset + 4, end)), end];
}

/** Parses a wallet's main-domain record: name account, then the `tld` and `domain` strings. */
export function parseMainDomain(
  data: Uint8Array,
): { nameAccount: PublicKey; tld: string; domain: string } | null {
  if (data.length < 44) return null;
  const tld = readString(data, 40);
  const domain = tld ? readString(data, tld[1]) : null;
  if (!tld || !domain) return null;
  return { nameAccount: new PublicKey(data.subarray(8, 40)), tld: tld[0], domain: domain[0] };
}

/** The name account of `label.skr`. */
export function skrNameAccount(label: string): PublicKey {
  const hashed = sha256(utf8(NAME_HASH_PREFIX + label));
  return PublicKey.findProgramAddressSync(
    [hashed, new Uint8Array(32), SKR_PARENT.toBytes()],
    NAME_SERVICE_PROGRAM,
  )[0];
}

/**
 * The wallet's primary `.skr` name, or `null`. The main-domain record can
 * go stale when a name is transferred, so the name account itself must
 * still be owned by the wallet and not be expired.
 */
export async function primarySkrDomain(
  connection: Connection,
  wallet: PublicKey,
): Promise<string | null> {
  const [record] = PublicKey.findProgramAddressSync(
    [utf8('main_domain'), wallet.toBytes()],
    TLD_HOUSE_PROGRAM,
  );
  const recordInfo = await connection.getAccountInfo(record);
  const main = recordInfo ? parseMainDomain(recordInfo.data) : null;
  if (!main || main.tld !== '.skr' || !skrNameAccount(main.domain).equals(main.nameAccount)) {
    return null;
  }
  const nameInfo = await connection.getAccountInfo(main.nameAccount);
  if (!nameInfo || !nameInfo.owner.equals(NAME_SERVICE_PROGRAM) || nameInfo.data.length < 112) {
    return null;
  }
  const data = nameInfo.data;
  const owner = new PublicKey(data.subarray(40, 72));
  const expiresAt = new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(
    104,
    true,
  );
  const expired = expiresAt !== 0n && expiresAt < BigInt(Math.floor(Date.now() / 1000));
  return owner.equals(wallet) && !expired ? `${main.domain}.skr` : null;
}

/**
 * Everything the Seeker badge shows. The Genesis Token check must succeed
 * or the request fails; the balance and the name are extras and come back
 * `null` when they cannot be read.
 */
export async function verifySeeker(
  services: Services,
  wallet: string,
): Promise<SeekerVerification> {
  return services.cache.wrap('seeker', wallet, CACHE_TTL_SECS, async () => {
    const owner = new PublicKey(wallet);
    const [genesisMint, balance, domain] = await Promise.all([
      findGenesisMint(services.mainnet, owner),
      skrBalance(services.mainnet, owner).catch(() => null),
      primarySkrDomain(services.mainnet, owner).catch(() => null),
    ]);
    return {
      seekerOwner: genesisMint !== null,
      genesisMint,
      skrBalance: balance,
      skrDomain: domain,
    };
  });
}
