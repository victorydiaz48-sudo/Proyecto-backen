/** Payload of the content-jobs queue: ids only; workers read everything else from the database. */
export interface ContentJobPayload {
  contentJobId: string;
  organizationId: string;
}

export const CONTENT_JOBS_QUEUE = 'content-jobs';
