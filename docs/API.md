# API

Base: `/api/v1`. JSON UTF-8. Todas las fechas-hora en ISO 8601 UTC (`2026-10-01T13:00:00.000Z`);
además, donde ayuda al frontend, se incluye la hora local del tenant (`localDate`, `localTime`).

## 1. Convenciones

**Errores** (siempre este formato, sin detalles internos):

```json
{ "error": { "code": "SLOT_UNAVAILABLE", "message": "Ese horario ya no está disponible.", "details": {} }, "requestId": "..." }
```

| HTTP | code | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | cuerpo/query inválidos (`details.fields`) |
| 400 | `INVALID_CURRENT_PASSWORD` | cambio de contraseña con la actual incorrecta |
| 401 | `UNAUTHENTICATED` | sin sesión válida |
| 401 | `INVALID_CREDENTIALS` | login fallido (mismo mensaje exista o no el usuario o el negocio) |
| 403 | `CSRF_REJECTED` | petición con cookie que modifica estado desde otro origen |
| 403 | `FORBIDDEN` | rol sin permiso |
| 404 | `NOT_FOUND` | recurso inexistente **o de otro tenant** (nunca se distingue) |
| 409 | `SLOT_UNAVAILABLE` | hueco ocupado; incluye `details.alternatives` |
| 409 | `CONFLICT` | otros conflictos (nombre duplicado, transición inválida) |
| 422 | `SLOT_INVALID` | la hora no es reservable (fuera de horario, excede cierre…); `details.reason` + `alternatives` |
| 413 | `PAYLOAD_TOO_LARGE` | cuerpo > 16 KB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | cuerpo que no es `application/json` |
| 429 | `RATE_LIMITED` | con `Retry-After` |
| 500 | `INTERNAL` | mensaje genérico |

Paginación en listados admin: `?cursor=&limit=` (máx. 100) → `{ items, nextCursor }`.

## 2. API pública

Sin autenticación, sin cookies. CORS `Access-Control-Allow-Origin: *`. Rate limit por IP y por tenant.
`:tenantSlug` resuelve un tenant `ACTIVE`; si no, 404. Solo se exponen entidades activas.

### GET `/public/:tenantSlug`
```json
{ "name": "Barbearia Central", "slug": "barbearia-central", "timezone": "America/Sao_Paulo",
  "currency": "BRL", "locale": "pt-BR", "slotIntervalMinutes": 15, "bookingHorizonDays": 60,
  "today": "2026-09-23",
  "locations": [{ "id": "…", "name": "Centro", "address": "…", "isDefault": true }] }
```
`today` es la fecha actual en la zona del tenant (el generador hoy usa el reloj del dispositivo).

### GET `/public/:tenantSlug/services`
```json
{ "items": [{ "id": "…", "name": "Corte", "description": null, "category": null,
  "durationMinutes": 30, "priceCents": 4500, "currency": "BRL" }] }
```

### GET `/public/:tenantSlug/professionals?serviceId=&locationId=`
```json
{ "items": [{ "id": "…", "displayName": "Carlos", "title": "Barbeiro sênior", "bio": null,
  "photoUrl": null, "serviceIds": ["…"] }] }
```

### GET `/public/:tenantSlug/availability`
Query:
| Param | Req. | Notas |
|---|---|---|
| serviceId | sí | uuid |
| professionalId | sí | uuid o `any` |
| date | sí* | `YYYY-MM-DD` en la zona del tenant |
| from, to | no | rango de fechas (máx. 14 días) en lugar de `date` |
| locationId | no | filtra |

```json
{ "timezone": "America/Sao_Paulo", "serviceId": "…", "durationMinutes": 30,
  "days": [{ "date": "2026-09-24", "slots": [
    { "startAt": "2026-09-24T12:00:00.000Z", "localTime": "09:00", "locationId": "…",
      "professionalIds": ["…", "…"] } ] }] }
```
Con `professionalId` concreto, `professionalIds` tiene un elemento. Nunca se devuelven datos de
otras citas (ni nombres de clientes), solo huecos.

