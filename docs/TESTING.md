# Testing

Herramienta: **Vitest**. Tres niveles:

| Nivel | Qué | BD |
|---|---|---|
| Unit | motor de disponibilidad, utilidades de tiempo/teléfono/dinero, políticas de permisos | no |
| Integración | rutas Fastify vía `app.inject()`, repositorios, constraints | PostgreSQL real |
| Concurrencia | reservas simultáneas contra la BD real | PostgreSQL real |

No se mockea PostgreSQL: la protección contra doble reserva y las FKs compuestas solo se prueban
con la BD real. `test/helpers/global-setup.ts` borra el esquema de `TEST_DATABASE_URL` y aplica
`prisma migrate deploy` (igual que producción) al inicio de cada ejecución; cada archivo trunca las
tablas en `beforeEach`. Los archivos se ejecutan en serie (`fileParallelism: false`).

## Comandos

```
npm run db:up           # PostgreSQL en Docker (crea reservas_dev, reservas_test, reservas_shadow)
npm run db:migrate      # prisma migrate dev sobre DATABASE_URL
npm run db:seed         # datos de desarrollo
npm run lint            # ESLint (TypeScript con type-checking)
npm run typecheck       # prisma generate + tsc --noEmit
npm test                # vitest run (unit + integración, requiere TEST_DATABASE_URL)
npm run db:check-drift  # schema.prisma ≡ migraciones (requiere SHADOW_DATABASE_URL)
```

CI (`.github/workflows/ci.yml`) ejecuta todo lo anterior con un PostgreSQL 16 de servicio.

## Estado actual (hasta la Fase 5)

| Archivo | Cubre |
|---|---|
| `test/db-constraints.test.ts` | existencia de extensión/constraints/índices; solape, hora exacta, contiguas, otro profesional, cancelada libera y no se reactiva sobre hueco ocupado, COMPLETED/NO_SHOW fuera; **20 inserciones concurrentes → 1**; CHECKs de horario, teléfono, email, slug, estado inicial, nombre de servicio |
| `test/db-tenant-isolation.test.ts` | FKs compuestas: cita, servicio de profesional, horario, bloqueo y usuario de otro tenant rechazados; mismo teléfono/email en tenants distintos permitido y único dentro del tenant; un local por defecto por tenant |
| `test/config.test.ts` | validación de env sin filtrar secretos; extracción del SQLSTATE |
| `test/auth.test.ts` | login (cookie, hash del token, mayúsculas, mismo error para todo fallo, usuario inactivo, tenant suspendido), bloqueo tras 5 fallos y por IP, campos extra → 400, `text/plain` → 415, caducidad deslizante/absoluta con reloj falso, logout, cambio de contraseña cierra otras sesiones, CSRF, 404/health |
| `test/roles-and-tenant-isolation.test.ts` | 401 sin sesión, PROFESSIONAL → 403 en ajustes, `professionalId` desde la BD, auditoría antes/después, validación de ajustes; mismo email en A y B ve solo su negocio; `tenantId` en body → 400; query/cabecera no cambian el tenant; credenciales de A no entran en B; un 500 no filtra detalles |
| `test/provision.test.ts` | alta por CLI: tenant + local + ADMIN Argon2id + auditoría sin secretos; slug duplicado en paralelo sin datos a medias; validaciones |
| `test/services-professionals.test.ts` | CRUD de servicios y profesionales con auditoría; nombre duplicado (también al reactivar); validación de duración/precio/URL y campos prohibidos; el cambio de precio no toca citas existentes; no se desactiva con citas futuras; PROFESSIONAL solo lee; con ids de B → 404 en las 7 rutas y B intacto; servicios de B no asignables (mismo error que id inexistente); listados sin filas de B |
| `test/locations.test.ts` | WhatsApp → E.164, URL https; un único local por defecto (no se quita ni se desactiva); no se desactiva con horarios o citas pendientes; PROFESSIONAL solo lee; locales de B → 404 y fuera de los listados |
| `test/schedule.test.ts` | horario con varios intervalos/día, contiguos, hasta 24:00; solapes en locales distintos → 400; validación y locales de B/inactivos; no deja citas futuras fuera de horario (ignora pasadas/canceladas, respeta el local); cita que cruza medianoche; permisos de PROFESSIONAL; horario de B → 404. Bloqueos: por profesional/local/negocio, PROFESSIONAL solo los suyos, choque con citas (contiguo sí), fechas sin zona → 400, refs de B, listado por rango y visibilidad, borrado por rol, sin filas de B |
| `test/time-phone.test.ts` | HH:MM y 24:00, día de la semana, misma hora local en São Paulo vs Madrid, cambio de hora de Madrid (hora inexistente y repetida), unión de tramos y cruce de medianoche, teléfonos a E.164 |
| `test/lib.test.ts` | política de contraseñas, `FailureLimiter`, zonas horarias, slugs |

