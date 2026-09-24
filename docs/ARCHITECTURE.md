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
/apps/admin/                        React 19 + Vite (SPA admin y profesional)
  src/api.ts                        cliente fetch (mismo origen, errores → ApiError, 401 → login)
  src/i18n.tsx                      pt / es (por defecto el idioma del negocio; elegible y recordado)
  src/format.ts                     moneda, fechas en la zona del NEGOCIO, fecha+hora local → ISO con desfase
  src/router.tsx                    router mínimo (history API)
  src/pages/*                       Agenda, Bloqueos, Mi horario, Clientes, Servicios, Profesionales
                                    (+ editor de horario), Locales, Usuarios, Ajustes, Auditoría, Mi cuenta
  test/                             Vitest + jsdom + Testing Library
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
5. Si `professionalId=any`: candidatos = profesionales activos que hacen el servicio (activo),
   ordenados por menos citas activas **ese día local**, luego `sortOrder`, luego id (`rankCandidates`).
6. **Una transacción por intento** (`READ COMMITTED` + exclusion constraint como garantía final),
   implementado en la Fase 8 (`BookingsService.create` / `createFor`):
   1. Bloquear la fila del profesional (`SELECT … FOR UPDATE`) y re-verificar con `checkSlot` usando
      datos leídos dentro de la transacción.
   2. Válido → cliente con `INSERT … ON CONFLICT DO NOTHING` (tenant + teléfono), insert `Booking` con
      snapshot, insert `AuditLog` (y desde la Fase 12, `NotificationOutbox`), commit.
   3. Si la franja ya no es válida o el insert choca con el constraint (`23P01`), la transacción se
      deshace y, con `any`, se prueba el siguiente candidato en una transacción nueva.
   4. Se agotan todos: si alguno estaba ocupado → `409 SLOT_UNAVAILABLE` (`OVERLAPS_BOOKING`); si
      ninguno podía por reglas → `422 SLOT_INVALID` con el primer motivo. Es la misma respuesta que con
      un profesional concreto, con `alternatives` calculadas para `any`.
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

`checkSlot` (`src/domain/availability/check.ts`, implementado en la Fase 6) valida en el orden exigido
y devuelve el primer motivo de fallo:
`PROFESSIONAL_NOT_FOUND | PROFESSIONAL_INACTIVE | SERVICE_NOT_FOUND | PROFESSIONAL_DOES_NOT_OFFER_SERVICE |
NOT_WORKING_THAT_DAY | OUTSIDE_WORKING_HOURS | EXCEEDS_CLOSING_TIME | OVERLAPS_BOOKING | OVERLAPS_TIME_BLOCK |
IN_THE_PAST | TOO_SOON | BEYOND_HORIZON`. La zona del tenant se aplica al convertir fecha/hora local
(`localSlotToInstant`) y al calcular los tramos de trabajo.

El adaptador `evaluateSlot` (`src/modules/bookings/slots.ts`) carga, dentro de la transacción y con el
profesional bloqueado, su horario, los bloqueos y las citas activas de una ventana de ±1–2 días y llama
a `checkSlot`. Lo usan crear, reprogramar y reactivar citas. Ya en la Fase 6 la creación sigue el flujo
del §4: bloqueo del profesional → `checkSlot` → alta del cliente con `INSERT … ON CONFLICT DO NOTHING`
(no aborta la transacción) → insert de la cita; un `23P01` residual se traduce a `409`.

Alternativas: hasta 6 huecos libres más cercanos a la hora pedida (antes y después) ese día; si no
hay suficientes, los primeros de los 7 días siguientes (`findAlternatives`).

**Implementación (Fase 7)** — `src/domain/availability/slots.ts` (puro) y
`src/modules/availability/service.ts` (carga desde la BD, siempre por tenant):
- `computeSlots`: por candidato, tramos de trabajo reales (`workingRanges`, uniendo contiguos y la
  medianoche) → inicios cada `slotIntervalMinutes` **alineados al comienzo del tramo** → se descarta el
  inicio si `[inicio, inicio + duración + limpieza)` no cabe en el tramo, pisa una cita activa o un
  bloqueo aplicable (del profesional, del local o general), es anterior a `ahora + antelación` o pasa
  del horizonte. Huecos de varios candidatos a la misma hora y local se unen con `professionalIds`.
- Un test de coherencia recorre un día entero y comprueba que `computeSlots` y `checkSlot` coinciden:
  todo hueco ofrecido es reservable y todo inicio alineado reservable se ofrece.
- "Sin preferencia" (`rankProfessionals` / `pickProfessional`): entre los libres, el que tiene menos
  citas activas **ese día local** (la "franja" del requisito E); desempate por `sortOrder` y luego id.
  La asignación ocurre al crear la cita (Fase 8), no al consultar.

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

## 7b. Panel (Fase 10)

- La API sirve `apps/admin/dist` con `@fastify/static` (o `ADMIN_DIST_DIR`) en `/`: assets con hash →
  `Cache-Control: immutable`; `index.html` → `no-cache`. Cualquier `GET` de navegador fuera de `/api`
  que no sea un archivo devuelve `index.html` (rutas de la SPA); `/api/*` inexistente sigue siendo 404
  JSON. Si el build no existe, la API funciona igual sin panel.
- Mismo origen: la cookie `SameSite=Strict` funciona sin CORS; CSP de helmet (`script-src 'self'`).
- En desarrollo, Vite (puerto 5173) reenvía `/api` a la API.
- El panel nunca decide nada que decida el servidor: la agenda solo ofrece horas devueltas por
  `/admin/availability`; si la reserva falla, muestra el motivo y las alternativas del servidor.
- Navegación por rol: ADMIN ve todo; PROFESSIONAL ve Agenda (solo su columna), Bloqueos, Mi horario
  (lectura), Clientes (los suyos) y Mi cuenta. La API aplica igualmente todos los permisos.
- Idioma: portugués y español como el generador; por defecto el `locale` del negocio.

**Panel del profesional (Fase 11)** — pensado para el móvil:
- Agenda con dos vistas: **Día** (su columna, con resumen "N citas · total" sin contar canceladas) y
  **Próximos 7 días** (agrupada por fecha, sin canceladas; tocar la fecha abre ese día).
- Acciones sobre sus citas: confirmar, completar / no vino (solo tras el inicio), cancelar con motivo,
  mover. Reactivar una cancelada es solo de ADMIN.
- Nueva cita: solo en su agenda y solo con los servicios que él hace; horas reales del servidor.
- Bloqueos: crea y borra los suyos (sin elegir profesional ni local); ve también los generales.
- Mi horario: lectura (lo cambia el ADMIN). Clientes: los que tienen cita con él (lectura).
- Usuario PROFESSIONAL sin ficha vinculada: aviso claro en vez de pantallas vacías.
- En pantallas estrechas la navegación es una barra fija, compacta y desplazable.

## 7c. Notificaciones (Fase 12)

Decisión (aprobada): **opción C** — sin proveedor de WhatsApp por ahora; avisos **al cliente y al negocio**.

```
cambio de cita ──(misma transacción)──► NotificationOutbox (PENDING, nextAttemptAt)
                                             │
                  worker (cada 15 s) ────────┘  reclama con FOR UPDATE SKIP LOCKED + alquiler de 5 min
                        │
                        ▼
              NotificationTransport.send()   ── hoy: LogTransport (registra, no envía)
                        │                       futuro: WhatsApp Business Cloud API u otro
              SENT │ reintento (1, 5, 15, 60 min) │ FAILED tras 5 intentos
```

- `enqueueBookingNotifications` (`src/modules/notifications/outbox.ts`) se llama dentro de la transacción
  de la cita: si la cita no se guarda, no hay avisos; si se guarda, los avisos no se pierden aunque el
  envío falle. La lógica de reservas no conoce el transporte.
- Cliente: `booking_created` (o `booking_received` si queda `PENDING`), `booking_confirmed`,
  `booking_rescheduled`, `booking_cancelled` y `booking_reminder` 24 h antes (solo citas confirmadas y si
  faltan más de 24 h). Negocio: `business.booking_created` para cada cita que llega desde la web, al
  WhatsApp del local de la cita o, si no tiene, del local por defecto; sin WhatsApp no se encola.
- Mover o cancelar una cita marca `CANCELLED` todos sus avisos aún pendientes (p. ej. el recordatorio) y
  encola los nuevos. Los textos se generan al encolar, en pt/es según el `locale` del negocio.
- Entrega "al menos una vez"; dos workers nunca envían el mismo aviso (test).
- Con el transporte `log`, el panel (Avisos) muestra cada mensaje con su enlace `wa.me` para enviarlo a
  mano. Configuración: `NOTIFICATIONS_TRANSPORT=log`, `NOTIFICATIONS_WORKER=true|false` (desactivar en
  réplicas adicionales o si el worker corre en otro proceso).
- Para conectar un proveedor real: implementar `NotificationTransport` y añadirlo a
  `NOTIFICATIONS_TRANSPORT`. Nada más cambia.

## 8. Despliegue (Fase 16, resumen)

Dos imágenes desde el mismo `Dockerfile`: `runtime` (JavaScript compilado, panel, solo dependencias de
producción, usuario sin privilegios, `HEALTHCHECK`) y `migrate` (`prisma migrate deploy` con el
propietario del esquema, antes de cada versión). PostgreSQL 16 gestionado con PITR. Configuración por
variables de entorno. Escalar a varias instancias requiere mover el rate limit a Redis. Detalle en
[DEPLOYMENT](DEPLOYMENT.md).
