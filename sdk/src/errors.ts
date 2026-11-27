import idl from './idl/holdback.json';

export interface HoldbackProgramError {
  code: number;
  name: string;
  /** User-facing message from the program. */
  message: string;
}

const byCode = new Map<number, HoldbackProgramError>(
  idl.errors.map((error) => [
    error.code,
    { code: error.code, name: error.name, message: error.msg },
  ]),
);

export function errorFromCode(code: number): HoldbackProgramError | null {
  return byCode.get(code) ?? null;
}

/**
 * Finds a HOLDBACK error in anything a failed send or simulation produces:
 * an `Error`, a log array, or an RPC `err` object.
 */
export function parseProgramError(failure: unknown): HoldbackProgramError | null {
  const candidates: string[] = [];
  if (typeof failure === 'string') candidates.push(failure);
  if (failure instanceof Error) candidates.push(failure.message);
  if (Array.isArray(failure)) candidates.push(...failure.map(String));
  if (failure && typeof failure === 'object') {
    const logs = (failure as { logs?: unknown }).logs;
    if (Array.isArray(logs)) candidates.push(...logs.map(String));
    try {
      candidates.push(JSON.stringify(failure));
    } catch {
      // circular structures carry nothing more than the message and logs
    }
  }

  for (const text of candidates) {
    const hex = /custom program error: 0x([0-9a-f]+)/i.exec(text);
    const custom = /"Custom":\s*(\d+)/.exec(text);
    const number = /Error Number: (\d+)/.exec(text);
    const code = hex
      ? parseInt(hex[1]!, 16)
      : custom
        ? Number(custom[1])
        : number
          ? Number(number[1])
          : null;
    if (code !== null) {
      const known = byCode.get(code);
      if (known) return known;
    }
  }
  return null;
}