## Matriz obligatoria

### Aislamiento entre tenants
- Admin de A: `GET/PATCH/DELETE` de profesional, servicio, cliente, cita, bloqueo, horario, local,
  usuario de B → 404 y B sin cambios.
- Admin de A crea cita/relación con `professionalId`/`serviceId`/`customerId` de B → 404 (y la FK
  compuesta lo impide aunque se salte la app: test directo contra Prisma).
- Body con `tenantId` → 400.
- Listados de A nunca contienen filas de B (seed con datos casi idénticos en ambos).
- Público: `/public/A/availability` con `serviceId` o `professionalId` de B → 404.
- Mismo teléfono en A y B → dos `Customer` distintos; los datos no se mezclan.
- Sesión de A usada con `tenantSlug` de B en la URL pública no cambia nada (el público no usa sesión).

### Doble reserva / concurrencia
- 20 `POST /bookings` simultáneos al mismo profesional y hora → exactamente 1 `201`, 19 `409`.
- Solapamiento parcial simultáneo (10:00–10:30 y 10:15–10:45) → solo una.
- `professionalId=any` con 2 profesionales libres y 5 peticiones simultáneas → 2 citas, una por profesional.
- Citas contiguas (10:00–10:30 y 10:30–11:00) → ambas aceptadas.
- Cancelar libera el hueco; reactivar una cancelada que ya fue ocupada → 409.
- Inserción directa por SQL que viola el constraint → error `23P01`.

### Disponibilidad y reglas de validación (en el orden especificado)
- Profesional inexistente / inactivo, servicio inexistente / inactivo, profesional que no hace el servicio.
- Día sin horario → sin slots; hora fuera del horario.
- **Cruce de cierre**: cierre 19:00, servicio 45 min → último slot 18:15; 18:30 rechazado con `EXCEEDS_CLOSING_TIME`.
- Varios intervalos (09–13, 15–19): servicio de 60 min no ocupa 12:30; la pausa nunca se reserva.
- Solape con cita existente y con `TimeBlock` (de profesional y de todo el local).
- Buffer posterior respetado.
- Slot interval configurable (15 vs 30) cambia los inicios.
- Antelación mínima y horizonte.
- Alternativas: devuelven slots reales, ordenados por cercanía, y nunca se crea la cita en otra hora.
- `any`: unión correcta y asignación al profesional con menos citas en la franja (desempate estable).

### Zona horaria
- Tenant `America/Sao_Paulo` y `Europe/Madrid` con el mismo `date/time` → `startAt` UTC distintos y correctos.
- Cambio de horario de verano en `Europe/Madrid` (último domingo de marzo/octubre): hora inexistente rechazada, hora ambigua determinista, slots del día correctos.
- "Hoy" y "ahora" calculados en la zona del tenant, no del servidor (tests con reloj falso y `TZ` del proceso distinto).
- Horario que cruza medianoche guardado como dos intervalos: slot 23:30 de 60 min aceptado si el día siguiente empieza a las 00:00.

### Roles y permisos
- Sin sesión → 401 en todo `/admin`.
- `PROFESSIONAL`: puede ver/cambiar estado de sus citas; 404 en citas de otro profesional; 403 en servicios, usuarios, ajustes, precios.
- `PROFESSIONAL` no puede escalar su rol (`PATCH /admin/users/:id { role }` → 403).
- Sesión expirada/revocada → 401. Logout invalida la cookie.
- Login con fuerza bruta → 429.

### Validación y errores
- Campos extra (`price`, `durationMinutes`, `status`) en POST público → 400.
- Teléfonos en formatos varios → mismo E.164.
- Errores 500 no filtran stack ni mensajes de Prisma.

### Migraciones
- `migrate deploy` desde cero funciona; el constraint `Booking_no_overlap` y la extensión `btree_gist` existen.
- No hay drift entre `schema.prisma` y las migraciones.

### No romper el generador
- Hasta la Fase 13, `generador-pagina-contacto.html` no cambia (`git diff --exit-code` sobre el archivo en CI).
- Fase 13: tests con Playwright de la página generada con y sin `apiUrl` (sin él, el flujo WhatsApp es idéntico al actual).
