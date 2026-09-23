# Base de datos

PostgreSQL 16 · Prisma · migraciones con `prisma migrate` (nunca `db push` fuera de prototipos locales).

## 1. Convenciones

- IDs `uuid` (`@default(uuid()) @db.Uuid`).
- Todas las fechas-hora como `timestamptz` en UTC (`@db.Timestamptz(3)`).
- Horas del día como **minutos desde medianoche** (`Int`, 0–1440) en la zona del tenant.
- Dinero en céntimos (`Int`) + `Tenant.currency` (ISO 4217, p. ej. `BRL`, `EUR`).
- Todo modelo de negocio tiene `tenantId` y `@@unique([tenantId, id])` para permitir **FKs
  compuestas**: una fila solo puede referenciar filas de su mismo tenant.
- `createdAt`, `updatedAt` en todas las tablas; borrado lógico (`active=false`/`archivedAt`) para
  profesionales, servicios y locales, porque las citas históricas los referencian.

## 2. Modelo (esquema lógico)

```
Tenant 1─* Location
Tenant 1─* User ─0..1─ Professional
Tenant 1─* Professional *─* Service   (vía ProfessionalService)
Professional 1─* WorkingHour *─1 Location
Professional 1─* TimeBlock
Tenant 1─* Customer
Booking *─1 Professional, Service, Customer, Location
Tenant 1─* AuditLog, NotificationOutbox, IdempotencyKey, Session(vía User)
```

### Tenant
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | |
| slug | text **unique** | `^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$`, lista de reservados (`admin`, `api`, …) |
| name | text | |
| timezone | text | IANA, validada en app (como `okTz` del generador) |
| defaultCountryCode | text | p. ej. `55` (campo `cc` del generador) |
| currency | char(3) | |
| locale | text | `pt-BR`, `es-ES`… |
| slotIntervalMinutes | int | por defecto 15; 5–120 |
| defaultBookingStatus | BookingStatus | `CONFIRMED` por defecto; solo `PENDING` o `CONFIRMED` |
| bookingLeadMinutes | int | antelación mínima, por defecto 60 |
| bookingHorizonDays | int | por defecto 60 |
| status | enum `ACTIVE`/`SUSPENDED` | tenant suspendido → API pública 404 |

### Location
`id, tenantId, name, address?, mapsUrl?, whatsapp? (E.164), isDefault bool, active bool`.
Índice único parcial: un solo `isDefault=true` por tenant. Se crea uno al crear el tenant.

### User
`id, tenantId, email (citext), passwordHash, role (Role), active, lastLoginAt?`.
`@@unique([tenantId, email])`. `Role = ADMIN | PROFESSIONAL` (enum ampliable).

### Session
`id, userId, tokenHash (unique), expiresAt, createdAt, ip?, userAgent?`. Se guarda solo el hash
(SHA-256) del token de la cookie.

### Professional
`id, tenantId, userId? (unique), displayName, title?, bio?, photoUrl?, active, sortOrder`.

### Service
`id, tenantId, name, description?, category?, durationMinutes (5–600), bufferAfterMinutes (0–120, def. 0),
priceCents (≥0), active, sortOrder`. `@@unique([tenantId, name])` (entre activos, índice parcial).

### ProfessionalService
`tenantId, professionalId, serviceId` — PK `(professionalId, serviceId)`.
FKs compuestas `(tenantId, professionalId) → Professional(tenantId, id)` y
`(tenantId, serviceId) → Service(tenantId, id)`.
(Futuro: `priceCentsOverride?`, `durationMinutesOverride?`.)

### WorkingHour
`id, tenantId, professionalId, locationId, weekday (0–6, 0=domingo como el generador),
startMinute (0–1439), endMinute (1–1440)`. `CHECK (startMinute < endMinute)`.
Varios intervalos por día permitidos. La app rechaza solapes del mismo profesional en el mismo día
(en cualquier local). Un horario que cruza medianoche se guarda como dos filas.

