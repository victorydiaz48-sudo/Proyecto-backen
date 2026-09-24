# Seguridad

## 1. Modelo de amenazas (resumen)

| Actor | Riesgo principal |
|---|---|
| Visitante anónimo de una página generada | spam de reservas, enumeración de datos, bloqueo de agenda, inyección |
| Admin de la barbería A | leer/modificar datos de la barbería B |
| Profesional | ver/modificar citas de otros profesionales o configuración del negocio |
| Atacante externo | robo de sesión, fuerza bruta de contraseñas, CSRF sobre el panel |

## 2. Aislamiento multi-tenant

1. **Origen del tenant**: sesión (admin) o slug de la URL (público). Nunca del body, query ni cabeceras.
   Los esquemas Zod son `.strict()`: un `tenantId` en el body es un 400.
2. **Scoping obligatorio** en repositorios (`tenantId` como primer parámetro, siempre en el `where`).
3. **FKs compuestas `(tenantId, id)`**: la BD rechaza una cita que mezcle profesional/servicio/cliente
   de otro tenant aunque el código falle.
4. **404, no 403**, para recursos de otro tenant: no se revela su existencia.
5. **Tests de acceso cruzado** por cada endpoint admin con `:id` y cada endpoint público (ver [TESTING](TESTING.md)).
6. **Defensa en profundidad (pendiente de aprobación)**: Row-Level Security con
   `SET LOCAL app.tenant_id` por transacción y un rol de BD sin `BYPASSRLS` para la app.
   Trade-off: protege ante bugs de scoping, pero exige que *toda* consulta vaya dentro de una
   transacción con el tenant fijado (Prisma lo complica con el pool) y añade coste a los tests.

## 3. Autenticación (implementado en la Fase 3)

- Contraseñas: Argon2id (`@node-rs/argon2`, m=19 MiB, t=2, p=1, parámetros OWASP), longitud 10–128,
  rechazo de contraseñas comunes/repetitivas y de las que contienen el email (`src/lib/password.ts`).
- Login (`src/modules/auth/service.ts`): mensaje genérico `INVALID_CREDENTIALS`; si el usuario no
  existe se verifica contra un hash ficticio para igualar el tiempo; `FailureLimiter` bloquea 15 min
  tras 5 fallos por negocio+email; `@fastify/rate-limit` limita a 20 intentos/15 min por IP.
  Los fallos se auditan (sin la contraseña).
- Sesión (`src/plugins/auth.ts`): token aleatorio de 32 bytes en cookie `sid`
  `HttpOnly; SameSite=Strict; Path=/` y `Secure` (obligatorio en producción: `COOKIE_SECURE` no puede
  desactivarse con `NODE_ENV=production`). En BD solo su SHA-256. Caducidad deslizante de 7 días y
  absoluta de 30. Usuario desactivado o tenant suspendido → la sesión deja de valer al instante.
  Logout borra la sesión; el cambio de contraseña cierra las demás.

## 4. Autorización

- `requireAuth` + `requireRole(...)` en cada ruta admin, declarados en la definición de la ruta.
- Políticas por recurso para `PROFESSIONAL` (solo `professionalId === session.professionalId`).
- El rol y el `professionalId` salen de la BD vía sesión, nunca del cliente.
- Siempre queda al menos un ADMIN activo (Fase 10): degradar o desactivar al último → `409`; los
  cambios de usuarios se serializan con `SELECT … FOR UPDATE` sobre el tenant. Cambiar de rol o
  desactivar corta sus sesiones al instante. Las contraseñas temporales se muestran una sola vez y no
  se auditan.

## 5. Validación y datos confiables

- Zod en toda entrada (body, query, params), límites de longitud alineados con el generador
  (nombre 80, notas 300, teléfono 40).
- Precio, duración, `endAt`, estado inicial, profesional asignado, local y tenant: **siempre del servidor**.
- Teléfono normalizado a E.164 con `libphonenumber-js` y el país por defecto del tenant.
- Fechas: la hora local se interpreta con la tz del tenant; se rechazan horas inexistentes (DST).

## 6. CORS y CSRF

