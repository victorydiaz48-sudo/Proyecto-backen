# Arquitectura

## 1. Vista general

```
 Páginas generadas (cualquier dominio / file://)          Panel admin/profesional (SPA React)
          │  fetch JSON, sin cookies                               │  mismo origen, cookie de sesión
          ▼                                                        ▼
 ┌────────────────────────────── Servidor Fastify (un solo despliegue) ─────────────────────────────┐
 │  /api/v1/public/:tenantSlug/*   (CORS *, rate limit)      /api/v1/admin/*   /api/v1/auth/*        │
 │  /  → estáticos de la SPA (apps/admin/dist)                                                      │
 │                                                                                                  │
 │  Plugins: requestId · errorHandler · zod · rate-limit · cors (solo /public) · session · tenant    │
 │                                                                                                  │
 │  Módulos de dominio:  tenants · auth · professionals · services · schedule (working hours,       │
 │  time blocks) · customers · bookings · availability (motor puro) · audit · notifications (outbox)│
 └──────────────────────────────────────────┬───────────────────────────────────────────────────────┘
                                            │ Prisma (queries parametrizadas) + SQL crudo puntual
                                            ▼
                                   PostgreSQL 16 (+ btree_gist)
                                            ▲
                                            │ lee outbox
                             Worker de notificaciones (mismo proceso en v1, separable)
                                            │
                                            ▼
                               Canales: WhatsApp · (email · SMS · …)
```

## 2. Estructura del repositorio (propuesta)

```
/generador-pagina-contacto.html     (sin cambios hasta la Fase 13)
/docs/
/apps/api/                          Fastify + Prisma
  prisma/schema.prisma
  prisma/migrations/
  src/
    app.ts                          construye la instancia (testeable sin escuchar puerto)
    server.ts                       arranque
    config.ts                       env validado con Zod
    plugins/                        error-handler, auth/session, tenant-context, rate-limit, cors
    modules/<modulo>/
      routes.admin.ts | routes.public.ts
      service.ts                    lógica de aplicación (recibe TenantContext)
      repo.ts                       acceso a datos, siempre filtrado por tenantId
      schemas.ts                    Zod
    domain/availability/            motor puro: sin I/O, sin Prisma, 100% testeable
    lib/                            errores, contraseñas, tokens, validación, tiempo, teléfono, dinero
    cli/                            tareas del operador (tenant-create)
  test/                             unit + integración (BD real)
/apps/admin/                        React + Vite (SPA admin y profesional)
/packages/shared/                   tipos y esquemas Zod compartidos
docker-compose.yml                  postgres dev + test
```

## 3. Principios

1. **El tenant nunca viene del cliente.** Rutas admin: `TenantContext` sale de la sesión
   (`session.user.tenantId`). Rutas públicas: sale de `:tenantSlug` resuelto en BD a un tenant
   activo. Ningún esquema de entrada contiene `tenantId`.
2. **Capa de repositorio con scoping obligatorio.** Toda función de `repo.ts` recibe `tenantId` como
   primer argumento y lo incluye en el `where`. Prohibido `findUnique({ where: { id } })` sobre
   modelos de tenant; se usa `findFirst({ where: { id, tenantId } })` o la unique compuesta
   `tenantId_id`. Una regla de lint/test lo vigila.
3. **Integridad en BD, no solo en código.** FKs compuestas `(tenantId, id)` impiden que una cita
   referencie un profesional/servicio/cliente de otro tenant, aunque el código tenga un bug.
4. **Precio, duración, fin de la cita, estado inicial y profesional asignado se calculan en el
   servidor.** El cliente solo envía IDs, fecha/hora local y datos de contacto.
5. **Motor de disponibilidad puro.** `computeSlots(input) → slots` y `checkSlot(input) → ok | reason`
   operan sobre datos ya cargados; el adaptador carga horarios, bloqueos y citas. Así se testea
   exhaustivamente sin BD.
6. **Notificaciones desacopladas.** Crear una cita escribe una fila en `NotificationOutbox` dentro
   de la misma transacción. El worker la procesa con la implementación del canal. Si WhatsApp falla,
   la cita sigue existiendo.
7. **Errores uniformes** `{ error: { code, message, details? }, requestId }`; nunca stack traces ni
   mensajes de Prisma al cliente.

## 4. Flujo de creación de cita (público)

1. Resolver tenant por slug (activo) → 404 si no existe.
2. Validar cuerpo (Zod). Normalizar teléfono a E.164 con `Tenant.defaultCountryCode`.
3. Cargar servicio (activo, del tenant) → precio y duración **desde BD**.
4. Convertir `date` + `time` locales a instante UTC con `Tenant.timezone` (rechazar horas
   inexistentes por DST; horas ambiguas → primera ocurrencia).
