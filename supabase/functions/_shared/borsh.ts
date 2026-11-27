/**
 * A read-only Borsh decoder driven by the program's IDL.
 *
 * Edge functions are bundled on their own and cannot import the SDK, so this
 * is the small part of its codec the webhook needs: struct layouts come from
 * the IDL copy next to this file, which means a rebuilt program only needs
 * the IDL re-synced, never this code. It uses nothing outside the language
 * and web standards, so the same file runs under Deno and under Node.
 */
import idl from './holdback.idl.json' with { type: 'json' };
import { encodeBase58 } from './base58.ts';

export type IdlType =
  | 'u8'
  | 'u16'
  | 'u32'
  | 'u64'
  | 'i64'
  | 'bool'
  | 'pubkey'
  | { array: [IdlType, number] }
  | { option: IdlType }
  | { defined: { name: string } };

interface IdlField {
  name: string;
  type: IdlType;
}

interface IdlTypeDef {
  name: string;
  type: { kind: string; fields?: IdlField[] };
}

const typeDefs = new Map<string, IdlField[]>(
  (idl.types as unknown as IdlTypeDef[]).map((def) => [def.name, def.type.fields ?? []]),
);

/** `release_at` -> `releaseAt`, the same naming the SDK gives decoded fields. */
function camel(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

/** A bounds-checked little-endian cursor. Reading past the end throws. */
export class Reader {
  private readonly view: DataView;
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  u8(): number {
    return this.view.getUint8(this.advance(1));
  }

  u16(): number {
    return this.view.getUint16(this.advance(2), true);
  }

  u32(): number {
    return this.view.getUint32(this.advance(4), true);
  }

  u64(): bigint {
    return this.view.getBigUint64(this.advance(8), true);
  }

  i64(): bigint {
    return this.view.getBigInt64(this.advance(8), true);
  }

  take(length: number): Uint8Array {
    const start = this.advance(length);
    return this.bytes.slice(start, start + length);
  }

  /** True once every byte has been consumed. */
  get done(): boolean {
    return this.offset === this.bytes.length;
  }

  private advance(length: number): number {
    const start = this.offset;
    if (start + length > this.bytes.length) throw new RangeError('Unexpected end of data');
    this.offset = start + length;
    return start;
  }
}

/**
 * Decodes one value. Public keys come back as base58 strings and 64-bit
 * integers as `bigint`, so nothing is lost before it reaches the database.
 */
export function decodeType(type: IdlType, reader: Reader): unknown {
  if (typeof type === 'string') {
    switch (type) {
      case 'u8':
        return reader.u8();
      case 'u16':
        return reader.u16();
      case 'u32':
        return reader.u32();
      case 'u64':
        return reader.u64();
      case 'i64':
        return reader.i64();
      case 'bool':
        return reader.u8() !== 0;
      case 'pubkey':
        return encodeBase58(reader.take(32));
      default:
        throw new Error(`Unsupported IDL type: ${String(type)}`);
    }
  }
  if ('array' in type) {
    const [inner, length] = type.array;
    if (inner === 'u8') return reader.take(length);
    return Array.from({ length }, () => decodeType(inner, reader));
  }
  if ('option' in type) {
    return reader.u8() === 0 ? null : decodeType(type.option, reader);
  }
  if ('defined' in type) return decodeStruct(type.defined.name, reader);
  throw new Error(`Unsupported IDL type: ${JSON.stringify(type)}`);
}

/** Decodes a struct the IDL defines, with camelCase field names. */
export function decodeStruct(typeName: string, reader: Reader): Record<string, unknown> {
  const fields = typeDefs.get(typeName);
  if (!fields) throw new Error(`Unknown IDL type: ${typeName}`);
  const out: Record<string, unknown> = {};
  for (const field of fields) out[camel(field.name)] = decodeType(field.type, reader);
  return out;
}
