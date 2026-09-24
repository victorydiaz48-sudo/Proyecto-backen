# Plan del backend — Plataforma de reservas multi-tenant (barberías)

Estado: **Fases 0–7 completadas.** Siguiente: Fase 8 (doble reserva: creación con `any`, pruebas de concurrencia).

Documentos relacionados:
[ARCHITECTURE](ARCHITECTURE.md) · [DATABASE](DATABASE.md) · [API](API.md) · [SECURITY](SECURITY.md) · [TESTING](TESTING.md) · [FRONTEND_INTEGRATION](FRONTEND_INTEGRATION.md)

---

## 1. Fase 0 — Auditoría del repositorio

### 1.1 Contenido del repo

| Archivo | Descripción |
|---|---|
| `README.md` | Una línea: "Primera version del generador". |
| `generador-pagina-contacto.html` | ~264 KB, ~3450 líneas. HTML + CSS + JS autocontenido, sin dependencias ni build. |

No hay `package.json`, backend, base de datos, tests, CI ni configuración de despliegue. Todo el
backend se construye desde cero, en carpetas nuevas, sin tocar el generador.

### 1.2 Cómo funciona el generador

- **Formulario → estado → `sanitize()` → `analyze()` → `buildPage()`**. `sanitize()` (línea ~459)
  limpia y acota cada campo (`MAX`, `clean()`), `analyze()` (~999) interpreta los textos libres y
  construye el modelo de la página, `buildPage()` (~2097) produce un único `.html` exportado.
- El JS de la página exportada es `cardRuntime` (~1194), escrito en **ES5 a propósito** y
  serializado con `toString()`. Recibe una configuración `C` embebida como JSON (`jsonScript`).
- Persistencia del generador: `localStorage` (borrador, idioma de UI) y export/import de un JSON
  `{"app":"gpc","v":4, ...campos}` (`doExport`/`doImport`, ~3310). **Ese JSON es un formato de
  intercambio útil para un futuro importador hacia el backend.**
- Multi-rubro: categorías (`CATS`, `CATP`) como `barber`, restaurantes (`food`, con carrito por
  WhatsApp), profesionales, etc. Para `barber` la acción principal por defecto es `book`.
- Idiomas de la página: `pt` (por defecto) y `es`. País por defecto `cc: '55'` (Brasil).
- Sin CSP, sin `fetch`, sin llamadas de red (salvo Google Fonts opcional). La página puede abrirse
  desde cualquier dominio o desde `file://`.

### 1.3 Flujo de reserva actual (WhatsApp)

1. Solo existe si la acción principal es `book` **y hay un único local** (`!m.locations`, ~2087) y
   hay WhatsApp y al menos un servicio.
2. `bookingDialog()` (~2029) pinta un `<dialog>` con: nombre, teléfono, servicio (`<select>` por
   **nombre**), profesional (opcional, "Sin preferencia" = valor vacío), fecha (`<input type=date>`),
   hora (`<input type=time>` **libre**), notas.
3. Validación solo en cliente: campos requeridos, teléfono ≥ 8 dígitos. La fecha mínima se calcula
   con el reloj **del dispositivo**, no con la zona del negocio.
4. Resumen → enlace `https://wa.me/<num>?text=...` con el texto de la cita.
5. **No se comprueba disponibilidad, horario laboral, duración, solapamientos ni nada.** El negocio
   confirma a mano por WhatsApp.

### 1.4 Servicios

- Texto libre, una línea por servicio: `Nombre | Precio | Descripción | ...`.
- Líneas `## Categoría` agrupan. Marcadores opcionales `destacado`, `tam:` (tamaños), `sab:`
  (opciones) — pensados para el carrito de comida.
- **Sin ID, sin duración.** El precio es texto (`"R$ 45"`), no número. Máx. 60 servicios.
- El nombre es la clave: fotos de productos (`menuPhotos`) y equipo se vinculan por nombre.

### 1.5 Equipo

- Texto libre: `Nombre | Cargo | Bio | servicio1, servicio2`. Máx. 10 personas.
- Servicios vinculados por **nombre en minúsculas**; lista vacía = atiende **todos** los servicios.
- Fotos (`teamPhotos`) vinculadas por nombre.
- En la reserva, al elegir servicio se filtran los profesionales que lo hacen.

### 1.6 Horarios, locales y zona horaria

