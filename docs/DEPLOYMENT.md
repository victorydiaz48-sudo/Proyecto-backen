# Despliegue (Fase 16)

Un único servicio HTTP (API + panel en el mismo origen) sobre PostgreSQL 16. Todo lo de esta guía está
probado: el job `docker` de CI construye las imágenes y repite la instalación completa en cada push.

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
- Dos usuarios de base de datos (ver §4): el **propietario** del esquema, para migrar, y
  **`reservas_app`**, para la app, sujeto a Row-Level Security.

## 2. Imágenes

Un solo `Dockerfile`, dos objetivos:

| Imagen | Para qué | Contenido |
|---|---|---|
| `runtime` (por defecto) | el servidor | Node 22 slim, JavaScript compilado, panel compilado, solo dependencias de producción. Usuario sin privilegios, `HEALTHCHECK` incluido. **Sin** la herramienta de línea de comandos de Prisma. |
| `migrate` | aplicar migraciones en cada versión | la herramienta de Prisma + migraciones. Se ejecuta y termina. |

```bash
docker build --target runtime -t reservas:1.0.0 .
docker build --target migrate -t reservas-migrate:1.0.0 .
```

Detrás de un proxy corporativo que inspecciona TLS, pasa su CA en el build:
`--secret id=ca,src=ruta/ca.pem` (no queda en la imagen).

Comandos de la imagen `runtime`: `serve` (por defecto), `tenant-create …`, `import-generator …`.

## 3. Variables de entorno

| Variable | Imagen | Obligatoria | Valor |
|---|---|---|---|
| `DATABASE_URL` | runtime | sí | `postgresql://reservas_app:…@host:5432/db?sslmode=require`. **Nunca** el propietario: en producción el servidor no arranca si la conexión se salta RLS. |
| `MIGRATION_DATABASE_URL` | migrate | sí | el propietario del esquema. Solo la usa la imagen de migraciones. |
| `TRUST_PROXY` | runtime | detrás de un proxy | IPs/CIDR de **tus** proxies, separadas por comas, o `uniquelocal` si el balanceador llega desde una red privada (10/8, 172.16/12, 192.168/16). `true` está prohibido (permitiría falsear la IP y saltarse los rate limits). Por defecto `false`. |
| `PORT` / `HOST` | runtime | no | `3000` / `0.0.0.0` |
| `LOG_LEVEL` | runtime | no | `info` (JSON por la salida estándar) |
| `NOTIFICATIONS_WORKER` | runtime | no | `true`. Con varias réplicas puede quedarse en todas (no duplican avisos) o activarse en una sola. |
| `NOTIFICATIONS_TRANSPORT` | runtime | no | `log` (opción C: los avisos se ven en el panel y se envían a mano) |
| `NODE_ENV` | ambas | — | la imagen ya trae `production` |
| `COOKIE_SECURE` | runtime | — | siempre `true` en producción (no se puede desactivar) |

No hay más secretos: las sesiones son tokens aleatorios guardados como hash, no se firman con una clave.

## 4. Primera instalación

**1. Base de datos y usuarios.** Como administrador de PostgreSQL:

```sql
CREATE DATABASE reservas;
-- El propietario (si tu proveedor ya te da uno, úsalo y sáltate esta línea).
CREATE ROLE reservas_owner LOGIN PASSWORD '<contraseña larga>';
ALTER DATABASE reservas OWNER TO reservas_owner;
-- La app: sin BYPASSRLS y sin ser propietario. Los permisos se los da la migración.
CREATE ROLE reservas_app LOGIN PASSWORD '<otra contraseña larga>';
```

Si el propietario puede crear roles, la migración crea `reservas_app` sin login; en ese caso actívalo
después con `ALTER ROLE reservas_app LOGIN PASSWORD '…';`.

**2. Migraciones:**

```bash
docker run --rm -e MIGRATION_DATABASE_URL='postgresql://reservas_owner:…@host:5432/reservas?sslmode=require' \
  reservas-migrate:1.0.0
```

**3. Primer negocio**, con su ADMIN:

```bash
docker run --rm -e DATABASE_URL='postgresql://reservas_app:…' reservas:1.0.0 tenant-create \
  --slug barbearia-central --name "Barbearia Central" --timezone America/Sao_Paulo --country 55 \
  --currency BRL --locale pt-BR --admin-email dono@exemplo.com
```

Imprime una contraseña temporal una sola vez; el ADMIN la cambia en *Cuenta*. Para no generarla,
pasa `-e TENANT_ADMIN_PASSWORD=…`. Para crear el negocio a partir del JSON exportado por el generador:

```bash
docker run --rm -v "$PWD/datos.json:/datos.json:ro" -e DATABASE_URL='postgresql://reservas_app:…' \
  reservas:1.0.0 import-generator --file /datos.json --slug barbearia-central --admin-email dono@exemplo.com --dry-run
```

(sin `--dry-run` para guardar; ver [FRONTEND_INTEGRATION](FRONTEND_INTEGRATION.md) §4).

**4. Servidor:**

```bash
docker run -d --name reservas -p 3000:3000 \
  -e DATABASE_URL='postgresql://reservas_app:…' -e TRUST_PROXY='uniquelocal' reservas:1.0.0
```

**5. Comprobación:** `https://tu-dominio/readyz` → `{"status":"ok"}`; `https://tu-dominio/` abre el panel.

**6. Páginas del generador:** en "Reservas en línea", *Dirección del sistema de reservas* =
`https://tu-dominio` e *Identificador* = el slug; "Probar conexión".

## 5. Cada nueva versión

1. Construir las dos imágenes con la misma etiqueta.
2. **Migrar primero** con `reservas-migrate:<versión>` (si falla, no se despliega nada).
3. Desplegar `reservas:<versión>`. Con varias réplicas, de una en una: la plataforma espera a que
   `/readyz` responda antes de retirar la anterior.
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
