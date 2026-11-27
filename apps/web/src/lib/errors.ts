/** An integration this deployment has no configuration for. Callers show "unavailable". */
export class IntegrationUnavailableError extends Error {
  constructor(
    readonly integration: 'agent' | 'supabase' | 'supabase-service-role' | 'dojo-memo',
    message: string,
  ) {
    super(message);
    this.name = 'IntegrationUnavailableError';
  }
}

/** A readable message from anything that can be thrown. */
export function errorMessage(failure: unknown): string {
  if (failure instanceof Error) return failure.message;
  return typeof failure === 'string' ? failure : 'Unknown error';
}