- Local principal: `hd0..hd6` (índice = `getDay()`, 0 = domingo), **un intervalo por día**
  `"HH:MM-HH:MM"`. `"00:00-00:00"` = 24 h. Cierre ≤ apertura = **cruza medianoche** (lo soporta
  `isOpen`). Nota libre `horario`.
- Locales adicionales (máx. 7, total 8): `Nombre | Dirección | 7 horarios separados por coma | Maps | WhatsApp`.
- **Zona horaria única por negocio** (`tz`, validada con `Intl.DateTimeFormat`); todos los locales
  la comparten. Lista `TZS` con zonas de LatAm, España, Portugal, Nueva York.
- Los horarios son **del negocio/local**, no de cada profesional.

### 1.7 Qué se reutiliza y qué no se debe romper

**Reutilizable (conceptos/datos, no código):**
- El JSON de exportación v4 como fuente para un **importador** (tenant + local(es) + servicios +
  equipo + horarios) — ver [FRONTEND_INTEGRATION](FRONTEND_INTEGRATION.md) §6.
- La semántica de horarios (días 0–6, `HH:MM`, 24 h, cruce de medianoche) y de "sin preferencia".
- `cc` (código de país) → `Tenant.defaultCountryCode` para normalizar teléfonos a E.164.
- `tz` → `Tenant.timezone`.

**No se debe romper (restricciones para el backend y la Fase 13):**
- Las páginas ya generadas y publicadas **no tienen API URL ni slug**: deben seguir funcionando
  exactamente igual con WhatsApp. El backend no puede asumir que todas las páginas lo usan.
- El runtime es ES5 y sin dependencias → la API pública debe ser consumible con `fetch`/XHR simple,
  JSON plano, sin cookies, sin preflight complejo si se puede evitar (ver [SECURITY](SECURITY.md) §CORS).
- Las páginas pueden abrirse desde `file://` (Origin `null`) o cualquier dominio.
- No se modifica `generador-pagina-contacto.html` hasta la Fase 13.

### 1.8 Hallazgos que afectan al diseño

| Hallazgo | Consecuencia en el backend |
|---|---|
| Servicios sin ID ni duración | `Service.id` (UUID), `durationMinutes` obligatorio; el importador pedirá duración. |
| Precio como texto | `priceCents` entero + `Tenant.currency`; el importador intenta parsear y marca los dudosos. |
| Equipo vinculado por nombre | `ProfessionalService` con IDs; el nombre deja de ser clave. |
| Un intervalo por día, horario del negocio | `WorkingHour` por profesional, por local, varios intervalos/día. El importador copia el horario del local a cada profesional. |
| Horarios que cruzan medianoche | En v1 un `WorkingHour` no cruza medianoche: se guarda como dos intervalos (día N hasta 24:00 y día N+1 desde 00:00). El motor los une si son contiguos. |
| Reserva deshabilitada con varios locales | La API pública soporta `locationId` desde el inicio; la Fase 13 podrá habilitar la reserva multi-local. |
| Fecha mínima con reloj del dispositivo | El backend es la única autoridad sobre "hoy" y "ahora" en la zona del tenant. |
| Contenido del generador pensado también para restaurantes | El modelo es genérico (Service/Professional), pero v1 solo implementa reservas por cita. |

---

## 2. Decisiones aprobadas (resumen)

| # | Decisión |
|---|---|
| A | Node.js + TypeScript + Fastify + Prisma + PostgreSQL. Panel admin SPA React servido por el mismo servidor. Vitest. |
| B | El backend es la fuente de verdad. El generador ganará `apiUrl` + `tenantSlug`; sin ellos, sigue con WhatsApp. |
| C | Constraint de exclusión en PostgreSQL + transacción con verificación de disponibilidad. |
| D | `Location` desde el inicio; cada tenant arranca con un local por defecto. |
| E | `professionalId=any`: unión de huecos; asigna al profesional libre con menos citas en esa franja. |
| F | Estado inicial de la cita configurable por tenant; por defecto `CONFIRMED`. |

Nada en el repositorio contradice estas decisiones.

## 3. Decisiones de implementación tomadas (rutinarias)

- Validación con **Zod** (`fastify-type-provider-zod`), tipos compartidos backend/SPA. Ojo: en Zod 4 los
  `.refine()` de objeto se ejecutan aunque un campo haya fallado; deben comprobar los tipos antes de usarlos.
