# Testing

Herramienta: **Vitest**. Tres niveles:

| Nivel | Qué | BD |
|---|---|---|
| Unit | motor de disponibilidad, utilidades de tiempo/teléfono/dinero, políticas de permisos | no |
| Integración | rutas Fastify vía `app.inject()`, repositorios, constraints | PostgreSQL real |
| Concurrencia | reservas simultáneas contra la BD real | PostgreSQL real |

No se mockea PostgreSQL: la protección contra doble reserva y las FKs compuestas solo se prueban
con la BD real. La app bajo prueba se conecta con el rol `reservas_app` (sujeto a Row-Level Security,
`TEST_APP_DATABASE_URL`); los datos se preparan y comprueban como propietario (`TEST_DATABASE_URL`).
`test/helpers/global-setup.ts` borra el esquema de `TEST_DATABASE_URL` y aplica
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
npm run test:coverage   # tests + cobertura con umbral mínimo (lo que ejecuta CI)
TZ=Pacific/Kiritimati npm test   # toda la suite con el servidor en UTC+14 (también en CI)
```

Las pruebas en navegador (`test/generator/e2e.test.ts`, `test/panel-e2e.test.ts`) usan `playwright-core`
con Chromium y se saltan si no hay navegador o, las del panel, si no existe el build (`npm run build`).
En CI se instala Chromium y se compila el panel antes de los tests.

CI (`.github/workflows/ci.yml`) ejecuta todo lo anterior con un PostgreSQL 16 de servicio.

## Estado actual (hasta la Fase 15)

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
| `test/check-slot.test.ts` | motor puro: orden de validación, fuera de horario y pausa, duración completa antes del cierre (y de la pausa), limpieza posterior, solape parcial vs contiguo, bloqueos por profesional/local/generales, pasado/antelación/horizonte, local pedido, cruce de medianoche, zona horaria |
| `test/customers.test.ts` | E.164 y duplicados escritos distinto (409 con id), edición sin robar teléfono, búsqueda por nombre/dígitos, paginación, PROFESSIONAL solo clientes con cita suya, mismo teléfono en B aislado |
| `test/bookings.test.ts` | el servidor fija precio/duración/fin/local/estado; estado por defecto del negocio; campos prohibidos → 400; reutiliza cliente sin renombrarlo; motivos 422 por regla; ocupado/bloqueado → 409 y contiguo OK; ids de B = inexistentes; hora inexistente por DST; **10 creaciones simultáneas → 1 cita, 9 × 409**; PROFESSIONAL solo en su agenda; agenda y detalle por rol; A no ve ni toca citas de B; reprogramar conserva precio pactado o toma el nuevo al cambiar de servicio; no mueve a hueco ocupado ni canceladas; transiciones, reactivación solo ADMIN y si el hueco sigue libre, COMPLETED/NO_SHOW solo tras el inicio |
| `test/slots.test.ts` | huecos cada N min donde cabe la duración completa (pausa y cierre), intervalo configurable, citas y bloqueos, pasado/antelación/horizonte, día sin horario, unión de profesionales ("sin preferencia"), locales, medianoche, Madrid con cambio de hora, **coherencia total con `checkSlot`**, `pickProfessional`, alternativas por cercanía y días siguientes |
| `test/availability.test.ts` | endpoint del panel: huecos del día, intervalo del negocio, citas y bloqueos reales, `any` con profesionales libres, sin pasado, rango ≤ 14 días, 404 para servicio/profesional inválido o de B, todo hueco ofrecido se reserva; alternativas en 409/422 (cercanas, reservables, días siguientes en domingo, ninguna si el profesional no hace el servicio, también al reprogramar) |
| `test/bookings-any.test.ts` | "sin preferencia": menos citas ese día, desempate por orden, salta a quien no está libre (cita o bloqueo), solo activos/que hacen el servicio/del local; todos ocupados → mismo 409 con alternativas `any`; reglas → 422; PROFESSIONAL no puede usar `any`. **Concurrencia**: 8 `any` simultáneas con 3 libres → 3 citas (una por profesional) + 5 × 409; 3 rondas de 14 peticiones mixtas (concretas + `any`) sin duplicados y comprobación SQL de cero solapes; solapes parciales simultáneos → 1; cliente nuevo en 5 reservas simultáneas → 1 cliente; bloqueo y cita a la vez → nunca ambos |
| `test/public-api.test.ts` | datos públicos y `today` en la zona del negocio; slug inexistente/inválido/suspendido → 404 antes de validar; servicios con `bookable`; profesionales sin datos internos y filtros; disponibilidad con antelación y horizonte; reserva con precio/estado/origen del servidor y `whatsappUrl`; `any` dentro del negocio; campos prohibidos → 400; `TOO_SOON` y ocupado con alternativas; ids de B = inexistentes; cliente existente no se renombra; límite de 3 por teléfono (por negocio); rate limit 10/min; idempotencia (replay, clave reutilizada, liberación tras error, 5 envíos simultáneos → 1 cita, clave por negocio); CORS desde `file://` y otros dominios, POST cross-site aceptado, panel sin CORS |
| `test/users.test.ts` | lista sin hashes; alta de PROFESSIONAL con contraseña temporal (una vez, no auditada) y ficha; validaciones (duplicado, débil, ficha ocupada/de B/para ADMIN); nunca sin ADMIN activo, también con dos degradaciones simultáneas; rol/desactivar cortan sesiones; reset de contraseña; PROFESSIONAL sin acceso; usuarios de B → 404; auditoría paginada, filtrada y sin filas de B |
| `test/spa.test.ts` | index.html en `/` y rutas del panel (no-cache), assets `immutable`, `/api` inexistente sigue siendo 404 JSON, CSP |
| `apps/admin/test/*.test.ts(x)` | importes y fechas en la zona del negocio (incluido cambio de hora), cliente de la API (errores, 401, sin red, sin tenantId), login y error traducido, navegación por rol (PROFESSIONAL solo su columna), idioma por defecto del negocio |
| `apps/admin/test/professional.test.tsx` | panel del profesional: resumen del día sin canceladas y solo su columna; vista de 7 días (rango pedido, agrupación, sin canceladas); nueva cita limitada a sus servicios y a su agenda; aviso si no tiene ficha vinculada |
| `test/notifications.test.ts` | reserva web → confirmación al cliente, aviso al negocio y recordatorio 24 h antes; panel → solo cliente; WhatsApp del local por defecto como respaldo y sin WhatsApp no hay aviso al negocio; PENDING → "recibida" y al confirmar "confirmada" + recordatorio; cancelar y mover anulan lo pendiente; sin recordatorio a < 24 h; reserva fallida no deja avisos (misma transacción); textos en español; worker: solo lo vencido, reintentos con espera y FAILED tras 5, la cita no se ve afectada, dos workers no duplican; endpoint del panel con `wa.me`, sin filas de B, solo ADMIN; plantillas pt/es |
| `test/generator/generator.test.ts` | la librería del generador cargada en Node: **6 páginas sin backend idénticas byte a byte** a las del generador anterior (hashes congelados en `baseline-hashes.json`), JSON antiguo sin campos nuevos, configuración de la API (URL normalizada, slug en minúsculas), reserva sin WhatsApp ni servicios locales, multi-local con botón de reserva, validación de URL/slug (https, http solo localhost, sin query/credenciales), escape de la URL |
| `test/generator/e2e.test.ts` | **Chromium con la página abierta como `file://`** contra la API real: reserva con horas reales y aviso por WhatsApp; otra reserva se adelanta → aviso, alternativas y reserva con una de ellas; elección de servicio antes de que cargue la API se conserva; varios locales (filtra profesionales por local); API caída → flujo WhatsApp sin horas inventadas; página sin backend igual que antes; "Probar conexión" del generador. Se salta si no hay Chromium (en CI se instala) |
| `test/importer.test.ts` | interpretación de servicios (categorías, precios, marcadores, sin precio), equipo (servicios por nombre, inexistentes), horarios (24 h, cruce de medianoche), locales, monedas y locales; importación completa y reserva posterior por la API pública; negocio existente con datos → se niega sin tocar nada; sin email de ADMIN → error |
| `test/route-matrix.test.ts` | las 39 rutas `/admin` (lista tomada de la app): 401 sin sesión, 403 para PROFESSIONAL en rutas de ADMIN, 404 con ids de B y B intacto, sin `tenantId` en cuerpos, listados sin ids de B; sesión de A en la API pública de B; 20 reservas públicas simultáneas desde 20 IPs → 1 |
| `test/entrypoints.test.ts` | procesos conectados como `reservas_app`; `server.ts` real: arranca, `/healthz` y `/readyz`, SIGTERM → salida 0; `tenant:create` e `import:generator` como procesos (éxito, errores y código de salida); el seed de desarrollo se niega con `NODE_ENV=production` y en una BD con negocios reales; en producción el servidor no arranca si `DATABASE_URL` no está sujeta a RLS |
| `test/rls.test.ts` | Row-Level Security con el rol real `reservas_app`: el rol no puede saltárselo; sin negocio no ve ninguna fila de ninguna tabla ni puede escribir; con A, consultas sin filtro solo ven A y no puede leer, modificar, borrar ni crear filas de B; transacciones y SQL crudo; 40 consultas simultáneas A/B sin mezclas; transacciones simultáneas; funciones de sesión y del worker; sin DDL ni acceso a `_prisma_migrations` |
| `test/operator.test.ts` | `/operator`: sin `OPERATOR_TOKEN` no existe; token corto rechazado; formulario sin JavaScript, `no-store` y CSP; alta completa (negocio, local, ADMIN, auditoría) y login con la contraseña mostrada; token incorrecto/ausente → 403 sin crear nada; errores junto a cada campo con HTML escapado; slug repetido → 409; límite de intentos por IP; el resto de la API sigue sin aceptar formularios |
| `test/app-role.test.ts` | preparación de `reservas_app` en el pre-deploy: rechaza otro usuario (p. ej. el propietario), contraseñas cortas y una URL de migraciones con `reservas_app`; con propietario superusuario sincroniza la contraseña y si ya coincide no toca nada; sin permiso para crear roles, error con la instrucción |
| `test/input-fields.test.ts` | **todas** las rutas (esquemas tomados de la app): ningún body/query acepta `tenantId`; cada campo sensible aceptado (precio, duración, rol, estado, contraseña, `professionalId`, `active`…) está en una lista justificada; la API pública solo acepta `professionalId` |
| `test/logging.test.ts` | logs reales con `LOG_LEVEL=info`: sin contraseñas, cookie de sesión, teléfonos, nombres ni el texto de búsqueda de clientes (`search=[REDACTED]`) |
| `test/production.test.ts` | app con `NODE_ENV=production`: cookie `Secure; HttpOnly; SameSite=Strict`, HSTS/CSP/nosniff/X-Frame-Options, 500 sin detalles, rate limit de reservas públicas y de login activos, `X-Forwarded-For` no salta el límite sin `TRUST_PROXY` ni cambiando la IP falsa detrás de un proxy de confianza (mutación comprobada) |
| `test/panel-e2e.test.ts` | Chromium contra la API que sirve el panel: ADMIN crea servicio (precio "30,00"), profesional con horario desde el editor, cita desde la agenda y la cancela con motivo, y lo ve en la auditoría; PROFESSIONAL en móvil: menú reducido, bloqueo propio, horario de solo lectura; recarga en una ruta del panel |
| `apps/admin/test/pages.test.tsx` | cada pantalla del ADMIN: precio a céntimos y precio ilegible, editor de horario (24:00, local), ajustes sin slug, contraseña temporal mostrada una vez, clientes con búsqueda y paginación, locales/bloqueos/auditoría/cuenta |
| `test/lib.test.ts` | política de contraseñas, `FailureLimiter`, zonas horarias, slugs |