### TimeBlock
`id, tenantId, professionalId? (null = todo el local/tenant), locationId?, startAt, endAt, reason?,
createdByUserId`. `CHECK (startAt < endAt)`.

### Customer
`id, tenantId, name, phoneE164, email?, notes?`.
`@@unique([tenantId, phoneE164])`. Nunca se busca un cliente sin `tenantId`.

### Booking
| Campo | Notas |
|---|---|
| id, tenantId | |
| locationId, professionalId, serviceId, customerId | FKs compuestas con `tenantId` |
| startAt, endAt | `endAt = startAt + durationMinutes (+ buffer)`, calculado en servidor |
| status | `PENDING | CONFIRMED | COMPLETED | CANCELLED | NO_SHOW` |
| serviceNameSnapshot, priceCentsSnapshot, durationMinutesSnapshot, currencySnapshot | copia al reservar |
| customerNotes? | ≤ 300 caracteres (igual que el generador) |
| source | `PUBLIC_WEB | ADMIN | PROFESSIONAL` |
| createdByUserId? | null si viene de la web pública |
| cancelledAt?, cancelReason? | |
| manageTokenHash? | para futura gestión por el cliente |

### AuditLog
`id, tenantId, actorType (USER|PUBLIC|SYSTEM), actorUserId?, action, entityType, entityId,
before jsonb?, after jsonb?, ip?, requestId, createdAt`. Solo inserción; sin datos sensibles
(nunca hashes ni tokens).

### NotificationOutbox
`id, tenantId, bookingId?, channel, template, payload jsonb, status (PENDING|SENT|FAILED),
attempts, nextAttemptAt, lastError?`.

### IdempotencyKey
`tenantId, key, requestHash, responseStatus, responseBody jsonb, createdAt` — PK `(tenantId, key)`,
caduca a las 24 h.

## 3. Protección contra doble reserva (SQL en la migración)

Prisma no modela exclusion constraints; se añaden en SQL dentro de la migración generada
(`prisma migrate dev --create-only` y se edita el `migration.sql`):

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Booking"
  ADD CONSTRAINT booking_no_overlap
  EXCLUDE USING gist (
    "professionalId" WITH =,
    tstzrange("startAt", "endAt", '[)') WITH &&
  ) WHERE (status IN ('PENDING', 'CONFIRMED'));

ALTER TABLE "Booking" ADD CONSTRAINT booking_time_order CHECK ("startAt" < "endAt");
```

- `[)` → una cita que termina a las 10:00 no choca con otra que empieza a las 10:00.
- `COMPLETED` y `NO_SHOW` quedan fuera del constraint (ya pasaron); `CANCELLED` libera el hueco.
- Una transición `CANCELLED → CONFIRMED` vuelve a pasar por el constraint (y por `checkSlot`).
- Violación → código `23P01`, que la app traduce a `409 SLOT_UNAVAILABLE`.
- Como `schema.prisma` no conoce el constraint, un test de integración verifica que existe tras
  aplicar migraciones (evita que se pierda en una migración futura).

## 4. Índices principales

- `Booking (tenantId, professionalId, startAt)`, `Booking (tenantId, startAt)`, `Booking (tenantId, customerId)`.
- `WorkingHour (tenantId, professionalId, weekday)`.
- `TimeBlock (tenantId, professionalId, startAt)`.
- `AuditLog (tenantId, createdAt DESC)`.
- `NotificationOutbox (status, nextAttemptAt)`.

## 5. Migraciones

- Desarrollo: `prisma migrate dev --name <cambio>`; revisar el SQL generado antes de commitear.
- CI y producción: `prisma migrate deploy`. CI comprueba además `prisma migrate diff` contra el
  esquema para detectar drift.
- Las migraciones se commitean y nunca se editan una vez aplicadas en un entorno compartido.
- Seed (`prisma db seed`) solo para desarrollo/test: dos tenants de ejemplo (A y B) para probar aislamiento.
