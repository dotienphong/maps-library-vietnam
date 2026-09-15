export class MapsLibVNError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;
  readonly retryAfter: number | undefined;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    requestId?: string,
    retryAfter?: number,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'MapsLibVNError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.retryAfter = retryAfter;
    this.details = details;
  }
}