## Cobertura de la matriz obligatoria (Fase 14)

| Requisito | Dónde se prueba |
|---|---|
| **Aislamiento**: A no lee ni modifica nada de B por ninguna ruta con `:id` (404 y B intacto) | `route-matrix.test.ts` (recorre **todas** las rutas `/admin` registradas; falla si aparece una ruta sin clasificar) |
| Relaciones con ids de B imposibles también en la BD | `db-tenant-isolation.test.ts` (FKs compuestas) |
| `tenantId` en el cuerpo → 400, en todas las rutas con cuerpo | `route-matrix.test.ts`, `roles-and-tenant-isolation.test.ts`, `public-api.test.ts` |
| Listados de A sin filas de B | `route-matrix.test.ts` (todos los listados), más cada módulo |
| Público con ids de B → mismo error que inexistente | `public-api.test.ts`, `availability.test.ts` |
| Mismo teléfono en A y B = dos clientes | `db-tenant-isolation.test.ts`, `customers.test.ts` |
| Sesión de A no cambia nada en la API pública de B | `route-matrix.test.ts` |
| **Doble reserva**: 20 simultáneas → 1 (BD, panel y API pública con 20 IPs) | `db-constraints.test.ts`, `bookings.test.ts`, `route-matrix.test.ts` |
| Solape parcial simultáneo, contiguas, cancelar libera / reactivar ocupada → 409, `23P01` | `db-constraints.test.ts`, `bookings-any.test.ts`, `bookings.test.ts` |
| `any` concurrente sin duplicar profesional | `bookings-any.test.ts` |
| **Disponibilidad**: orden de validación, fuera de horario, cierre, pausa, buffer, intervalo, antelación, horizonte | `check-slot.test.ts`, `slots.test.ts`, `availability.test.ts`, `bookings.test.ts` |
| Alternativas reales por cercanía, nunca reserva otra hora | `slots.test.ts`, `availability.test.ts`, `generator/e2e.test.ts` |
| `any`: menos citas del día, desempate estable | `slots.test.ts`, `bookings-any.test.ts` |
| **Zona horaria**: São Paulo vs Madrid, cambio de hora (inexistente/ambigua), cruce de medianoche | `time-phone.test.ts`, `slots.test.ts`, `check-slot.test.ts`, `bookings.test.ts` |
| "Hoy"/"ahora" en la zona del negocio con el servidor en otra zona | toda la suite con `TZ=Pacific/Kiritimati` (UTC+14) y `Pacific/Pago_Pago` (UTC−11): pasa; CI la ejecuta en UTC+14 |
| **Roles**: sin sesión → 401 en todo `/admin` (incluso con cuerpo inválido) | `route-matrix.test.ts` |
| PROFESSIONAL → 403 en todo lo de ADMIN (incluso con cuerpo inválido); no escala su rol | `route-matrix.test.ts` |
| PROFESSIONAL solo sus citas/bloqueos/clientes | `bookings.test.ts`, `schedule.test.ts`, `customers.test.ts` |
| Sesión caducada/revocada → 401; logout; fuerza bruta → 429 | `auth.test.ts` |
| **Validación**: campos extra → 400; teléfonos → mismo E.164; 500 sin detalles | `public-api.test.ts`, `bookings.test.ts`, `time-phone.test.ts`, `roles-and-tenant-isolation.test.ts` |
| **Migraciones** desde cero y sin drift | global setup (`migrate deploy`), `db-constraints.test.ts`, `npm run db:check-drift` |
| **Generador**: sin backend, páginas idénticas byte a byte | `generator/generator.test.ts` |
| Puntos de entrada reales (servidor con SIGTERM, scripts del operador) | `entrypoints.test.ts` |
| Panel en navegador (ADMIN y PROFESSIONAL en móvil) | `panel-e2e.test.ts` |

