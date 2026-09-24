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
6. **Row-Level Security (Fase 15)**: la BD aísla los negocios aunque una consulta olvide filtrar por
   `tenantId`. Detalle en §2b.

## 2b. Row-Level Security

**Roles.** La app se conecta con `reservas_app`: sin `BYPASSRLS`, sin ser propietario de las tablas y
solo con `SELECT/INSERT/UPDATE/DELETE` (sin acceso a `_prisma_migrations` ni DDL). Las migraciones las
aplica el propietario (`MIGRATION_DATABASE_URL`), que no está sujeto a RLS (no se usa `FORCE`). En
producción el servidor **se niega a arrancar** si `DATABASE_URL` es superusuario, tiene `BYPASSRLS` o es
propietario de las tablas (`rlsBypassReason`, `src/server.ts`).

**Políticas** (migración `…_row_level_security`):
- Las 12 tablas con `tenantId`: solo filas con `tenantId = app_current_tenant()`, al leer y al escribir
  (`USING` + `WITH CHECK`: no se puede crear ni mover una fila a otro negocio).
- `Session`: solo las de usuarios visibles (los del negocio fijado).
- `Tenant`: legible sin negocio (la API pública y el login lo buscan por slug; sin datos personales);
  solo se modifica o borra el propio negocio.
- **Sin negocio fijado no se ve ni se escribe nada** (fallo cerrado).

**Cómo se fija el negocio** (`src/lib/tenant-context.ts`, `src/db.ts`). Un `AsyncLocalStorage` guarda el
negocio de la petición: lo fija la sesión (auth), el slug (API pública) o el código de sistema
(`withTenant` en CLI, importador, seed y worker), nunca datos del cliente. La extensión de Prisma lo lee
**en el momento de cada llamada** y ejecuta la consulta como `BEGIN; set_config('app.tenant_id', …, true);
consulta; COMMIT` (el valor muere con la transacción: no puede quedarse en una conexión del pool). En
`$transaction(async (tx) => …)`, `set_config` es la primera sentencia. Las transacciones por lotes
(`$transaction([...])`) se rechazan porque no fijarían el negocio.

Se descartó fijarlo en la conexión del pool: un experimento mostró que Prisma no conserva el contexto
asíncrono hasta el pool y que agrupa `findUnique` de peticiones distintas en una sola consulta; un
test de concurrencia (40 consultas simultáneas de A y B) cubre ese caso.

**Excepciones que cruzan negocios**, como funciones `SECURITY DEFINER` acotadas (solo `reservas_app`
puede ejecutarlas):
- `app_session_tenant(token_hash)`: devuelve solo el negocio de una cookie de sesión (hay que tener el
  token) para poder fijarlo antes de leer la sesión.
- `app_claim_due_notifications(now, lease, limit)`: el worker reclama avisos vencidos de todos los
  negocios (`FOR UPDATE SKIP LOCKED`); cada aviso se procesa después con su negocio fijado.

**Coste.** Cada consulta fuera de una transacción añade tres idas y vueltas (`BEGIN`, `set_config`,
`COMMIT`): medido en local, 0,7 → 1,7 ms por consulta. Con la BD en la misma región son unos pocos ms por
consulta. Si algún día importara, se puede agrupar cada petición en una sola transacción.

**Qué protege y qué no.** Protege contra errores de programación (una consulta sin filtro, un id de otro
negocio). No protege si alguien ejecuta SQL arbitrario con el rol de la app (podría fijar otro
`app.tenant_id`), algo que el uso exclusivo de consultas parametrizadas ya impide.

**Pruebas.** `test/rls.test.ts`, con el rol real:
- sin negocio no se ve ninguna fila de ninguna tabla;
- con A, una consulta sin filtro solo ve A;
- no se leen, modifican ni crean filas de B;
- dentro de transacciones y en SQL crudo también se aplica;
- concurrencia sin mezclas;
- las funciones acotadas;
- el rol no puede desactivar RLS ni leer el historial de migraciones.

Toda la suite de la API se ejecuta con la app conectada como `reservas_app`. **Mutación comprobada**: al
quitar el filtro `tenantId` del listado de clientes, fallan 3 tests con la app como propietario y ninguno
con RLS.

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

- `requireAuth` + `requireRole(...)` en cada ruta admin, declarados en la definición de la ruta, en el
  hook `onRequest` (antes de validar el cuerpo): sin sesión o sin permiso siempre 401/403, nunca un 400
  que revele el esquema. `route-matrix.test.ts` lo comprueba en todas las rutas.
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
  concatena strings; ESLint prohíbe `$queryRawUnsafe`/`$executeRawUnsafe`.
- Errores: handler global igual en todos los entornos: solo `code`, `message` genérico y `requestId`;
  el detalle va únicamente al log.
- Logs (pino): la línea de cada petición registra método, URL, host e IP, **nunca cabeceras ni cuerpos**
  (así no aparecen contraseñas, cookies, teléfonos ni nombres). El parámetro `search` de
  `/admin/customers` se registra como `[REDACTED]` (`src/lib/log.ts`). Además se redactan
  `cookie`/`authorization`/`set-cookie` por si algún log incluye cabeceras. El worker de avisos solo
  registra el teléfono enmascarado. Los errores 500 sí se registran completos (pueden incluir valores de
  la consulta): los logs de producción deben tratarse como datos personales.
- Cabeceras: `@fastify/helmet` global (CSP `default-src 'self'`, HSTS, nosniff, `X-Frame-Options`,
  sin `X-Powered-By`). El panel funciona con la CSP por defecto (sin scripts en línea).
