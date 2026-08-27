export class MapsLibVNError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;

  constructor(status: number, code: string, message: string, requestId?: string) {
    super(message);
    this.name = 'MapsLibVNError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}
