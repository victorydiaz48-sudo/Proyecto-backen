-- Reglas que Prisma no puede expresar en schema.prisma. Ver docs/DATABASE.md.
-- test/db-constraints.test.ts comprueba que todas siguen existiendo.

-- ─── Doble reserva ────────────────────────────────────────────────────────────
-- Un profesional no puede tener dos citas activas que se solapen. Intervalo semiabierto [start, end):
-- una cita que termina a las 10:00 no choca con otra que empieza a las 10:00.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_no_overlap"
  EXCLUDE USING gist (
    "professionalId" WITH =,
    tstzrange("startAt", "endAt", '[)') WITH &&
  ) WHERE (status IN ('PENDING', 'CONFIRMED'));

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_time_order_check" CHECK ("startAt" < "endAt"),
  ADD CONSTRAINT "Booking_end_covers_duration_check"
    CHECK ("endAt" >= "startAt" + make_interval(mins => "durationMinutesSnapshot")),
  ADD CONSTRAINT "Booking_price_check" CHECK ("priceCentsSnapshot" >= 0),
  ADD CONSTRAINT "Booking_duration_check" CHECK ("durationMinutesSnapshot" BETWEEN 5 AND 600),
  ADD CONSTRAINT "Booking_currency_check" CHECK ("currencySnapshot" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "Booking_notes_length_check" CHECK (char_length("customerNotes") <= 300);

-- ─── Tenant ───────────────────────────────────────────────────────────────────
ALTER TABLE "Tenant"
  ADD CONSTRAINT "Tenant_slug_format_check" CHECK ("slug" ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  ADD CONSTRAINT "Tenant_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "Tenant_country_code_check" CHECK ("defaultCountryCode" ~ '^[1-9][0-9]{0,2}$'),
  ADD CONSTRAINT "Tenant_slot_interval_check" CHECK ("slotIntervalMinutes" BETWEEN 5 AND 120),
  ADD CONSTRAINT "Tenant_lead_check" CHECK ("bookingLeadMinutes" BETWEEN 0 AND 10080),
  ADD CONSTRAINT "Tenant_horizon_check" CHECK ("bookingHorizonDays" BETWEEN 1 AND 365),
  ADD CONSTRAINT "Tenant_default_status_check" CHECK ("defaultBookingStatus" IN ('PENDING', 'CONFIRMED'));

-- ─── Location ─────────────────────────────────────────────────────────────────
-- Exactamente un local por defecto por tenant (como máximo aquí; "al menos uno" lo garantiza la app).
CREATE UNIQUE INDEX "Location_one_default_per_tenant" ON "Location" ("tenantId") WHERE "isDefault";

-- ─── User ─────────────────────────────────────────────────────────────────────
-- El email se guarda normalizado en minúsculas; así el @@unique([tenantId, email]) no distingue mayúsculas.
ALTER TABLE "User" ADD CONSTRAINT "User_email_lowercase_check" CHECK ("email" = lower("email"));

-- ─── Service ──────────────────────────────────────────────────────────────────
ALTER TABLE "Service"
  ADD CONSTRAINT "Service_duration_check" CHECK ("durationMinutes" BETWEEN 5 AND 600),
  ADD CONSTRAINT "Service_buffer_check" CHECK ("bufferAfterMinutes" BETWEEN 0 AND 120),
  ADD CONSTRAINT "Service_price_check" CHECK ("priceCents" >= 0);
-- Nombre único entre los servicios activos del tenant (los archivados pueden repetirlo).
CREATE UNIQUE INDEX "Service_active_name_per_tenant" ON "Service" ("tenantId", lower("name")) WHERE "active";

-- ─── WorkingHour ──────────────────────────────────────────────────────────────
ALTER TABLE "WorkingHour"
  ADD CONSTRAINT "WorkingHour_weekday_check" CHECK ("weekday" BETWEEN 0 AND 6),
  ADD CONSTRAINT "WorkingHour_range_check" CHECK ("startMinute" >= 0 AND "startMinute" < "endMinute" AND "endMinute" <= 1440);

-- ─── TimeBlock ────────────────────────────────────────────────────────────────
ALTER TABLE "TimeBlock" ADD CONSTRAINT "TimeBlock_time_order_check" CHECK ("startAt" < "endAt");

-- ─── Customer ─────────────────────────────────────────────────────────────────
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_phone_e164_check" CHECK ("phoneE164" ~ '^\+[1-9][0-9]{6,14}$');