- Secretos: no hay secretos de aplicación (las sesiones son tokens aleatorios guardados como hash, no
  firmados). Los únicos secretos son `DATABASE_URL` y, en el futuro, las credenciales del proveedor de
  WhatsApp; se leen del entorno y se validan al arrancar sin imprimir su valor. `.env` en `.gitignore`;
  solo se versiona `.env.example` con valores de desarrollo.
- Seed de desarrollo (usuarios con contraseña conocida): se niega con `NODE_ENV=production` **y** si la
  BD contiene algún negocio que no sea de los del seed.
- Audit log de: login (éxito/fallo), cambios de usuarios/roles, servicios, precios, horarios,
  bloqueos, creación y cambios de estado de citas.
- Dependencias: lockfile versionado y `npm audit --audit-level=high` en CI. `overrides` en el
  `package.json` raíz fuerzan `mysql2` ≥ 3.24.4 y `deepmerge-ts` ≥ 8.0.2 (dependencias del CLI de
  Prisma con avisos altos; no se usan en tiempo de ejecución). Revisar y quitar los `overrides` cuando
  Prisma actualice sus dependencias.
- Datos personales (teléfono, nombre): mínimos necesarios; política de retención a definir. El outbox
  guarda teléfono y texto del aviso (necesarios para enviarlo). Solo un ADMIN ve los avisos de su negocio.

## 9. Despliegue: requisitos de seguridad

- HTTPS obligatorio (la cookie es `Secure`; HSTS activo).
- `TRUST_PROXY`: `true` **solo** si hay un proxy/balanceador delante que sobrescribe
  `X-Forwarded-For`. Con `false` detrás de un proxy, todos los clientes comparten la IP del proxy y el
  rate limit los bloquearía a todos juntos; con `true` sin proxy, cualquiera podría falsear su IP y
  saltarse el límite. Un test comprueba que, sin `TRUST_PROXY`, la cabecera se ignora.
- Rate limit en memoria: con varias instancias, cada una cuenta por separado (mover a Redis).
- Dos usuarios de BD: el propietario del esquema para las migraciones (`MIGRATION_DATABASE_URL`) y
  `reservas_app` para la app (`DATABASE_URL`). La migración de RLS crea `reservas_app` sin login si el
  usuario de migraciones puede crear roles; si no (habitual en PostgreSQL gestionado), hay que crearlo
  antes, una vez, como administrador: `CREATE ROLE reservas_app LOGIN PASSWORD '…';`. Si la migración
  lo creó, activar el login con `ALTER ROLE reservas_app LOGIN PASSWORD '…';`.

## 10. Auditoría de la Fase 15

Hallazgos y correcciones:

| Hallazgo | Riesgo | Corrección |
|---|---|---|
| `GET /admin/customers?search=…` dejaba nombres/teléfonos buscados en el log de peticiones | datos personales en logs | serializador de peticiones con `search` redactado; test con los logs reales (y mutación: sin el serializador falla) |
| El seed de desarrollo solo se protegía por `NODE_ENV`: ejecutado contra la BD real sin esa variable, crearía ADMIN con contraseña conocida | toma de control de un negocio | segunda barrera por contenido de la BD; test de proceso real |
| 4 avisos altos de `npm audit` (mysql2, deepmerge-ts vía el CLI de Prisma) | bajo (solo CLI, configuración estática) | `overrides`; comprobado validate/generate/drift/migraciones desde cero |
| `npm audit` figuraba en esta documentación pero no se ejecutaba en CI | regresiones silenciosas | paso en CI |
| La documentación citaba un `SESSION_SECRET` inexistente | confusión en el despliegue | corregido |
| El test "dos ADMIN que se degradan a la vez" no forzaba la carrera: seguía pasando al quitar el bloqueo del servicio | una regresión en el invariante "siempre queda un ADMIN" pasaría desapercibida | el test bloquea las filas desde otra conexión para que ambas peticiones coincidan; sin el bloqueo falla siempre, con él pasa siempre |
| Aislamiento solo en el código de la aplicación | un olvido de `tenantId` en una consulta filtraría datos de otro negocio | Row-Level Security (§2b) |

Revisado sin hallazgos: esquemas de entrada de todas las rutas (test automático con lista justificada),
autorización en `onRequest` en todas las rutas, errores 500, cabeceras, cookies, rate limits y CORS con
`NODE_ENV=production`, idempotencia (la respuesta repetida exige el mismo cuerpo, así que no sirve para
leer citas ajenas), inserción de HTML (el panel no usa `dangerouslySetInnerHTML`; la página generada usa
`textContent`), SQL crudo y secretos en el repositorio.

Checklist:

- [x] Test de acceso cruzado para cada ruta (`route-matrix.test.ts`, lista tomada de la app).
- [x] Ningún esquema de entrada acepta `tenantId`; los campos sensibles están justificados (`input-fields.test.ts`).
- [x] Exclusion constraint presente tras `migrate deploy` (`db-constraints.test.ts`, sobre una BD migrada desde cero).
- [x] Rate limits activos en producción (`production.test.ts`).
- [x] Cookies `Secure` en producción (el arranque falla si se intenta desactivar); HTTPS obligatorio en el despliegue.
- [x] Errores 500 sin detalles internos (también con `NODE_ENV=production`).
- [x] `npm audit` sin vulnerabilidades altas (y en CI).
- [x] Row-Level Security en todas las tablas de negocio, con la app sin privilegios para saltárselo (§2b).