**Cobertura medida** (`npm run test:coverage`): API 97 % de sentencias, 91 % de ramas, 100 % de
funciones (sin contar `server.ts` y `cli/`, que se prueban como procesos); panel 67 % de sentencias con
tests unitarios, además de las pruebas en Chromium. Umbrales en CI: API 90/83/95/90, panel 60/50/50/60.

**Verificación por mutación** (se rompe el código a propósito y el test debe fallar): quitar el bloqueo
del profesional al crear citas (Fase 8) y comprobar la sesión después de validar el cuerpo (Fase 14):
en ambos casos los tests fallan; restaurado, pasan.

**Hallazgo de la Fase 14**: la sesión, el rol y la protección CSRF se comprobaban en `preHandler`, que
en Fastify va *después* de validar el cuerpo: una petición anónima con cuerpo inválido recibía 400 en
vez de 401 (revelando el esquema). Ahora se comprueban en `onRequest`.

## Imagen de producción (job `docker` de CI)

Construye la imagen y repite una instalación como en Railway contra un PostgreSQL 16 cuyo propietario es
el superusuario `postgres`: `migrate` crea `reservas_app` y migra (y repetirlo no cambia nada), servidor
con `NODE_ENV=production` hasta `healthy`, primer negocio desde `/operator`, login con cookie `Secure`
con la contraseña mostrada, API pública, panel, parada con `SIGTERM` (salida 0), y negativa a arrancar
conectado como propietario. Probado también a mano: contraseña cambiada → `migrate` la actualiza;
`DATABASE_URL` con el propietario → `migrate` se niega; importador y copia `pg_dump`/`pg_restore`.

