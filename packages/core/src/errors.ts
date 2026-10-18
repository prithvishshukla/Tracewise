export class AppError extends Error {
  constructor(
    readonly code: 'not_found' | 'conflict' | 'validation_error' | 'unsafe_input' | 'unavailable' | 'internal_error',
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
  static notFound(what: string) {
    return new AppError('not_found', `${what} not found`, 404);
  }
  static conflict(message: string, details?: unknown) {
    return new AppError('conflict', message, 409, details);
  }
  static validation(message: string, details?: unknown) {
    return new AppError('validation_error', message, 400, details);
  }
  static unsafe(message: string) {
    return new AppError('unsafe_input', message, 400);
  }
}

/** Failures that retrying will not fix (the worker maps these to BullMQ's UnrecoverableError). */
export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableError';
  }
}