### POST `/public/:tenantSlug/bookings`
Cabecera opcional `Idempotency-Key: <uuid>` (recomendada).

```json
{ "serviceId": "…", "professionalId": "any", "date": "2026-09-24", "time": "09:00",
  "locationId": null,
  "customer": { "name": "João", "phone": "41 99876-5432", "email": null },
  "notes": "Degradê" }
```
Nunca se aceptan `price`, `duration`, `endAt`, `status`, `tenantId` (los campos desconocidos se
rechazan con 400).

`201`:
```json
{ "booking": { "id": "…", "status": "CONFIRMED", "startAt": "…", "endAt": "…",
  "localDate": "2026-09-24", "localTime": "09:00",
  "service": { "name": "Corte", "durationMinutes": 30, "priceCents": 4500, "currency": "BRL" },
  "professional": { "id": "…", "displayName": "Carlos" },
  "location": { "id": "…", "name": "Centro" } },
  "whatsappUrl": "https://wa.me/55…?text=…" }
```
`whatsappUrl` (opcional, si el local/tenant tiene WhatsApp) permite a la página mantener el paso
final por WhatsApp como aviso al negocio. La cita ya existe en el backend.

`409 SLOT_UNAVAILABLE` / `422 SLOT_INVALID`:
```json
{ "error": { "code": "SLOT_UNAVAILABLE", "message": "…",
  "details": { "reason": "OVERLAPS_BOOKING", "alternatives": [
    { "startAt": "…", "localDate": "2026-09-24", "localTime": "09:30", "professionalIds": ["…"] } ] } } }
```

## 3. Autenticación (panel) — implementado (Fase 3)

| Método | Ruta | Notas |
|---|---|---|
| POST | `/auth/login` | `{ tenantSlug, email, password }` (estricto). `200` → cuerpo igual que `/auth/me` + cookie `sid` (`HttpOnly; SameSite=Strict; Path=/`, `Secure` en producción). Fallo → `401 INVALID_CREDENTIALS`. 5 fallos por negocio+email en 15 min → `429`; 20 peticiones por IP en 15 min → `429`. |
| POST | `/auth/logout` | `204`; borra la sesión en BD y la cookie |
| GET | `/auth/me` | `{ user: { id, email, role, professionalId }, tenant: { id, slug, name, timezone } }` |
| POST | `/auth/password` | `{ currentPassword, newPassword }` → `204`; cierra las demás sesiones del usuario |

Email y slug no distinguen mayúsculas. El mismo email puede existir en negocios distintos: por eso
el login pide el `tenantSlug`.

Alta de negocios: no hay endpoint público (decisión §4.1 del plan). El operador ejecuta en el servidor:

```bash
npm run tenant:create -w apps/api -- --slug barbearia-central --name "Barbearia Central" \
  --timezone America/Sao_Paulo --country 55 --currency BRL --locale pt-BR --admin-email dono@exemplo.com
```

Crea tenant + local por defecto + primer ADMIN en una transacción. La contraseña inicial sale de
`TENANT_ADMIN_PASSWORD` o se genera y se muestra una sola vez.

## 4. API de administración

Prefijo `/admin`. Requiere sesión. El tenant es **siempre** el de la sesión.
Permisos: A = ADMIN, P = PROFESSIONAL (solo sus propios recursos).

