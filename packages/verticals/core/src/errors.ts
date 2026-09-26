import { NonRetryableError } from '@autocontent/shared';

/** Unknown vertical slug, duplicate registration, or a broken module contract. */
export class VerticalRegistryError extends NonRetryableError {
  override readonly name = 'VerticalRegistryError';
}