- Fechas/zonas con **Luxon** (IANA tz, DST correcto). Todo se guarda en UTC (`timestamptz`).
- Teléfonos con **libphonenumber-js** → E.164.
- Hash de contraseñas con **Argon2id** (`@node-rs/argon2`, binarios precompilados).
- Sesiones del panel: cookie `httpOnly` + tabla `Session` en BD (revocables). Sin JWT en v1.
- Rate limiting con `@fastify/rate-limit` (memoria en v1; Redis cuando haya >1 instancia).
- IDs UUID. Dinero en céntimos (`Int`).
- Prisma 7.10 (estable; la etiqueta `latest` de npm apunta a una 8.0 RC que no se usa) y TypeScript 6.0
  (typescript-eslint aún no soporta TS 7). Se ejecuta TypeScript directamente con `tsx` en desarrollo;
  la estrategia de build de producción se fija en la Fase 16.
- Monorepo con npm workspaces (`apps/api`, `apps/admin`, `packages/shared`); SPA con Vite.
- Notificaciones vía tabla **outbox** (se escribe en la misma transacción que la cita; un worker envía).

## 4. Decisiones adicionales (aprobadas antes de la Fase 2)

Las tres propuestas se aceptaron tal cual:

1. **Alta de tenants**: ¿registro self-service público o alta por el operador de la plataforma?
   **Aprobado:** v1 por CLI del operador; self-service más adelante.
2. **Aislamiento en BD**: ¿solo capa de aplicación + claves foráneas compuestas `(tenantId, id)`,
   o además **Row-Level Security** de PostgreSQL? **Aprobado:** FKs compuestas + scoping obligatorio
   ahora; RLS como defensa en profundidad en la Fase 15. Ver [SECURITY](SECURITY.md) §2.
3. **Gestión de la cita por el cliente** (cancelar/reprogramar desde un enlace con token): ¿v1 o
   posterior? **Aprobado:** `Booking.manageTokenHash` ya está en el modelo; endpoints en fase posterior.

---

## 5. Fases

Cada fase termina con: tests + `tsc --noEmit` + lint verdes, docs actualizados, y comprobación de
que el generador (que no se toca) sigue igual.

| Fase | Entregable | Criterio de salida |
|---|---|---|
| 0 | Auditoría | Este documento §1. ✅ |
| 1 | Arquitectura y docs | `/docs/*.md`. ✅ |
| 2 | PostgreSQL + Prisma + migraciones | `schema.prisma`, migración inicial con `btree_gist` + exclusion constraint en SQL, docker-compose para dev/test, script de seed. ✅ |
| 3 | Tenants + auth + roles | Login/logout, sesiones, `requireRole`, resolución de tenant, tests de aislamiento base. ✅ |
| 4 | Profesionales + servicios | CRUD admin, `ProfessionalService`, tests cruzados de tenant. ✅ |
| 5 | Horarios + bloqueos | `WorkingHour` (varios intervalos, validación de solapes), `TimeBlock`. Incluye CRUD de locales. ✅ |
| 6 | Clientes + reservas | `Customer` E.164 único por tenant, `Booking` con snapshot de precio/duración, máquina de estados. Incluye `checkSlot` (validación pura de una franja) y la creación transaccional con bloqueo. ✅ |
| 7 | Motor de disponibilidad | Módulo puro (sin BD) + adaptador; tests de cierre, solapes, TZ/DST. `GET /admin/availability` y alternativas en los errores de reserva. ✅ |
| 8 | Doble reserva | Exclusion constraint + transacción; test concurrente con N peticiones simultáneas. |
| 9 | API pública | 5 endpoints, CORS `*` sin credenciales, rate limit, idempotencia. |
| 10 | API admin + panel React | CRUD completo, agenda, auditoría. |
| 11 | Panel de profesional | Agenda propia, cambiar estado de sus citas, bloqueos propios. |
| 12 | Notificaciones | Interfaz `NotificationChannel`, outbox + worker, WhatsApp como implementación. |
| 13 | Integración con el generador | Campos `apiUrl`/`tenantSlug`, selector de horas reales, fallback a WhatsApp, importador del JSON v4. |
| 14 | Testing completo | Cobertura de la matriz de [TESTING](TESTING.md). |
| 15 | Auditoría de seguridad | Checklist de [SECURITY](SECURITY.md), RLS si se aprueba. |
| 16 | Despliegue | Dockerfile, `prisma migrate deploy`, health checks, backups, guía. |
