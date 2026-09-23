# Integración con el generador HTML (Fase 13)

> Este documento describe el plan. **El generador no se modifica hasta la Fase 13.**

## 1. Principio: mejora progresiva con fallback

Una página generada funciona en uno de dos modos:

| Modo | Condición | Comportamiento |
|---|---|---|
| WhatsApp (actual) | `apiUrl` o `tenantSlug` vacíos | Idéntico a hoy: formulario → resumen → `wa.me`. |
| Conectado | ambos configurados | Servicios, profesionales y horas reales desde la API; la cita se crea en el backend. |

Si en modo conectado la API no responde (red, 5xx, timeout ~8 s) al cargar, la página vuelve al
modo WhatsApp **sin ofrecer horas inventadas**. Si falla al crear la cita, se muestra el error y se
ofrece "Pedir por WhatsApp" como alternativa explícita, dejando claro que la cita no está confirmada.

## 2. Cambios en el generador

1. Dos campos nuevos en el formulario (sección de reservas): **URL de la API** (`apiUrl`,
   `https://…`, validada con `parseUrl`) y **Slug del negocio** (`tenantSlug`, mismo patrón que el backend).
2. `sanitize()`/`DEF`/`MAX`/`FIELDS` los incluyen; el JSON exportado sigue siendo `v:4` compatible
   (campos nuevos opcionales) o sube a `v:5` con migración suave.
3. `buildParts()` añade `api: { url, slug }` a `C.book` solo si ambos son válidos.
4. `cardRuntime` (ES5, sin dependencias) usa `XMLHttpRequest`/`fetch` con comprobación de soporte.

## 3. Flujo en modo conectado

1. Al abrir el diálogo: `GET /public/:slug` (+ `services`, `professionals`) — se cachea en memoria.
   Los `<select>` pasan a usar **IDs** del backend; los precios/duraciones mostrados vienen de la API.
2. Al elegir servicio → filtra profesionales por `serviceIds` ("Sin preferencia" = `any`).
3. Fecha: `min` = `today` del backend (zona del tenant), `max` = `today + bookingHorizonDays`.
4. Al elegir fecha: `GET /availability?serviceId&professionalId&date` → el `<input type=time>` libre
   se sustituye por un **selector de horas reales** (botones/`<select>` con `localTime`).
   Sin huecos → mensaje + botón "Siguiente día con disponibilidad".
5. Resumen → botón "Confirmar reserva" → `POST /bookings` con `Idempotency-Key` generado en el cliente.
6. `201` → pantalla de confirmación con los datos devueltos por el servidor (hora, profesional
   asignado, precio). Si viene `whatsappUrl`, botón opcional "Avisar por WhatsApp".
7. `409/422` → mostrar `alternatives` como botones; el cliente elige, nunca se reprograma solo.

## 4. Multi-local

Hoy la reserva se desactiva cuando hay varios locales. En modo conectado se añade un selector de
local (datos de `GET /public/:slug`) y se pasa `locationId` a `professionals` y `availability`.
En modo WhatsApp se mantiene el comportamiento actual.

## 5. Detalles técnicos

- CORS: la API pública responde `Access-Control-Allow-Origin: *`; el `POST` con JSON genera un
  preflight `OPTIONS` que el servidor acepta. Funciona desde `file://` y cualquier dominio.
- Sin cookies ni `credentials`. Sin datos sensibles en `localStorage`.
- La vista previa del generador (Shadow DOM) usa el mismo runtime; en preview se puede
  deshabilitar la llamada real o usar un modo "solo lectura" (sin `POST`).
- i18n: nuevas cadenas en `PAGE.pt` y `PAGE.es`.
- Textos generados por el usuario siempre con `textContent`/`esc()` (como hoy).

## 6. Importador desde el JSON del generador

Script CLI (`npm run import:generator -- --file datos-x.json --slug x`) que crea o actualiza un
tenant a partir del JSON exportado (`{"app":"gpc","v":4,...}`):

| Campo del generador | Backend |
|---|---|
| `nombre` | `Tenant.name` |
| `tz` | `Tenant.timezone` |
| `cc` | `Tenant.defaultCountryCode` |
| `lang` | `Tenant.locale` (`pt` → `pt-BR`, `es` → `es-ES`, editable) |
| `locName`, `dir`, `mapsUrl`, `wa` | `Location` por defecto |
| `locations` (líneas) | `Location` adicionales |
| `servicios` (líneas, `## Cat`) | `Service` (`name`, `category`, `description`); precio parseado a céntimos; **duración requerida** (valor por defecto del CLI, p. ej. 30, marcado para revisar) |
| `team` (líneas) | `Professional` (`displayName`, `title`, `bio`) + `ProfessionalService` por nombre (vacío = todos) |
| `hd0..hd6` / horarios por local | `WorkingHour` para cada profesional en el local correspondiente; tramos que cruzan medianoche se parten en dos |

El importador informa de lo que no pudo interpretar (precios ambiguos, servicios del equipo que no
existen) y no borra datos existentes sin `--replace`.