| Recurso | Endpoints | Roles |
|---|---|---|
| Tenant settings ✅ | `GET/PATCH /admin/settings` (`name`, `timezone`, `defaultCountryCode`, `currency`, `locale`, `slotIntervalMinutes`, `defaultBookingStatus` ∈ {PENDING, CONFIRMED}, `bookingLeadMinutes`, `bookingHorizonDays`; el slug no se cambia) | A |
| Locations ✅ | `GET /admin/locations?includeInactive`, `POST`, `GET/PATCH/DELETE /:id` | A (GET: A,P) |
| Users | `GET/POST /admin/users`, `PATCH /admin/users/:id` | A |
| Professionals ✅ | `GET /admin/professionals?includeInactive&serviceId`, `POST`, `GET/PATCH/DELETE /:id`, `PUT /:id/services` | A (GET: A,P) |
| Services ✅ | `GET /admin/services?includeInactive`, `POST`, `GET/PATCH/DELETE /:id` | A (GET: A,P) |
| Working hours ✅ | `GET/PUT /admin/professionals/:id/working-hours` (reemplazo completo de la semana) | A; P solo lectura de lo suyo |
| Time blocks ✅ | `GET /admin/time-blocks?from&to&professionalId&locationId`, `POST`, `DELETE /:id` | A; P solo los suyos (y ve los generales) |
| Customers ✅ | `GET /admin/customers?search&cursor&limit`, `POST`, `GET/PATCH /:id` | A; P solo lectura de clientes con citas suyas |
| Bookings ✅ | `GET /admin/bookings?from&to&professionalId&locationId&customerId&status`, `POST`, `GET /:id`, `PATCH /:id` (reprogramar), `POST /:id/status` | A; P solo las suyas |
| Availability ✅ | `GET /admin/availability?serviceId&professionalId&date` (o `from`/`to`) `&locationId` — igual que la pública, sin antelación mínima ni horizonte | A,P |
| Audit | `GET /admin/audit-logs` | A |

`DELETE` es borrado lógico en entidades referenciadas por citas.

### Servicios y profesionales (Fase 4)

**Servicio** (`POST` / `PATCH`, cuerpo estricto):

| Campo | Regla |
|---|---|
| `name` | 1–80, único entre los activos del negocio sin distinguir mayúsculas (`409 CONFLICT`) |
| `description` | ≤ 200, `""` → `null` |
| `category` | ≤ 40, `""` → `null` (equivale a `## Categoría` del generador) |
| `durationMinutes` | entero 5–600 |
| `bufferAfterMinutes` | entero 0–120, por defecto 0 (limpieza entre citas) |
| `priceCents` | entero ≥ 0 (R$ 45,00 → `4500`); moneda = la del negocio |
| `sortOrder` | entero ≥ 0 |
| `active` | solo en `PATCH`; `DELETE` = `active: false` |

Cambiar precio o duración no afecta a citas existentes (guardan copia). Respuesta: el servicio con
`id, …, active, createdAt, updatedAt`; listados `{ items }` ordenados por `sortOrder`, `name`.

**Profesional**: `displayName` (1–80), `title` (≤ 80), `bio` (≤ 400), `photoUrl` (solo `https://`),
`sortOrder`, `active` (PATCH); en `POST` opcionalmente `serviceIds`. Respuesta con `serviceIds` y
`userId` (la vinculación con un usuario PROFESSIONAL llegará con la gestión de usuarios, Fase 10).

- `PUT /admin/professionals/:id/services { serviceIds }` reemplaza la lista completa (duplicados se ignoran).
  Un id inexistente o de otro negocio → `400 VALIDATION_ERROR` con el mismo mensaje en ambos casos.
- Desactivar (`DELETE` o `PATCH { active: false }`) con citas `PENDING`/`CONFIRMED` que aún no han
  terminado → `409 CONFLICT` con `details.futureBookings`.
- Todos los cambios se auditan con antes/después.

### Locales, horarios y bloqueos (Fase 5)

**Local**: `name` (1–40), `address` (≤ 200), `mapsUrl` (`https://`), `whatsapp` (se normaliza a E.164
con el país del negocio; inválido → 400), `sortOrder`, `isDefault`, `active` (PATCH).
- Siempre hay exactamente un local por defecto y activo: marcar otro como predeterminado desmarca el
  anterior; quitarle la marca o desactivar el predeterminado → `409`.
