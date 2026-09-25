# Despliegue (Fase 16)

Un único servicio HTTP (API + panel en el mismo origen) sobre PostgreSQL 16. Todo lo de esta guía está
probado: el job `docker` de CI construye la imagen y repite la instalación completa (como en Railway)
en cada push.

```
Internet ──HTTPS──▶ balanceador / proxy (TLS) ──HTTP──▶ contenedor "reservas" :3000 ──▶ PostgreSQL 16
                                                          ├─ /api/v1/public/*  páginas generadas (CORS *)
                                                          ├─ /api/v1/auth, /api/v1/admin/*  panel (cookie)
                                                          └─ /  panel React (estáticos)
```

## 1. Requisitos

- Un sitio donde ejecutar contenedores (cualquier proveedor o una VM con Docker) con **HTTPS** delante:
  la cookie de sesión es `Secure` y la app envía HSTS.
- **PostgreSQL 16 gestionado** con copias automáticas y recuperación a un momento dado (PITR). Extensión
  `btree_gist` disponible (la crea la primera migración; en PostgreSQL gestionado suele estar permitida).
- Dos usuarios de base de datos: el **propietario** del esquema, para migrar, y **`reservas_app`**,
  para la app, sujeto a Row-Level Security (`migrate` lo crea si el propietario puede crear roles).

## 2. Imagen

Un solo `Dockerfile` y una sola imagen (Node 22 slim, JavaScript compilado, panel compilado, solo
dependencias de producción, usuario sin privilegios, `HEALTHCHECK` sobre `/readyz`). Comandos:

| Comando | Para qué |
|---|---|
| `serve` (por defecto) | el servidor |
| `migrate` | **antes de cada versión** (pre-deploy): crea o actualiza el usuario `reservas_app` con la contraseña de `DATABASE_URL` y aplica las migraciones con el propietario. Idempotente. |
| `tenant-create …`, `import-generator …` | tareas del operador desde terminal (alternativa: `/operator`, §4) |

```bash
docker build -t reservas:1.0.0 .
```

## 3. Variables de entorno

| Variable | Obligatoria | Valor |
|---|---|---|
| `DATABASE_URL` | **sí** | `postgresql://reservas_app:<contraseña>@host:5432/db`. Contraseña de 16+ caracteres, solo letras y números (si no, hay que codificarla en la URL). **Nunca** el propietario: el servidor no arranca si la conexión se salta RLS, y `migrate` tampoco la acepta. |
| `MIGRATION_DATABASE_URL` | para `migrate` | el propietario del esquema. Si puede crear roles (en Railway, `postgres` es superusuario), `migrate` crea `reservas_app` solo; si no, créalo antes a mano (§4). El servidor no la lee; solo hace falta donde se ejecute `migrate`. |
| `OPERATOR_TOKEN` | no | activa `/operator` (alta de negocios desde el navegador). 32+ caracteres aleatorios. Sin definir, `/operator` no existe (404). Puede quitarse después de crear los negocios. |
| `TELEGRAM_BOT_TOKEN` | no | token del bot de Telegram para los avisos al negocio (§4c). Sin definir: sin Telegram. |
| `TRUST_PROXY` | detrás de un proxy | IPs/CIDR de **tus** proxies, separadas por comas, o `uniquelocal` (10/8, 172.16/12, 192.168/16, fc00::/7). `true` está prohibido (permitiría falsear la IP y saltarse los rate limits). Por defecto `false`. Cómo averiguarlo: §4, paso 5. |
| `PORT` / `HOST` | no | `3000` / `0.0.0.0` (si la plataforma define `PORT`, se usa esa) |
| `LOG_LEVEL` | no | `info` (JSON por la salida estándar) |
| `NOTIFICATIONS_WORKER` | no | `true`. Con varias réplicas puede quedarse en todas (no duplican avisos). |
| `NOTIFICATIONS_TRANSPORT` | no | `log` (opción C: los avisos se ven en el panel y se envían a mano) |
| `NODE_ENV` | — | la imagen ya trae `production` |
| `COOKIE_SECURE` | — | siempre `true` en producción (no se puede desactivar) |

No hay más secretos: las sesiones son tokens aleatorios guardados como hash, no se firman con una clave.

## 4. Primera instalación

**1. Base de datos.** Una base PostgreSQL 16 vacía y su propietario (en PostgreSQL gestionado, el
usuario que te da el proveedor). Si ese usuario **no** puede crear roles, crea una vez, como
administrador: `CREATE ROLE reservas_app LOGIN PASSWORD '<contraseña de DATABASE_URL>';`.

