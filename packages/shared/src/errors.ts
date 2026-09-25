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

/** A provider returned output that does not match the expected contract. */
export class ProviderResponseError extends Error {
  override readonly name = 'ProviderResponseError';
  constructor(
    readonly provider: string,
    message: string,
  ) {
    super(`[${provider}] ${message}`);
  }
}
