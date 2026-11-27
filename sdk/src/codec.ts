/**
 * A small Borsh codec driven by the Anchor IDL. It covers exactly the types
 * the program uses, so the SDK needs no code generation and no Anchor
 * runtime: discriminators and layouts come from the IDL that ships with it.
 */
import { PublicKey } from '@solana/web3.js';

import idl from './idl/holdback.json';

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

export function fieldsOf(typeName: string): IdlField[] {
  const fields = typeDefs.get(typeName);
  if (!fields) throw new Error(`Unknown IDL type: ${typeName}`);
  return fields;
}

export function camel(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

export class Reader {
  private view: DataView;
  offset = 0;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  u8(): number {
    return this.view.getUint8(this.offset++);
  }

  u16(): number {
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  u32(): number {
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  u64(): bigint {
    const low = BigInt(this.u32());
    const high = BigInt(this.u32());
    return (high << 32n) | low;
  }

  i64(): bigint {
    return BigInt.asIntN(64, this.u64());
  }

  take(length: number): Uint8Array {
    if (this.offset + length > this.bytes.length) throw new Error('Unexpected end of data');
    const slice = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }
}

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
        return new PublicKey(reader.take(32));
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
  return decodeStruct(type.defined.name, reader);
}

export function decodeStruct(typeName: string, reader: Reader): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fieldsOf(typeName)) {
    out[camel(field.name)] = decodeType(field.type, reader);
  }
  return out;
}

function pushU32(out: number[], value: number): void {
  out.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function pushU64(out: number[], value: bigint): void {
  const unsigned = BigInt.asUintN(64, value);
  pushU32(out, Number(unsigned & 0xffffffffn));
  pushU32(out, Number(unsigned >> 32n));
}

function toBigInt(value: unknown, what: string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  throw new Error(`${what} must be an integer`);
}

export function encodeType(type: IdlType, value: unknown, out: number[], what = 'value'): void {
  if (typeof type === 'string') {
    switch (type) {
      case 'u8': {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 0 || n > 0xff) throw new Error(`${what} must be a u8`);
        out.push(n);
        return;
      }
      case 'u16': {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 0 || n > 0xffff) throw new Error(`${what} must be a u16`);
        out.push(n & 0xff, n >>> 8);
        return;
      }
      case 'u32': {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) {
          throw new Error(`${what} must be a u32`);
        }
        pushU32(out, n);
        return;
      }
      case 'u64': {
        const n = toBigInt(value, what);
        if (n < 0n || n > 0xffffffffffffffffn) throw new Error(`${what} must be a u64`);
        pushU64(out, n);
        return;
      }
      case 'i64':
        pushU64(out, toBigInt(value, what));
        return;
      case 'bool':
        out.push(value ? 1 : 0);
        return;
      case 'pubkey':
        out.push(...(value as PublicKey).toBytes());
        return;
    }
  }
  if ('array' in type) {
    const [inner, length] = type.array;
    const items = value as ArrayLike<unknown>;
    if (items.length !== length) throw new Error(`${what} must have ${length} elements`);
    for (let i = 0; i < length; i++) encodeType(inner, items[i], out, what);
    return;
  }
  if ('option' in type) {
    if (value === null || value === undefined) {
      out.push(0);
    } else {
      out.push(1);
      encodeType(type.option, value, out, what);
    }
    return;
  }
  const record = value as Record<string, unknown>;
  for (const field of fieldsOf(type.defined.name)) {
    encodeType(field.type, record[camel(field.name)], out, camel(field.name));
  }
}

export function sameBytes(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
