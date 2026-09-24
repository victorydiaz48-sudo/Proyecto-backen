import { useEffect, useState } from 'react';
import { get, patch } from '../api';
import { useI18n } from '../i18n';
import { useSession } from '../session';
import type { Settings } from '../types';
import { ErrorBox, Field, Loading, useAction, useLoad } from '../ui';

const TIMEZONES = [
  'America/Sao_Paulo', 'America/Manaus', 'America/Fortaleza', 'America/Cuiaba', 'America/Rio_Branco',
  'America/Argentina/Buenos_Aires', 'America/Montevideo', 'America/Santiago', 'America/Bogota', 'America/Lima',
  'America/Mexico_City', 'Europe/Madrid', 'Europe/Lisbon', 'America/New_York',
];

export function SettingsPage() {
  const { t } = useI18n();
  const { refresh } = useSession();
  const loaded = useLoad(() => get<Settings>('/admin/settings'), []);
  const [form, setForm] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const action = useAction();
  useEffect(() => {
    if (loaded.data) setForm(loaded.data);
  }, [loaded.data]);

  if (!form) return loaded.error ? <ErrorBox error={loaded.error} /> : <Loading />;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setSaved(false);
    setForm({ ...form, [k]: v });
  };
  const save = () =>
    void action.run(async () => {
      const { slug: _slug, ...body } = form;
      setForm(await patch<Settings>('/admin/settings', body));
      setSaved(true);
      refresh();
    });
  const zones = TIMEZONES.includes(form.timezone) ? TIMEZONES : [form.timezone, ...TIMEZONES];

  return (
    <section>
      <h1>{t.navSettings}</h1>
      <form className="form narrow" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Field label={t.publicLink}><input value={form.slug} readOnly /></Field>
        <Field label={t.businessName}><input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={80} required /></Field>
        <Field label={t.timezone}>
          <select value={form.timezone} onChange={(e) => set('timezone', e.target.value)}>
            {zones.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </Field>
        <div className="grid2">
          <Field label={t.countryCode}><input value={form.defaultCountryCode} onChange={(e) => set('defaultCountryCode', e.target.value)} pattern="[1-9]\d{0,2}" required /></Field>
          <Field label={t.currency}><input value={form.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} pattern="[A-Za-z]{3}" required /></Field>
          <Field label={t.locale}>
            <select value={form.locale} onChange={(e) => set('locale', e.target.value)}>
              <option value="pt-BR">Português (Brasil)</option>
              <option value="pt-PT">Português (Portugal)</option>
              <option value="es-ES">Español (España)</option>
              <option value="es-MX">Español (México)</option>
              <option value="es-AR">Español (Argentina)</option>
            </select>
          </Field>
          <Field label={t.slotInterval}><input type="number" min={5} max={120} value={form.slotIntervalMinutes} onChange={(e) => set('slotIntervalMinutes', Number(e.target.value))} /></Field>
          <Field label={t.leadMinutes}><input type="number" min={0} max={10080} value={form.bookingLeadMinutes} onChange={(e) => set('bookingLeadMinutes', Number(e.target.value))} /></Field>
          <Field label={t.horizonDays}><input type="number" min={1} max={365} value={form.bookingHorizonDays} onChange={(e) => set('bookingHorizonDays', Number(e.target.value))} /></Field>
        </div>
        <Field label={t.defaultStatus}>
          <select value={form.defaultBookingStatus} onChange={(e) => set('defaultBookingStatus', e.target.value as Settings['defaultBookingStatus'])}>
            <option value="CONFIRMED">{t.status_CONFIRMED}</option>
            <option value="PENDING">{t.status_PENDING}</option>
          </select>
        </Field>
        <ErrorBox error={action.error} />
        <div className="form-actions">
          {saved ? <span className="ok">{t.saved}</span> : null}
          <button type="submit" disabled={action.busy}>{t.save}</button>
        </div>
      </form>
    </section>
  );
}
