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

## 3. Autenticación

- Contraseñas: Argon2id (m=19 MiB, t=2, p=1 como mínimo, parámetros OWASP), longitud 10–128,
  comprobación contra lista de contraseñas comunes.
- Login: mensaje genérico, tiempo constante (se hashea contra un hash ficticio si el usuario no
  existe), rate limit por IP y por `tenantSlug+email`, bloqueo progresivo.
- Sesión: token aleatorio de 32 bytes en cookie `sid` `HttpOnly; Secure; SameSite=Strict; Path=/`;
  en BD solo su SHA-256. Expiración deslizante (7 días) y absoluta (30 días). Rotación al hacer login.
  Logout y cambio de contraseña revocan sesiones.

## 4. Autorización

- `requireAuth` + `requireRole(...)` en cada ruta admin, declarados en la definición de la ruta.
- Políticas por recurso para `PROFESSIONAL` (solo `professionalId === session.professionalId`).
- El rol y el `professionalId` salen de la BD vía sesión, nunca del cliente.
- Un ADMIN no puede quitarse a sí mismo el último rol ADMIN del tenant.

## 5. Validación y datos confiables

- Zod en toda entrada (body, query, params), límites de longitud alineados con el generador
  (nombre 80, notas 300, teléfono 40).
- Precio, duración, `endAt`, estado inicial, profesional asignado, local y tenant: **siempre del servidor**.
- Teléfono normalizado a E.164 con `libphonenumber-js` y el país por defecto del tenant.
- Fechas: la hora local se interpreta con la tz del tenant; se rechazan horas inexistentes (DST).

## 6. CORS y CSRF

- **Rutas `/api/v1/public/*`**: `Access-Control-Allow-Origin: *`, sin `Allow-Credentials`, métodos
  `GET, POST, OPTIONS`, cabeceras `Content-Type, Idempotency-Key`. Funciona desde cualquier dominio
  y desde `file://` (Origin `null`). Como no hay cookies ni credenciales en estas rutas, `*` no
  expone datos de sesión. Las respuestas públicas nunca incluyen datos personales de otros clientes.
- **Rutas admin/auth**: sin cabeceras CORS (solo mismo origen). Cookie `SameSite=Strict` +
  verificación de `Origin`/`Sec-Fetch-Site` en métodos que modifican estado + exigir
  `Content-Type: application/json`.

## 7. Abuso de la API pública

- Rate limit: disponibilidad ~60 req/min/IP; creación de citas ~5/min/IP y ~30/h por teléfono por tenant.
- Límite de citas futuras activas por teléfono por tenant (configurable, def. 3).
- `Idempotency-Key` para reintentos.
- Tamaño máximo del body 16 KB.
- (Futuro) CAPTCHA opcional por tenant si hay spam; estado `PENDING` como mitigación.

## 8. Otros controles

- SQL injection: solo Prisma con parámetros; el SQL crudo (`$queryRaw` con template tags) nunca
  concatena strings.
- Errores: handler global; en producción solo `code`, `message` genérico y `requestId`. Logs
  estructurados (pino) con redacción de `password`, `cookie`, `authorization`, teléfonos parcialmente.
- Cabeceras: `@fastify/helmet` con CSP estricta para la SPA.
- Secretos por variables de entorno (`DATABASE_URL`, `SESSION_SECRET`, credenciales de WhatsApp),
  validados al arrancar; `.env` en `.gitignore`, `.env.example` sin valores reales.
- Audit log de: login (éxito/fallo), cambios de usuarios/roles, servicios, precios, horarios,
  bloqueos, creación y cambios de estado de citas.
- Dependencias: `npm audit` en CI, lockfile commiteado.
- Datos personales (teléfono, nombre): mínimos necesarios; política de retención a definir.

## 9. Checklist para la Fase 15

- [ ] Test de acceso cruzado para cada ruta.
- [ ] Ningún esquema de entrada acepta `tenantId`, `price*`, `duration*`, `role`, `status` donde no corresponda.
- [ ] Exclusion constraint presente tras `migrate deploy`.
- [ ] Rate limits activos en producción.
- [ ] Cookies `Secure` en producción; HTTPS obligatorio.
- [ ] Errores 500 sin detalles internos.
- [ ] `npm audit` sin vulnerabilidades altas.
- [ ] Revisión de RLS (si se aprueba).
