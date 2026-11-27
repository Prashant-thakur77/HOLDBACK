import { GuardianError } from '@holdback/sdk';

/**
 * A refusal or failure the calling model should read and act on. `code` is
 * stable and machine-readable; `message` says what to do next.
 */
export class ToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export interface ErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * RPC providers put API keys in the URL query, and network errors sometimes
 * quote the URL. Nothing that looks like a credential leaves this process.
 */
export function redact(text: string): string {
  return text.replace(/([?&](?:api[-_]?key|key|token|secret)=)[^&\s"')]+/gi, '$1***');
}

/** Maps anything a tool can throw to the error body returned to the caller. */
export function toErrorBody(failure: unknown): ErrorBody {
  if (failure instanceof ToolError) {
    const body: ErrorBody = { code: failure.code, message: redact(failure.message) };
    if (Object.keys(failure.details).length > 0) body.details = failure.details;
    return body;
  }
  if (failure instanceof GuardianError) {
    return {
      code: `guardian_${failure.code}`,
      message: redact(`The Guardian risk service answered ${failure.status}: ${failure.message}`),
    };
  }
  const message = failure instanceof Error ? failure.message : String(failure);
  return { code: 'internal_error', message: redact(message) };
}
