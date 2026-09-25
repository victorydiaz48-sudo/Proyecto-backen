# Integración con el generador HTML — implementada (Fase 13)

## 1. Principio: mejora progresiva con vuelta a WhatsApp

Una página generada funciona en uno de dos modos:

| Modo | Condición | Comportamiento |
|---|---|---|
| WhatsApp (el de siempre) | "Dirección del sistema de reservas" o "Identificador" vacíos o inválidos | **Idéntico byte a byte** a la página que generaba el generador antes de la Fase 13. |
| Conectado | ambos válidos | Servicios, profesionales, locales y **horas reales** desde la API; la cita se crea en el backend; WhatsApp queda como aviso opcional al final. |

En modo conectado, si la API no responde al abrir el formulario, la página sigue con el flujo de
WhatsApp de siempre (hora libre, resumen, `wa.me`) **sin ofrecer horas inventadas**. Si la API cae al
confirmar, se dice claramente que la reserva **no** se hizo y se ofrece WhatsApp como alternativa.

## 2. Cambios en el generador (`generador-pagina-contacto.html`)

**Formulario** — dentro de "Acción principal", bloque plegable "Reservas en línea (opcional)":

| Campo | Clave en el JSON | Validación |
|---|---|---|
| Dirección del sistema de reservas | `apiUrl` | `https://…` (se admite una ruta base; sin query, fragmento ni credenciales). `http://` solo para `localhost`/`127.0.0.1` (pruebas en local). |
| Identificador del negocio | `apiSlug` | minúsculas, números y guiones (3–50), como el slug del backend. |

- Con uno relleno y el otro no (o inválido) se muestra un aviso en el campo y la página se genera en
  modo WhatsApp.
- Botón **"Probar conexión"**: hace `GET /api/v1/public/:slug` y `/services` (solo lectura) y muestra
  "Conectado: {negocio} · N servicios reservables" o un error.
- El JSON exportado sigue siendo `{"app":"gpc","v":4}` con dos claves nuevas opcionales; un JSON antiguo
  se importa igual (claves vacías).
- Con backend, el botón "Reserva con formulario" está disponible aunque la página no tenga WhatsApp ni
  servicios escritos (los da el backend) y **también con varios locales** (antes se desactivaba): se
  muestra el botón de reserva además de los botones de WhatsApp por local.

**Página generada** — todo lo nuevo se añade **solo** si hay backend:
- Marcado extra en el diálogo: selector de local, selector de horas (`#bkSlots`), mensaje de estado,
  botón "Confirmar" y pantalla de confirmación.
- CSS extra (`apiCss()`).
- Un segundo runtime ES5, `bookingApiRuntime`, que **no modifica** `cardRuntime`: intercepta el envío
  del formulario en fase de captura solo cuando el modo conectado está activo, y sustituye los `<select>`
  por copias limpias para no heredar los manejadores del modo WhatsApp.

Garantía de no romper nada: `apps/api/test/generator/generator.test.ts` compara el hash SHA-256 de 6
páginas representativas (barbería, con formulario, multi-local, español con horario que cruza medianoche,
restaurante con carrito, vacía) con los hashes **congelados antes de modificar el generador**
(`baseline-hashes.json`).

## 3. Flujo en modo conectado

1. Al abrir el formulario por primera vez: `GET /public/:slug`, `/services` y `/professionals` en
   paralelo (timeout 10 s). Solo se ofrecen servicios con `bookable: true`.
2. Servicio → filtra profesionales por `serviceIds`. "Sin preferencia" = `any`.
3. Local (si el negocio tiene más de uno): filtra profesionales con `/professionals?locationId=`.
4. Fecha: `min` = `today` del backend (zona del negocio), `max` = `today + bookingHorizonDays`.
5. Servicio + fecha (+ profesional/local) → `GET /availability` → botones con las horas reales. Sin
   huecos → "No hay horas libres este día".
6. "Continuar" → resumen → **"Confirmar"** → `POST /bookings` con `Idempotency-Key` aleatoria (un doble
   toque o un reintento no duplican la cita).
7. `201` → "¡Reserva confirmada!" (o "Solicitud recibida" si el negocio usa `PENDING`) con los datos que
   devuelve el servidor (profesional asignado, precio) y botón opcional "Avisar por WhatsApp"
   (`whatsappUrl` del backend).
8. `409`/`422` → vuelve al formulario con el aviso y las `alternatives` del servidor como botones (con
   fecha si son de otro día). **Nunca se reserva otra hora sola**: el cliente elige.
9. `400`/`429` → mensaje del servidor. Red caída o `5xx` → "la reserva NO se ha hecho" + WhatsApp.
10. Si el cliente eligió un servicio en la lista de la página mientras cargaba la API, la elección se
    mantiene (por nombre).

CORS: la API pública responde `Access-Control-Allow-Origin: *`; funciona desde cualquier dominio y
desde `file://` (probado en Chromium). La vista previa del generador no activa el modo conectado.

## 4. Importador del JSON del generador

```bash
npm run import:generator -w apps/api -- --file datos-barbearia.json --slug barbearia-central \
  --admin-email dono@exemplo.com [--duration 30] [--currency BRL] [--dry-run]
```

| Del generador | Al backend |
|---|---|
| `nombre`, `tz`, `cc`, `lang` | `Tenant.name`, `timezone`, `defaultCountryCode`, `locale` (pt → pt-BR / pt-PT; es → es-ES / es-MX / es-AR según país) |
| país (`cc`) | `currency` (55 BRL, 351/34 EUR, 52 MXN, 54 ARS, 56 CLP, 57 COP, 51 PEN, 598 UYU, 1 USD; otro → `--currency`) |
| `locName`, `dir`, `mapsUrl`, `wa` | local por defecto (WhatsApp → E.164) |
| `locations` (líneas) | locales adicionales |
| `servicios` (`## Categoría`, `Nombre \| Precio \| Descripción`) | `Service` con categoría, precio en céntimos y la duración de `--duration` |
| `team` (`Nombre \| Cargo \| Bio \| servicios`) | `Professional` + servicios por nombre (lista vacía = todos) |
| `hd0..hd6` | `WorkingHour` de cada profesional en el local principal; `00:00-00:00` = 24 h; los tramos que cruzan medianoche se parten en dos días |

- Usa los mismos servicios que el panel (mismas validaciones y auditoría con actor `SYSTEM`).
- Solo importa en un negocio **nuevo** (lo crea con su primer ADMIN y contraseña temporal) o en uno
  **sin servicios ni profesionales**; nunca sobrescribe datos. `--dry-run` muestra el plan sin guardar.
- Avisa de todo lo que no puede interpretar: precios no numéricos o con tamaños (se importan a 0),
  servicios del equipo que no existen, duración uniforme a revisar, locales adicionales sin
  profesionales asignados (el generador no dice quién trabaja dónde), negocio de comida.
- No es atómico entre pasos (cada paso usa su propia transacción): si falla a mitad, el negocio queda
  con datos parciales y una segunda ejecución se niega; se corrige desde el panel.
