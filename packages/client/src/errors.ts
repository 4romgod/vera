export class VeraApiError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly responseBody: unknown,
  ) {
    super(message);
    this.name = 'VeraApiError';
  }
}