- Desactivar un local con horarios o citas pendientes → `409` con `details { workingHours, futureBookings }`.

**Horario laboral** — `PUT /admin/professionals/:id/working-hours`:

```json
{ "intervals": [
  { "locationId": "…", "weekday": 1, "start": "09:00", "end": "13:00" },
  { "locationId": "…", "weekday": 1, "start": "14:00", "end": "19:00" },
  { "locationId": "…", "weekday": 5, "start": "18:00", "end": "24:00" },
  { "locationId": "…", "weekday": 6, "start": "00:00", "end": "02:00" } ] }
```

- `weekday`: 0 = domingo … 6 = sábado (igual que el generador). Horas locales del negocio `HH:MM`;
  `end` admite `24:00`. Un horario que cruza medianoche se envía como dos intervalos (se unen al calcular).
- Reemplaza la semana completa. Máx. 70 intervalos. Contiguos permitidos; solapados el mismo día → 400,
  aunque sean en locales distintos. Local inexistente, de otro negocio o inactivo → 400.
- Si el nuevo horario deja fuera alguna cita `PENDING`/`CONFIRMED` que aún no terminó (en su local) →
  `409` con `details.bookingsOutsideHours`.
- `GET` devuelve `{ items: [{ id, locationId, weekday, start, end }] }` ordenados.

**Bloqueo** — `POST /admin/time-blocks`:

```json
{ "professionalId": "…" | null, "locationId": "…" | null,
  "startAt": "2026-10-01T14:00:00-03:00", "endAt": "2026-10-01T16:00:00-03:00", "reason": "Médico" }
```

- `professionalId: null` = todos los profesionales (del `locationId` si se indica, o de todo el negocio).
- Fechas ISO 8601 **con zona** (sin zona → 400). Máx. 366 días.
- Choca con citas activas → `409` con `details.conflictingBookings` (cancelar o mover antes). Contiguo sí.
- PROFESSIONAL: solo su agenda (`professionalId` omitido o el suyo; otro, `null` o `locationId` → 403).
  Ve sus bloqueos y los generales; borrar uno ajeno → 404.
- `GET` sin `from`/`to`: desde ahora, 60 días. Rango máx. 366 días.

Cambios de horario, bloqueos (y más adelante citas) bloquean la fila del profesional
(`SELECT … FOR UPDATE`) dentro de su transacción, así no se pisan entre sí.

### Clientes y citas (Fase 6)

**Cliente**: `name` (1–80), `phone` (se normaliza a E.164 con el país del negocio; único por negocio →
`409` con `details.customerId` del existente), `email`, `notes` (≤ 500). Sin borrado (retención: pendiente).
Búsqueda `search` por nombre o por dígitos del teléfono (≥ 3). Paginación `{ items, nextCursor }`.

**Crear cita** — `POST /admin/bookings`:

```json
{ "serviceId": "…", "professionalId": "…", "date": "2026-10-01", "time": "10:00",
  "locationId": null, "customer": { "name": "Pedro", "phone": "41 98888-7777" },
  "notes": "Degradê", "status": "CONFIRMED" }
```

- `date`/`time` son locales del negocio; el servidor aplica la zona. Una hora inexistente o repetida
  por el cambio de horario → `422 SLOT_INVALID` con `reason: INVALID_LOCAL_TIME`.
- `customerId` **o** `customer` (uno de los dos). Con `customer`, se reutiliza el cliente con ese
  teléfono si existe (sin cambiarle el nombre).
- `status` opcional: solo `PENDING`/`CONFIRMED`; por defecto el del negocio.
- Precio, duración, `endAt` (= inicio + duración + limpieza), local, origen (`ADMIN`/`PROFESSIONAL`) los
  decide el servidor. Campos como `priceCents`, `durationMinutes`, `endAt`, `source` → 400.
- El panel no aplica antelación mínima ni horizonte (la web pública sí); sí rechaza el pasado.
- PROFESSIONAL solo crea citas en su propia agenda.