## Matriz obligatoria (requisitos)

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

Verificado con mutación (Fase 8): quitando el bloqueo del profesional en la creación de citas, el
test "bloqueo y cita a la vez" falla (quedan ambos); con el bloqueo, pasa. Los tests de concurrencia
se ejecutaron 5 veces seguidas sin fallos.

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
- Hasta la Fase 13 el archivo no cambió (CI lo comprobaba con `git diff`). Desde la Fase 13 la garantía
  es más precisa: las páginas sin backend deben coincidir byte a byte con las del generador anterior
  (`generator.test.ts`, hashes congelados antes de modificarlo).
- Pruebas en Chromium de la página generada con y sin backend (`e2e.test.ts`), con `playwright-core`.

## Prueba manual en navegador (Fase 10)

Con el seed, `npm run build` y la API arrancada, un script de Playwright (Chromium) entra como
`admin@barberia-a.test`, abre un lunes, crea una cita desde "Novo agendamento" eligiendo una hora
ofrecida por el servidor, comprueba que aparece en la columna del profesional y abre el editor de
horario. Resultado: sin errores de consola salvo el 401 esperado de `/auth/me` antes del login.
Pendiente (Fase 14): convertirlo en una suite E2E automatizada en CI.

## Prueba manual en navegador (Fase 11)