- **Rutas `/api/v1/public/*`** (implementado en la Fase 9, `@fastify/cors` solo en ese ámbito):
  `Access-Control-Allow-Origin: *`, sin `Allow-Credentials`, métodos `GET, POST, OPTIONS`, cabeceras
  `Content-Type, Idempotency-Key`. La guarda CSRF del panel se registra solo en el ámbito `/auth` y
  `/admin`, nunca en `/public` (un test lo comprueba). Funciona desde cualquier dominio
  y desde `file://` (Origin `null`). Como no hay cookies ni credenciales en estas rutas, `*` no
  expone datos de sesión. Las respuestas públicas nunca incluyen datos personales de otros clientes.
- **Rutas admin/auth**: sin cabeceras CORS (solo mismo origen). Cookie `SameSite=Strict` +
  `sameOriginGuard` (rechaza con `403 CSRF_REJECTED` si `Sec-Fetch-Site` no es `same-origin`/`none`
  u `Origin` no coincide con el host) + solo `application/json` (el parser `text/plain` de Fastify
  está desactivado, así un formulario o `fetch` "simple" de otro sitio recibe `415`).

## 7. Abuso de la API pública

- Rate limit por IP (Fase 9): lecturas 120/min, disponibilidad 60/min, creación de citas 10/min
  (`@fastify/rate-limit`, en memoria; con varias instancias hay que moverlo a Redis).
- Máximo 3 citas futuras activas por teléfono y negocio → `429 BOOKING_LIMIT_REACHED`
  (constante `MAX_ACTIVE_BOOKINGS_PER_PHONE`; hacerlo configurable por negocio es trabajo futuro).
- `Idempotency-Key` para reintentos (reserva atómica de la clave con `INSERT … ON CONFLICT`).
- El tenant de la API pública sale solo del slug de la URL; los ids de otro negocio producen el mismo
  error que un id inexistente.
- Tamaño máximo del body 16 KB.
- (Futuro) CAPTCHA opcional por tenant si hay spam; estado `PENDING` como mitigación.

## 7b. Página generada conectada (Fase 13)

- La página solo envía IDs, fecha/hora local y datos de contacto; precio, duración, estado y profesional
  asignado los decide el servidor. `Idempotency-Key` aleatoria por confirmación.
- La URL de la API se valida en el generador (https; http solo `localhost`) y todo lo que se muestra
  (nombres, horas, mensajes del servidor) se inserta con `textContent`, nunca como HTML.
- "Probar conexión" solo hace `GET` públicos.

## 8. Otros controles

- SQL injection: solo Prisma con parámetros; el SQL crudo (`$queryRaw` con template tags) nunca
  concatena strings.
- Errores: handler global; en producción solo `code`, `message` genérico y `requestId`. Logs
  estructurados (pino) con redacción de `password`, `cookie`, `authorization`, teléfonos parcialmente.
- Cabeceras: `@fastify/helmet` global (CSP, HSTS, nosniff…). El panel (Fase 10) funciona con la CSP por
  defecto (`script-src 'self'`, sin scripts en línea); un test lo comprueba.
- Secretos por variables de entorno (`DATABASE_URL`, `SESSION_SECRET`, credenciales de WhatsApp),
  validados al arrancar; `.env` en `.gitignore`, `.env.example` sin valores reales.
- Audit log de: login (éxito/fallo), cambios de usuarios/roles, servicios, precios, horarios,
  bloqueos, creación y cambios de estado de citas.
- Dependencias: `npm audit` en CI, lockfile commiteado.
- Datos personales (teléfono, nombre): mínimos necesarios; política de retención a definir. El outbox
  guarda teléfono y texto del aviso (necesarios para enviarlo); el log del worker solo registra el
  teléfono enmascarado y la longitud del texto. Solo un ADMIN ve los avisos de su negocio.

## 9. Checklist para la Fase 15

- [ ] Test de acceso cruzado para cada ruta.
- [ ] Ningún esquema de entrada acepta `tenantId`, `price*`, `duration*`, `role`, `status` donde no corresponda.
- [ ] Exclusion constraint presente tras `migrate deploy`.
- [ ] Rate limits activos en producción.
- [x] Cookies `Secure` en producción (el arranque falla si se intenta desactivar); HTTPS obligatorio en el despliegue.
- [ ] Errores 500 sin detalles internos.
- [ ] `npm audit` sin vulnerabilidades altas.
- [ ] Revisión de RLS (si se aprueba).