**2. Migraciones** (el pre-deploy de la plataforma, o a mano):

```bash
docker run --rm -e MIGRATION_DATABASE_URL='postgresql://<propietario>:…@host:5432/db' \
  -e DATABASE_URL='postgresql://reservas_app:…@host:5432/db' reservas:1.0.0 migrate
```

Salida esperada: `Usuario reservas_app: creado.` (o `ya estaba listo.`) y
`All migrations have been successfully applied.` (o `No pending migrations to apply.`).

**3. Servidor:** `docker run -d -p 3000:3000 -e DATABASE_URL='…' -e OPERATOR_TOKEN='…' reservas:1.0.0`.
Comprobación: `https://tu-dominio/readyz` → `{"status":"ok"}`.

**4. Primer negocio**, desde el navegador (también desde el móvil): `https://tu-dominio/operator`,
con el `OPERATOR_TOKEN`. Muestra la contraseña inicial del ADMIN **una sola vez**; se cambia en
*Cuenta*. Máximo 10 intentos cada 15 minutos por IP. Desde terminal, lo mismo con `tenant-create`:

```bash
docker run --rm -e DATABASE_URL='postgresql://reservas_app:…' reservas:1.0.0 tenant-create \
  --slug barbearia-central --name "Barbearia Central" --timezone America/Sao_Paulo --country 55 \
  --currency BRL --locale pt-BR --admin-email dono@exemplo.com
```

Para crear el negocio a partir del JSON exportado por el generador:
`import-generator --file /datos.json --slug … --admin-email …` con el archivo montado
(`-v "$PWD/datos.json:/datos.json:ro"`; `--dry-run` para ver el plan; ver
[FRONTEND_INTEGRATION](FRONTEND_INTEGRATION.md) §4).

**5. `TRUST_PROXY`.** Con `TRUST_PROXY=false`, el servidor escribe **una vez** en los logs un aviso
"Las peticiones llegan a través de un proxy…" con `"proxyAddress"`: esa es la IP del proxy de la
plataforma (no la tuya). También sale como `"remoteAddress"` en las líneas `incoming request`. Si es privada (10.x, 172.16–31.x, 192.168.x, fd…/fc…) usa `uniquelocal`; si es 100.64–100.127.x,
`100.64.0.0/10`; si no, esa IP o su rango. Con `false` todo funciona, pero todos los visitantes cuentan
como una sola IP para los rate limits.

**6. Páginas del generador:** en "Reservas en línea", *Dirección del sistema de reservas* =
`https://tu-dominio` e *Identificador* = el slug; "Probar conexión".

## 4b. Railway

Un proyecto con dos servicios: **Postgres** (plantilla de Railway) y el **backend** (este repositorio).

Servicio del backend → *Settings*:

| Ajuste | Valor |
|---|---|
| Source → Branch | la rama con el backend (hoy `claude/barbershop-multitenant-backend-wr779k`) |
| Root Directory | vacío (la raíz del repo: el `Dockerfile` está ahí) |
| Deploy → **Pre-deploy Command** | `/usr/local/bin/entrypoint migrate` |
| Deploy → Custom Start Command | vacío (la imagen arranca el servidor) |
| Deploy → Healthcheck Path | `/readyz` |
| Networking | generar un dominio público |

Variables del servicio del backend (`Postgres` es el nombre del servicio de base de datos; si se llama
distinto, cámbialo en las referencias):

