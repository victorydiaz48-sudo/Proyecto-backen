// Test-only helpers. Import from "@autocontent/providers/testing"; never from app code.
// The vision provider contract is vertical-specific (it asserts against that
// vertical's own analysis schema) and lives in each vertical module's own
// testing entry, e.g. `@autocontent/verticals-dealership/testing`.
export { describeStorageProviderContract } from './storage/contract.js';