Chromium con viewport de móvil (390×844) como `carlos@barberia-a.test`: navegación en una sola barra,
creación de una cita propia desde el móvil (primera hora libre), resumen del día, vista de próximos
7 días y formulario de bloqueo sin selector de profesional ni de local. Sin errores de consola.

## Prueba manual (Fase 12)

Servidor real con el worker: una reserva por la API pública genera 3 avisos; en el siguiente ciclo el
worker registra los 2 vencidos (log con teléfono enmascarado) y deja el recordatorio pendiente para su
hora. La página Avisos del panel los muestra con "Abrir no WhatsApp". Se detectó y corrigió que las
columnas de todas las tablas del panel estaban desalineadas.

## Hallazgos de la Fase 13 (encontrados por las pruebas en navegador)

- El atributo `hidden` no ocultaba campos ni botones del diálogo porque el CSS de la página les da
  `display:flex`: se añadió `.bkf[hidden]`, `.bkba [hidden]` al CSS del modo conectado.
- Carrera: si el cliente elegía servicio antes de que cargara la API, la elección se perdía. Se conserva.
- Con temas de botón transparente, la hora elegida no se distinguía: ahora usa `--accent-text`
  (contraste ≥ 4.5 garantizado) y un ✓.
- `toE164` lanzaba una excepción con un código de país inexistente (p. ej. 999): ahora devuelve "no válido".
