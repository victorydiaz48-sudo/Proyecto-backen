/**
 * Errors that retrying cannot fix (bad input, missing credentials).
 * The job queue fails these immediately instead of burning retries.
 */
export class NonRetryableError extends Error {
  override readonly name: string = 'NonRetryableError';
}

export type ImageValidationReason = 'too_large' | 'too_small' | 'too_big_dimensions' | 'unsupported_type' | 'corrupt';

export class ImageValidationError extends NonRetryableError {
  override readonly name = 'ImageValidationError';
  constructor(
    readonly reason: ImageValidationReason,
    message: string,
  ) {
    super(message);
  }
}

export class ProviderNotConfiguredError extends NonRetryableError {
  override readonly name = 'ProviderNotConfiguredError';
  constructor(readonly provider: string) {
    super(`Provider "${provider}" is not configured`);
  }
}

/**
 * Typed errors every provider adapter must throw (see ARCHITECTURE.md,
 * "Provider error contract"). The queue retries plain Errors and never retries
 * NonRetryableError subclasses.
 */

/** Output did not match the contract. Callers may re-prompt once, then retry. */
export class ProviderResponseError extends Error {
  override readonly name = 'ProviderResponseError';
  constructor(
    readonly provider: string,
    message: string,
  ) {
    super(`[${provider}] ${message}`);
  }
}

/** Credentials rejected. Retrying cannot help; the provider is marked ERROR. */
export class ProviderAuthError extends NonRetryableError {
  override readonly name = 'ProviderAuthError';
  constructor(readonly provider: string, message = 'Credentials were rejected') {
    super(`[${provider}] ${message}`);
  }
}

/** Vendor rate limit. Retryable, honouring retryAfterMs when given. */
export class ProviderRateLimitError extends Error {
  override readonly name = 'ProviderRateLimitError';
  constructor(
    readonly provider: string,
    readonly retryAfterMs?: number,
  ) {
    super(`[${provider}] Rate limited${retryAfterMs ? `, retry after ${retryAfterMs}ms` : ''}`);
  }
}

/** Call exceeded its deadline or was aborted by the caller's signal. Retryable. */
export class ProviderTimeoutError extends Error {
  override readonly name = 'ProviderTimeoutError';
  constructor(readonly provider: string, readonly timeoutMs?: number) {
    super(`[${provider}] Timed out${timeoutMs ? ` after ${timeoutMs}ms` : ''}`);
  }
}

/** Vendor refused the content (safety filter, policy). Not retryable. */
export class ProviderRefusedError extends NonRetryableError {
  override readonly name = 'ProviderRefusedError';
  constructor(readonly provider: string, readonly reason: string) {
    super(`[${provider}] Refused: ${reason}`);
  }
}
