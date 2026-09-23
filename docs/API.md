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
| Locations | `GET/POST /admin/locations`, `GET/PATCH/DELETE /admin/locations/:id` | A (GET: A,P) |
| Users | `GET/POST /admin/users`, `PATCH /admin/users/:id` | A |
| Professionals | `GET/POST /admin/professionals`, `GET/PATCH/DELETE /:id`, `PUT /:id/services` | A (GET: A,P) |
| Services | `GET/POST /admin/services`, `GET/PATCH/DELETE /:id` | A (GET: A,P) |
| Working hours | `GET/PUT /admin/professionals/:id/working-hours` (reemplazo completo de la semana) | A; P solo lectura de lo suyo |
| Time blocks | `GET/POST /admin/time-blocks`, `DELETE /:id` | A; P solo los suyos |
| Customers | `GET /admin/customers?search=`, `GET/PATCH /:id` | A; P solo clientes con citas suyas (lectura) |
| Bookings | `GET /admin/bookings?from&to&professionalId&status`, `POST`, `GET /:id`, `PATCH /:id` (reprogramar), `POST /:id/status` | A; P solo las suyas |
| Availability | `GET /admin/availability` (igual que la pública, sin límite de antelación) | A,P |
| Audit | `GET /admin/audit-logs` | A |

`DELETE` es borrado lógico en entidades referenciadas por citas.

**Transiciones de estado** (`POST /admin/bookings/:id/status { status, reason? }`):
```
PENDING   → CONFIRMED | CANCELLED
CONFIRMED → COMPLETED | CANCELLED | NO_SHOW
CANCELLED → CONFIRMED   (solo A, re-verifica disponibilidad)
COMPLETED, NO_SHOW → (final; A puede corregir a la otra)
```

## 5. Salud

`GET /healthz` (vivo) · `GET /readyz` (BD accesible). Sin datos sensibles.