Respuesta (también en listados y detalle):

```json
{ "id": "…", "status": "CONFIRMED", "startAt": "2026-10-01T13:00:00.000Z", "endAt": "2026-10-01T13:30:00.000Z",
  "localDate": "2026-10-01", "localTime": "10:00",
  "service": { "id": "…", "name": "Corte", "durationMinutes": 30 }, "priceCents": 4500, "currency": "BRL",
  "professional": { "id": "…", "displayName": "Carlos" }, "location": { "id": "…", "name": "Principal" },
  "customer": { "id": "…", "name": "Pedro", "phoneE164": "+5541988887777" },
  "customerNotes": "Degradê", "source": "ADMIN", "cancelledAt": null, "cancelReason": null, … }
```

**Errores de franja** (también en reprogramar y reactivar):

| HTTP | code | `details.reason` |
|---|---|---|
| 422 | `SLOT_INVALID` | `PROFESSIONAL_NOT_FOUND`, `PROFESSIONAL_INACTIVE`, `SERVICE_NOT_FOUND`, `PROFESSIONAL_DOES_NOT_OFFER_SERVICE`, `NOT_WORKING_THAT_DAY`, `OUTSIDE_WORKING_HOURS`, `EXCEEDS_CLOSING_TIME`, `IN_THE_PAST`, `TOO_SOON`, `BEYOND_HORIZON`, `INVALID_LOCAL_TIME` |
| 409 | `SLOT_UNAVAILABLE` | `OVERLAPS_BOOKING`, `OVERLAPS_TIME_BLOCK` |

Un id de otro negocio produce el mismo motivo que uno inexistente.

**Alternativas** (Fase 7): cuando el motivo es de horario u ocupación (`NOT_WORKING_THAT_DAY`,
`OUTSIDE_WORKING_HOURS`, `EXCEEDS_CLOSING_TIME`, `OVERLAPS_*`, `IN_THE_PAST`, `TOO_SOON`,
`BEYOND_HORIZON`, `INVALID_LOCAL_TIME`), el error incluye `details.alternatives`: hasta 6 huecos reales
del mismo servicio y profesional, los más cercanos a la hora pedida ese día y, si faltan, los primeros
de los 7 días siguientes. Formato: `{ startAt, localDate, localTime, locationId, professionalIds }`.
Nunca se reserva otra hora automáticamente. Con motivos de servicio/profesional no hay alternativas.

**Disponibilidad en el panel** — `GET /admin/availability`: mismo formato que la pública (§2).
`professionalId` = uuid o `any`. Servicio o profesional inexistente, inactivo, de otro negocio o que
no hace el servicio → `404`. Rango máx. 14 días. No ofrece horas pasadas.

**Listado**: por defecto desde hace 24 h y 8 días; rango máx. 92 días; `status=PENDING,CONFIRMED`.

**Reprogramar** — `PATCH /admin/bookings/:id { date, time, professionalId?, serviceId?, locationId? }`:
solo citas `PENDING`/`CONFIRMED`. Sin cambio de servicio conserva precio y duración pactados; con
cambio de servicio toma los vigentes. PROFESSIONAL no puede pasar la cita a otro profesional.

**Transiciones de estado** (`POST /admin/bookings/:id/status { status, reason? }`):
```
PENDING   → CONFIRMED | CANCELLED
CONFIRMED → COMPLETED | CANCELLED | NO_SHOW      (COMPLETED/NO_SHOW solo si ya empezó)
CANCELLED → CONFIRMED                            (solo ADMIN; re-verifica la franja)
COMPLETED ⇄ NO_SHOW                              (solo ADMIN, para corregir)
```
Transición no permitida → `409 CONFLICT` con `details { from, to }`. Cancelar guarda `cancelledAt` y
`cancelReason`; reactivar los borra.

## 5. Salud

`GET /healthz` (vivo) · `GET /readyz` (BD accesible). Sin datos sensibles.
