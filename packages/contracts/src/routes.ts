import { z } from 'zod';
import { errorResponse, idParams, okResponse, page, paginationQuery, type Role } from './common.js';
import * as r from './resources.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RouteContract {
  /** Stable operation id, used by the API server and the dashboard client. */
  id: string;
  method: HttpMethod;
  /** Path under /api/v1, with :params. */
  path: string;
  /** 'public' = no session. Otherwise the minimum role (OWNER > ADMIN > EDITOR > OPERATOR). */
  auth: 'public' | Role;
  summary: string;
  tag: string;
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodType;
  response: z.ZodType;
  /** Success status; 200 unless stated. */
  status?: 200 | 201 | 202 | 204;
}

const route = (c: RouteContract) => c;

/**
 * Every REST endpoint of apps/api. The server registers routes from this
 * table (Phase 2), validating params/query/body and enforcing `auth`; the
 * dashboard (Phase 9) builds its typed client from it; the OpenAPI document
 * in docs/api/openapi.json is generated from it.
 */
export const ROUTES = [
  // Auth
  route({ id: 'auth.login', method: 'POST', path: '/auth/login', auth: 'public', tag: 'Auth', summary: 'Start a session (sets the httpOnly `sid` cookie)', body: r.loginBody, response: r.me }),
  route({ id: 'auth.logout', method: 'POST', path: '/auth/logout', auth: 'OPERATOR', tag: 'Auth', summary: 'End the current session', response: okResponse }),
  route({ id: 'auth.me', method: 'GET', path: '/auth/me', auth: 'OPERATOR', tag: 'Auth', summary: 'Current user and organization', response: r.me }),

  // Organization
  route({ id: 'organization.get', method: 'GET', path: '/organization', auth: 'OPERATOR', tag: 'Organization', summary: 'The session’s organization', response: r.organization }),
  route({ id: 'organization.update', method: 'PATCH', path: '/organization', auth: 'OWNER', tag: 'Organization', summary: 'Rename the organization', body: r.organizationPatch, response: r.organization }),
  route({ id: 'settings.get', method: 'GET', path: '/organization/settings', auth: 'EDITOR', tag: 'Organization', summary: 'Organization settings (language, publishing mode, limits…)', response: r.settings }),
  route({ id: 'settings.update', method: 'PATCH', path: '/organization/settings', auth: 'ADMIN', tag: 'Organization', summary: 'Update settings. Audited; cost caps can only tighten plan limits.', body: r.settingsPatch, response: r.settings }),

  // Users
  route({ id: 'users.list', method: 'GET', path: '/users', auth: 'ADMIN', tag: 'Users', summary: 'List users', query: paginationQuery, response: page(r.user) }),
  route({ id: 'users.create', method: 'POST', path: '/users', auth: 'ADMIN', tag: 'Users', summary: 'Invite a user (only an OWNER can create OWNER/ADMIN)', body: r.userCreate, response: r.user, status: 201 }),
  route({ id: 'users.update', method: 'PATCH', path: '/users/:id', auth: 'ADMIN', tag: 'Users', summary: 'Change name, role or status', params: idParams, body: r.userPatch, response: r.user }),
  route({ id: 'users.disable', method: 'DELETE', path: '/users/:id', auth: 'ADMIN', tag: 'Users', summary: 'Disable a user (users are never hard-deleted)', params: idParams, response: okResponse }),

  // Telegram
  route({ id: 'telegram.invites.create', method: 'POST', path: '/telegram/invites', auth: 'ADMIN', tag: 'Telegram', summary: 'Create a one-time t.me deep link that links a Telegram user to this organization', body: r.telegramInviteCreate, response: r.telegramInvite, status: 201 }),
  route({ id: 'telegram.accounts.list', method: 'GET', path: '/telegram/accounts', auth: 'ADMIN', tag: 'Telegram', summary: 'Linked Telegram accounts', query: paginationQuery, response: page(r.telegramAccount) }),
  route({ id: 'telegram.accounts.update', method: 'PATCH', path: '/telegram/accounts/:id', auth: 'ADMIN', tag: 'Telegram', summary: 'Block/unblock, change role or language', params: idParams, body: r.telegramAccountPatch, response: r.telegramAccount }),

  // Vehicles
  route({ id: 'vehicles.list', method: 'GET', path: '/vehicles', auth: 'OPERATOR', tag: 'Vehicles', summary: 'List vehicles', query: r.vehicleListQuery, response: page(r.vehicle) }),
  route({ id: 'vehicles.get', method: 'GET', path: '/vehicles/:id', auth: 'OPERATOR', tag: 'Vehicles', summary: 'Vehicle with per-field provenance', params: idParams, response: r.vehicle }),
  route({ id: 'vehicles.update', method: 'PATCH', path: '/vehicles/:id', auth: 'EDITOR', tag: 'Vehicles', summary: 'Edit user-provided facts (tagged "user-provided")', params: idParams, body: r.vehiclePatch, response: r.vehicle }),

  // Jobs
  route({ id: 'jobs.list', method: 'GET', path: '/jobs', auth: 'OPERATOR', tag: 'Jobs', summary: 'Generation jobs', query: r.jobListQuery, response: page(r.job) }),
  route({ id: 'jobs.get', method: 'GET', path: '/jobs/:id', auth: 'OPERATOR', tag: 'Jobs', summary: 'Job status and cost', params: idParams, response: r.job }),
  route({ id: 'jobs.create', method: 'POST', path: '/jobs', auth: 'OPERATOR', tag: 'Jobs', summary: 'Create a job from the dashboard; returns a signed upload URL', body: r.jobCreate, response: r.jobCreated, status: 201 }),
  route({ id: 'jobs.start', method: 'POST', path: '/jobs/:id/start', auth: 'OPERATOR', tag: 'Jobs', summary: 'Start processing after the photo upload finished', params: idParams, response: r.job, status: 202 }),
  route({ id: 'jobs.retry', method: 'POST', path: '/jobs/:id/retry', auth: 'EDITOR', tag: 'Jobs', summary: 'Retry a failed job (idempotent; never double-charges)', params: idParams, response: r.job, status: 202 }),
  route({ id: 'jobs.cancel', method: 'POST', path: '/jobs/:id/cancel', auth: 'EDITOR', tag: 'Jobs', summary: 'Cancel a pending or running job', params: idParams, response: r.job }),

  // Content
  route({ id: 'assets.list', method: 'GET', path: '/assets', auth: 'OPERATOR', tag: 'Content', summary: 'Generated content', query: r.assetListQuery, response: page(r.asset) }),
  route({ id: 'assets.get', method: 'GET', path: '/assets/:id', auth: 'OPERATOR', tag: 'Content', summary: 'One asset with QA report and trace', params: idParams, response: r.asset }),
  route({ id: 'assets.regenerate', method: 'POST', path: '/assets/:id/regenerate', auth: 'EDITOR', tag: 'Content', summary: 'Create a new version of an asset', params: idParams, body: r.assetRegenerate, response: r.asset, status: 202 }),
  route({ id: 'assets.approve', method: 'POST', path: '/assets/:id/approve', auth: 'EDITOR', tag: 'Content', summary: 'Approve an asset for publishing', params: idParams, response: r.asset }),

  // Templates
  route({ id: 'templates.list', method: 'GET', path: '/templates', auth: 'OPERATOR', tag: 'Templates', summary: 'Available content templates', response: z.object({ items: z.array(r.templateSummary) }) }),
  route({ id: 'templates.get', method: 'GET', path: '/templates/:slug', auth: 'OPERATOR', tag: 'Templates', summary: 'Template details', params: z.object({ slug: z.string().regex(/^[a-z0-9-]+$/) }), response: r.templateSummary }),

  // Campaigns
  route({ id: 'campaigns.list', method: 'GET', path: '/campaigns', auth: 'OPERATOR', tag: 'Campaigns', summary: 'Campaigns', query: paginationQuery, response: page(r.campaign) }),
  route({ id: 'campaigns.create', method: 'POST', path: '/campaigns', auth: 'EDITOR', tag: 'Campaigns', summary: 'Create a campaign', body: r.campaignCreate, response: r.campaign, status: 201 }),
  route({ id: 'campaigns.get', method: 'GET', path: '/campaigns/:id', auth: 'OPERATOR', tag: 'Campaigns', summary: 'One campaign', params: idParams, response: r.campaign }),
  route({ id: 'campaigns.update', method: 'PATCH', path: '/campaigns/:id', auth: 'EDITOR', tag: 'Campaigns', summary: 'Update a campaign', params: idParams, body: r.campaignPatch, response: r.campaign }),
  route({ id: 'campaigns.delete', method: 'DELETE', path: '/campaigns/:id', auth: 'EDITOR', tag: 'Campaigns', summary: 'Delete a campaign (jobs keep their content)', params: idParams, response: okResponse }),

  // Publishing
  route({ id: 'publishingAccounts.list', method: 'GET', path: '/publishing-accounts', auth: 'EDITOR', tag: 'Publishing', summary: 'Connected social accounts', response: z.object({ items: z.array(r.publishingAccount) }) }),
  route({ id: 'publishingAccounts.sync', method: 'POST', path: '/publishing-accounts/sync', auth: 'ADMIN', tag: 'Publishing', summary: 'Fetch accounts from the organization’s Blotato workspace', response: z.object({ items: z.array(r.publishingAccount) }) }),
  route({ id: 'publishingAccounts.delete', method: 'DELETE', path: '/publishing-accounts/:id', auth: 'ADMIN', tag: 'Publishing', summary: 'Disconnect an account', params: idParams, response: okResponse }),
  route({ id: 'publications.list', method: 'GET', path: '/publications', auth: 'OPERATOR', tag: 'Publishing', summary: 'Publications and their status', query: r.publicationListQuery, response: page(r.publication) }),
  route({ id: 'publications.create', method: 'POST', path: '/publications', auth: 'EDITOR', tag: 'Publishing', summary: 'Publish or schedule approved content (respects the publishing mode)', body: r.publicationCreate, response: r.publication, status: 202 }),
  route({ id: 'publications.cancel', method: 'POST', path: '/publications/:id/cancel', auth: 'EDITOR', tag: 'Publishing', summary: 'Cancel a scheduled publication', params: idParams, response: r.publication }),

  // Integrations & keys
  route({ id: 'integrations.list', method: 'GET', path: '/integrations', auth: 'ADMIN', tag: 'Integrations', summary: 'Status of every provider: CONNECTED / NOT_CONFIGURED / ERROR', response: z.object({ items: z.array(r.integration) }) }),
  route({ id: 'integrations.test', method: 'POST', path: '/integrations/:adapter/test', auth: 'ADMIN', tag: 'Integrations', summary: 'Run the provider’s connection test (never spends generation credit)', params: r.adapterParams, response: r.integrationTestResult }),
  route({ id: 'apiKeys.put', method: 'PUT', path: '/api-keys/:adapter', auth: 'ADMIN', tag: 'Integrations', summary: 'Store the organization’s key for a provider (encrypted, write-only)', params: r.adapterParams, body: r.apiKeyPut, response: r.apiKeySaved }),
  route({ id: 'apiKeys.delete', method: 'DELETE', path: '/api-keys/:adapter', auth: 'ADMIN', tag: 'Integrations', summary: 'Revoke the organization’s key for a provider', params: r.adapterParams, response: okResponse }),

  // Usage & audit
  route({ id: 'usage.report', method: 'GET', path: '/usage', auth: 'ADMIN', tag: 'Usage', summary: 'Usage and cost for a date range', query: r.usageQuery, response: r.usageReport }),
  route({ id: 'usage.summary', method: 'GET', path: '/usage/summary', auth: 'EDITOR', tag: 'Usage', summary: 'Dashboard metrics for the current month', response: r.usageSummary }),
  route({ id: 'audit.list', method: 'GET', path: '/audit-logs', auth: 'ADMIN', tag: 'Audit', summary: 'Security-relevant actions', query: r.auditLogQuery, response: page(r.auditLog) }),

  // System
  route({ id: 'system.health', method: 'GET', path: '/health', auth: 'public', tag: 'System', summary: 'Liveness', response: r.health }),
  route({ id: 'system.ready', method: 'GET', path: '/ready', auth: 'public', tag: 'System', summary: 'Readiness (database, Redis)', response: r.readiness }),
] as const satisfies readonly RouteContract[];

export type RouteId = (typeof ROUTES)[number]['id'];

export { errorResponse };
