// Minimal typings for the in-process S3 test server (test-only dependency).
declare module 's3rver' {
  interface S3rverOptions {
    port?: number;
    address?: string;
    silent?: boolean;
    directory: string;
    configureBuckets?: { name: string; configs?: unknown[] }[];
  }
  export default class S3rver {
    constructor(opts: S3rverOptions);
    run(): Promise<{ address: string; port: number }>;
    close(): Promise<void>;
  }
}