| Variable | Valor |
|---|---|
| `RESERVAS_APP_PASSWORD` | 32+ letras y números aleatorios (de un gestor de contraseñas) |
| `DATABASE_URL` | `postgresql://reservas_app:${{RESERVAS_APP_PASSWORD}}@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}` |
| `MIGRATION_DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `OPERATOR_TOKEN` | 40+ caracteres aleatorios (otro distinto) |
| `TRUST_PROXY` | `false` al principio; el valor definitivo según §4, paso 5 |
| `TELEGRAM_BOT_TOKEN` | opcional: el token de @BotFather (§4c) |

El pre-deploy se ejecuta con la misma imagen y las mismas variables antes de cada despliegue: la primera
vez crea `reservas_app` (el usuario `postgres` de Railway es superusuario) y aplica las migraciones; si
falla, Railway no despliega. Cambiar `RESERVAS_APP_PASSWORD` y volver a desplegar actualiza la contraseña.

`MIGRATION_DATABASE_URL` queda en el entorno del servidor porque el pre-deploy usa las variables del
servicio; el servidor no la lee. Es una credencial de superusuario: no la copies a ningún otro sitio.

## 4c. Avisos por Telegram

Un bot para toda la plataforma; cada negocio conecta su propio chat desde el panel.

1. En Telegram (también desde el móvil), abre **@BotFather** → `/newbot` → un nombre (p. ej.
   "Reservas Barbería") → un usuario que termine en `bot` (p. ej. `reservas_barberia_bot`).
2. BotFather responde con el token (`123456789:AA…`): ponlo en la variable `TELEGRAM_BOT_TOKEN` del
   servidor y vuelve a desplegar.
3. En el panel, **Ajustes → Avisos por Telegram → Conectar Telegram → Abrir Telegram → Iniciar**. El bot
   responde "✅ Conectado" y desde ese momento cada cita nueva desde la web llega a ese chat.
4. Para dejar de recibirlos: *Desconectar* en el mismo sitio.

Solo la instancia con `NOTIFICATIONS_WORKER=true` recibe los *Iniciar*. Si alguien bloquea el bot, el
aviso queda en *Avisos* como fallido con el motivo.

## 5. Cada nueva versión

1. Construir la imagen.
2. **Migrar primero** con `migrate` (el pre-deploy; si falla, no se despliega nada).
3. Desplegar. Con varias réplicas, de una en una: la plataforma espera a que `/readyz` responda antes de
   retirar la anterior.
4. Las migraciones deben ser **compatibles con la versión anterior** mientras conviven (añadir columnas
   opcionales, no renombrar ni borrar en el mismo paso). Las migraciones no se revierten: volver a la
   imagen anterior es seguro si la migración era compatible; si no, se restaura la copia (§7).

## 6. Salud, parada y logs

- `GET /healthz`: el proceso responde (liveness). `GET /readyz`: además llega a la BD (readiness). La
  imagen trae `HEALTHCHECK` sobre `/readyz`.
- `SIGTERM`: deja de aceptar peticiones, termina las que están en curso, para el worker y sale con 0.
- Logs JSON por la salida estándar, sin cabeceras ni cuerpos (sin contraseñas, cookies ni teléfonos).
  Los errores 500 se registran completos: trata los logs como datos personales y limita su retención.

## 7. Copias de seguridad y restauración

**Copias automáticas del proveedor con PITR**: la protección principal (actívalas y fija la retención).

**Copia lógica adicional** (diaria, guardada fuera del proveedor). La hace **el propietario**:
`reservas_app` solo ve el negocio fijado y `pg_dump` falla con él (no puede salir una copia incompleta
sin avisar).

```bash
pg_dump -Fc "postgresql://reservas_owner:…@host:5432/reservas?sslmode=require" -f reservas-$(date +%F).dump
```

**Restaurar** (probado: conserva políticas RLS, funciones, permisos de `reservas_app` e historial de
migraciones). El rol `reservas_app` debe existir en el servidor de destino:

```bash
createdb -O reservas_owner reservas_restaurada          # o desde la consola del proveedor
pg_restore --no-owner --role=reservas_owner -d "postgresql://reservas_owner:…/reservas_restaurada" reservas-AAAA-MM-DD.dump
```

Después: apunta `DATABASE_URL` a la BD restaurada y comprueba `/readyz` y el login. **Ensaya la
restauración** al menos una vez antes de abrir y después de cada cambio importante.

## 8. Escalado y límites conocidos

- **Una instancia** basta para muchas barberías (cada consulta tarda ms; ver el coste de RLS en
  [SECURITY](SECURITY.md) §2b).
- Con **varias instancias**: los rate limits son en memoria, así que cada instancia cuenta por
  separado (el límite efectivo se multiplica). Para ajustarlo hace falta Redis (`@fastify/rate-limit`
  lo admite). El bloqueo por intentos fallidos de login también es por instancia. El worker de avisos
  es seguro en varias instancias.
- Las sesiones, citas y avisos están en PostgreSQL: no hay estado en el disco del contenedor.

## 9. Antes de abrir al público

- [ ] HTTPS en el dominio; HTTP redirige a HTTPS.
- [ ] `DATABASE_URL` con `reservas_app` (el servidor no arranca si no) y `sslmode=require`.
- [ ] `TRUST_PROXY` con las IPs de tu balanceador (si no, todos los clientes compartirían la IP del
      balanceador y los rate limits los bloquearían juntos).
- [ ] PITR activado y una restauración ensayada (§7).
- [ ] Contraseñas de BD largas y distintas; solo el servidor puede conectarse a la BD (red privada o
      lista de IPs).
- [ ] Retención de los logs definida (contienen IPs y, en errores 500, pueden contener datos personales).
- [ ] Primer ADMIN creado y contraseña temporal cambiada.
