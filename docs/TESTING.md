# Testing

Herramienta: **Vitest**. Tres niveles:

| Nivel | Qué | BD |
|---|---|---|
| Unit | motor de disponibilidad, utilidades de tiempo/teléfono/dinero, políticas de permisos | no |
| Integración | rutas Fastify vía `app.inject()`, repositorios, constraints | PostgreSQL real |
| Concurrencia | reservas simultáneas contra la BD real | PostgreSQL real |

No se mockea PostgreSQL: la protección contra doble reserva y las FKs compuestas solo se prueban
con la BD real. `docker-compose.yml` tendrá un servicio `postgres-test`; cada ejecución aplica
`prisma migrate deploy` a una BD limpia y cada archivo de test usa un esquema o trunca tablas.

## Comandos (a partir de la Fase 2)

```
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit en todos los workspaces
npm test             # vitest run (unit + integración)
npm run test:unit
npm run test:int     # requiere DATABASE_URL de test
```

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
- `migrate deploy` desde cero funciona; el constraint `booking_no_overlap` y la extensión `btree_gist` existen.
- No hay drift entre `schema.prisma` y las migraciones.

### No romper el generador
- Hasta la Fase 13, `generador-pagina-contacto.html` no cambia (`git diff --exit-code` sobre el archivo en CI).
- Fase 13: tests con Playwright de la página generada con y sin `apiUrl` (sin él, el flujo WhatsApp es idéntico al actual).
