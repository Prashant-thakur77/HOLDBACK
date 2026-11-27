/** An error with an HTTP status and a stable machine-readable code. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code = 'invalid_request') =>
  new ApiError(400, code, message);
export const unauthorized = (message = 'A valid session token is required') =>
  new ApiError(401, 'unauthorized', message);
export const forbidden = (message: string, code = 'forbidden') => new ApiError(403, code, message);
export const notFound = (message: string) => new ApiError(404, 'not_found', message);
export const unavailable = (message: string, code = 'unavailable') =>
  new ApiError(503, code, message);

/**
 * Thrown by a collector that cannot answer (no key, quota spent, source
 * down). The runner turns it into an entry in `unavailable`; it never
 * becomes an HTTP error.
 */
export class CollectorUnavailable extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}
