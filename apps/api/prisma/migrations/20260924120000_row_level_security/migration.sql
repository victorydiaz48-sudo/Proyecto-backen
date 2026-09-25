-- Row-Level Security (Fase 15): defensa en profundidad del aislamiento entre negocios.
--
-- La aplicación se conecta con el rol reservas_app (sin BYPASSRLS y sin ser propietario de las tablas).
-- Cada consulta fija el negocio con set_config('app.tenant_id', …, true) dentro de su transacción; sin
-- negocio fijado, las políticas no dejan ver ni escribir ninguna fila (fallo cerrado).
-- El propietario de las tablas (el usuario de las migraciones) no está sujeto a RLS: no se usa FORCE.

-- El rol es de todo el servidor. Si el usuario de migraciones no puede crear roles (habitual en
-- PostgreSQL gestionado), hay que crearlo antes, una vez: ver docs/SECURITY.md §9.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'reservas_app') THEN
    BEGIN
      CREATE ROLE reservas_app NOLOGIN;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE EXCEPTION 'Falta el rol reservas_app y este usuario no puede crearlo. Créalo una vez como administrador: CREATE ROLE reservas_app LOGIN PASSWORD ''…'';';
    END;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO reservas_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO reservas_app;
DO $$
BEGIN
  -- El historial de migraciones no es de la app (no existe en la BD sombra de `prisma migrate diff`).
  IF to_regclass('"_prisma_migrations"') IS NOT NULL THEN
    REVOKE ALL ON TABLE "_prisma_migrations" FROM reservas_app;
  END IF;
END
$$;
-- Tablas que creen migraciones futuras.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO reservas_app;

-- Negocio de la transacción actual (NULL si no se ha fijado: ninguna política lo acepta).
CREATE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

-- Tablas con tenantId: solo las filas del negocio fijado, al leer y al escribir.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Location', 'User', 'Professional', 'Service', 'ProfessionalService', 'WorkingHour',
                           'TimeBlock', 'Customer', 'Booking', 'AuditLog', 'NotificationOutbox', 'IdempotencyKey']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant())',
      t);
  END LOOP;
END
$$;

-- Session no tiene tenantId: pertenece al negocio de su usuario (User ya está filtrado por RLS).
ALTER TABLE "Session" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Session"
  USING (EXISTS (SELECT 1 FROM "User" u WHERE u.id = "Session"."userId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "User" u WHERE u.id = "Session"."userId"));

-- Tenant: legible sin negocio fijado (la API pública y el login lo buscan por slug; no tiene datos
-- personales); el alta la hace el operador; solo se modifica o borra el propio negocio.
ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON "Tenant" FOR SELECT USING (true);
CREATE POLICY tenant_insert ON "Tenant" FOR INSERT WITH CHECK (true);
CREATE POLICY tenant_update ON "Tenant" FOR UPDATE USING (id = app_current_tenant()) WITH CHECK (id = app_current_tenant());
CREATE POLICY tenant_delete ON "Tenant" FOR DELETE USING (id = app_current_tenant());

-- Únicas dos operaciones que necesitan cruzar negocios, como funciones acotadas (SECURITY DEFINER, se
-- ejecutan con los permisos del propietario):

-- 1) Resolver una cookie de sesión: devuelve SOLO el negocio del token (hay que conocer el token).
CREATE FUNCTION app_session_tenant(p_token_hash text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT u."tenantId" FROM "Session" s JOIN "User" u ON u.id = s."userId" WHERE s."tokenHash" = p_token_hash
  $$;

-- 2) El worker de avisos reclama los avisos vencidos de todos los negocios (FOR UPDATE SKIP LOCKED y
--    plazo de alquiler, igual que antes). El resto del procesamiento se hace con el negocio de cada aviso.
CREATE FUNCTION app_claim_due_notifications(p_now timestamptz, p_lease timestamptz, p_limit integer)
  RETURNS TABLE (id uuid, tenant_id uuid, channel text, payload jsonb, attempts integer)
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    UPDATE "NotificationOutbox" o
       SET attempts = o.attempts + 1, "nextAttemptAt" = p_lease, "updatedAt" = p_now
     WHERE o.id IN (
       SELECT n.id FROM "NotificationOutbox" n
        WHERE n.status = 'PENDING' AND n."nextAttemptAt" <= p_now
        ORDER BY n."nextAttemptAt", n.id
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED)
    RETURNING o.id, o."tenantId", o.channel, o.payload, o.attempts
  $$;

REVOKE ALL ON FUNCTION app_session_tenant(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_claim_due_notifications(timestamptz, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_session_tenant(text) TO reservas_app;
GRANT EXECUTE ON FUNCTION app_claim_due_notifications(timestamptz, timestamptz, integer) TO reservas_app;