5. Si `professionalId=any`: candidatos = profesionales activos que hacen el servicio.
6. **Transacción** (`READ COMMITTED` + exclusion constraint como garantía final):
   1. Para cada candidato (ordenado por menos citas activas ese día en esa franja, luego id):
      bloquear fila del profesional (`SELECT ... FOR UPDATE`), re-verificar con `checkSlot` usando
      datos leídos dentro de la transacción.
   2. Primer candidato válido → upsert `Customer` (tenant + teléfono), insert `Booking` con
      snapshot, insert `AuditLog`, insert `NotificationOutbox`.
   3. Si el insert choca con la exclusion constraint (`23P01`) → probar siguiente candidato o
      terminar con conflicto.
7. Conflicto → `409 SLOT_UNAVAILABLE` con `alternatives` reales calculadas por el motor. Nunca se
   mueve la cita automáticamente.
8. Idempotencia: cabecera `Idempotency-Key` guardada por tenant para reintentos de red.

## 5. Motor de disponibilidad

Entrada: tenant (tz, `slotIntervalMinutes`, `bookingLeadMinutes`, `bookingHorizonDays`), servicio
(duración, `bufferAfterMinutes` opcional), profesional(es), fecha local, working hours del día (y
del día anterior si hay intervalo contiguo hasta 24:00), time blocks, citas activas.

Algoritmo por profesional:
1. Intervalos laborales del día (en local) → convertir a UTC con la tz del tenant.
2. Restar time blocks y citas activas (`PENDING`, `CONFIRMED`) → intervalos libres.
3. Generar inicios cada `slotIntervalMinutes` alineados al inicio del intervalo laboral; aceptar
   el inicio solo si `[start, start + duración + buffer)` cabe **entero** en un intervalo libre.
4. Descartar inicios anteriores a `now + bookingLeadMinutes` o posteriores al horizonte.

`professionalId=any`: unión de los inicios de todos los candidatos; cada slot lleva la lista de
profesionales libres. La asignación final ocurre en la creación (paso 6), no en la consulta.

`checkSlot` valida en el orden exigido y devuelve el primer motivo de fallo:
`PROFESSIONAL_NOT_FOUND | PROFESSIONAL_INACTIVE | SERVICE_NOT_FOUND | PROFESSIONAL_DOES_NOT_OFFER_SERVICE |
NOT_WORKING_THAT_DAY | OUTSIDE_WORKING_HOURS | EXCEEDS_CLOSING_TIME | OVERLAPS_BOOKING | OVERLAPS_TIME_BLOCK | IN_THE_PAST`.

Alternativas: hasta N slots libres más cercanos a la hora pedida (antes y después) ese día; si no
hay, los primeros de los siguientes días hasta un límite.

## 5b. Concurrencia de la agenda

`lockProfessionals()` (`src/modules/schedule/locks.ts`) hace `SELECT … FOR UPDATE` sobre las filas de
los profesionales afectados, ordenadas por id. La usan: cambio de horario (1 profesional), bloqueo
(1 profesional, o todos los del negocio si es general) y, desde la Fase 8, la creación de citas.
Así una cita no puede colarse mientras se recorta un horario o se crea un bloqueo, y viceversa.
El exclusion constraint sigue siendo la garantía final entre citas.

Tiempo: `src/lib/time.ts` (Luxon). `workingRanges(intervalos, desde, hasta, tz)` convierte el horario
semanal en tramos reales (instantes UTC) uniendo los contiguos, también a través de medianoche; es la
base del motor de disponibilidad (Fase 7).

## 6. Multi-local

- Cada `WorkingHour` pertenece a un `Location`. Un profesional puede trabajar en varios locales en
  días/horas distintas; el servidor impide intervalos solapados del mismo profesional en locales
  distintos.
- La `Booking.locationId` se deriva del intervalo laboral que contiene la cita (no del cliente).
  Si el cliente pasa `locationId`, filtra; nunca decide.
- Zona horaria: `Tenant.timezone` (igual que el generador). `Location.timezone` no existe en v1.

## 7. Autenticación y roles

- Roles: `ADMIN`, `PROFESSIONAL` (enum ampliable: `RECEPTIONIST`, `OWNER`…). El operador de la
  plataforma no es un usuario de la API en v1: crea tenants y su primer ADMIN con un CLI que se
  ejecuta en el servidor (decisión §4.1 del plan).
- Un `User` pertenece a un único tenant (email único por tenant). Un usuario `PROFESSIONAL` se
  vincula 1:1 a un `Professional`.
- Autorización por política: `can(user, action, resource)`; `PROFESSIONAL` solo sus citas,
  sus bloqueos y su agenda.

## 8. Despliegue (Fase 16, resumen)

Una imagen Docker: `api` sirve `/api/*` y los estáticos de la SPA. `prisma migrate deploy` en el
arranque del release. PostgreSQL gestionado con backups. Config por variables de entorno.
Escalado horizontal requiere mover rate limit y (si aplica) worker a Redis/cola.
