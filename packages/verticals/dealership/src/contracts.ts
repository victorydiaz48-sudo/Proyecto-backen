import { FIELD_SOURCES } from '@autocontent/shared';
import { httpUrl, idParams, isoDate, page, paginationQuery, uuid, type RouteContract } from '@autocontent/contracts';
import { z } from 'zod';
import { BODY_TYPES, SEGMENTS } from './entities/vehicle-analysis.js';

// Vehicle resource schemas and routes — moved out of @autocontent/contracts
// in Phase 3b (docs/phase-3-design.md §10) once BODY_TYPES/SEGMENTS became
// dealership-module-owned. Not yet merged into the live core route table
// (no handler consumes any REST route today) — see VerticalModule.routes.

const provenanceEntry = z.object({ source: z.enum(FIELD_SOURCES), confidence: z.number().optional() });
export const VEHICLE_STATUSES = ['DRAFT', 'AVAILABLE', 'RESERVED', 'SOLD', 'ARCHIVED'] as const;

export const vehicle = z.object({
  id: uuid,
  status: z.enum(VEHICLE_STATUSES),
  make: z.string().nullable(),
  model: z.string().nullable(),
  version: z.string().nullable(),
  year: z.number().int().nullable(),
  color: z.string().nullable(),
  bodyType: z.enum(BODY_TYPES).nullable(),
  segment: z.enum(SEGMENTS).nullable(),
  provenance: z.record(z.string(), provenanceEntry),
  visualFeatures: z.array(z.object({ value: z.string(), source: z.enum(['detected', 'inferred']) })),
  priceMinor: z.number().int().nullable(),
  currency: z.string().nullable(),
  mileageKm: z.number().int().nullable(),
  city: z.string().nullable(),
  financingNotes: z.string().nullable(),
  offerText: z.string().nullable(),
  primaryImageUrl: httpUrl.nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export const vehicleListQuery = paginationQuery.extend({
  status: z.enum(VEHICLE_STATUSES).optional(),
  q: z.string().max(100).optional(),
});
/** Only user-provided facts are editable; identity edits are tagged "user-provided". */
export const vehiclePatch = z
  .object({
    status: z.enum(VEHICLE_STATUSES),
    make: z.string().min(1).max(60),
    model: z.string().min(1).max(60),
    version: z.string().min(1).max(60),
    year: z.number().int().min(1950).max(2100),
    color: z.string().min(1).max(60),
    priceMinor: z.number().int().min(0).max(1_000_000_000_00),
    currency: z.string().regex(/^[A-Z]{3}$/),
    mileageKm: z.number().int().min(0).max(5_000_000),
    city: z.string().min(1).max(80),
    financingNotes: z.string().max(500),
    offerText: z.string().max(500),
    vin: z.string().regex(/^[A-HJ-NPR-Z0-9]{11,17}$/i),
    stockNumber: z.string().max(40),
  })
  .partial();

export const dealershipRoutes: RouteContract[] = [
  { id: 'vehicles.list', method: 'GET', path: '/vehicles', auth: 'OPERATOR', tag: 'Vehicles', summary: 'List vehicles', query: vehicleListQuery, response: page(vehicle) },
  { id: 'vehicles.get', method: 'GET', path: '/vehicles/:id', auth: 'OPERATOR', tag: 'Vehicles', summary: 'Vehicle with per-field provenance', params: idParams, response: vehicle },
  { id: 'vehicles.update', method: 'PATCH', path: '/vehicles/:id', auth: 'EDITOR', tag: 'Vehicles', summary: 'Edit user-provided facts (tagged "user-provided")', params: idParams, body: vehiclePatch, response: vehicle },
];
