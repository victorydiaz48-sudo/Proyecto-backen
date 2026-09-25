import { useState, type FormEvent } from 'react';
import { del, get, post, qs } from '../api';
import { addDays, dateTimeLabel, localDate, zonedIso } from '../format';
import { useI18n } from '../i18n';
import { isAdmin, useSession } from '../session';
import type { Location, Page, Professional, TimeBlock } from '../types';
import { ErrorBox, Field, Loading, Modal, useAction, useLoad } from '../ui';

export function BlocksPage() {
  const { t, lang } = useI18n();
  const { me } = useSession();
  const tz = me.tenant.timezone;
  const admin = isAdmin(me);
  const blocks = useLoad(() => get<Page<TimeBlock>>(`/admin/time-blocks${qs({ from: new Date().toISOString() })}`).then((p) => p.items), []);
  const pros = useLoad(() => get<Page<Professional>>('/admin/professionals').then((p) => p.items), []);
  const locations = useLoad(() => get<Page<Location>>('/admin/locations').then((p) => p.items), []);
  const [creating, setCreating] = useState(false);
  const action = useAction();

  const proName = (id: string | null) => (id ? (pros.data?.find((p) => p.id === id)?.displayName ?? '—') : t.allProfessionals);
  const locName = (id: string | null) => (id ? (locations.data?.find((l) => l.id === id)?.name ?? '—') : t.allLocations);
  const canDelete = (b: TimeBlock) => admin || b.professionalId === me.user.professionalId;
  if (!admin && !me.user.professionalId) {
    return (
      <section>
        <h1>{t.navBlocks}</h1>
        <p className="notice">{t.unlinked}</p>
      </section>
    );
  }

  return (
    <section>
      <header className="page-header">
        <h1>{t.navBlocks}</h1>
        <button type="button" onClick={() => setCreating(true)}>{t.newBlock}</button>
      </header>
      <ErrorBox error={action.error ?? blocks.error} />
      {blocks.loading ? <Loading /> : (
        <div className="table-wrap">
<table>
          <thead><tr><th>{t.start}</th><th>{t.end}</th><th>{t.professional}</th><th>{t.location}</th><th>{t.reason}</th><th /></tr></thead>
          <tbody>
            {(blocks.data ?? []).map((b) => (
              <tr key={b.id}>
                <td>{dateTimeLabel(b.startAt, tz, lang)}</td>
                <td>{dateTimeLabel(b.endAt, tz, lang)}</td>
                <td>{proName(b.professionalId)}</td>
                <td>{locName(b.locationId)}</td>
                <td>{b.reason ?? ''}</td>
                <td>
                  {canDelete(b) ? (
                    <button type="button" className="ghost small" disabled={action.busy}
                      onClick={() => void action.run(async () => { await del(`/admin/time-blocks/${b.id}`); blocks.reload(); })}>
                      {t.delete}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
</div>
      )}
      {creating ? (
        <BlockForm
          tz={tz}
          admin={admin}
          professionals={pros.data ?? []}
          locations={locations.data ?? []}
          onClose={() => setCreating(false)}
          onDone={() => { setCreating(false); blocks.reload(); }}
        />
      ) : null}
    </section>
  );
}

function BlockForm({ tz, admin, professionals, locations, onClose, onDone }: {
  tz: string; admin: boolean; professionals: Professional[]; locations: Location[]; onClose: () => void; onDone: () => void;
}) {
  const { t } = useI18n();
  const today = localDate(new Date(), tz);
  const [professionalId, setProfessionalId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [startTime, setStartTime] = useState('12:00');
  const [endDate, setEndDate] = useState(today);
  const [endTime, setEndTime] = useState('13:00');
  const [reason, setReason] = useState('');
  const action = useAction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await action.run(() =>
      post('/admin/time-blocks', {
        ...(admin ? { professionalId: professionalId || null, locationId: locationId || null } : {}),
        startAt: zonedIso(startDate, startTime, tz),
        endAt: zonedIso(endDate, endTime, tz),
        ...(reason ? { reason } : {}),
      }),
    );
    if (ok) onDone();
  };

  return (
    <Modal title={t.newBlock} onClose={onClose}>
      <form className="form" onSubmit={(e) => void submit(e)}>
        {admin ? (
          <>
            <Field label={t.professional}>
              <select value={professionalId} onChange={(e) => setProfessionalId(e.target.value)}>
                <option value="">{t.allProfessionals}</option>
                {professionals.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
              </select>
            </Field>
            <Field label={t.location}>
              <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">{t.allLocations}</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Field>
          </>
        ) : null}
        <div className="grid2">
          <Field label={t.start}><input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); if (e.target.value > endDate) setEndDate(e.target.value); }} required /></Field>
          <Field label={t.time}><input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required /></Field>
          <Field label={t.end}><input type="date" value={endDate} min={startDate} max={addDays(startDate, 366)} onChange={(e) => setEndDate(e.target.value)} required /></Field>
          <Field label={t.time}><input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required /></Field>
        </div>
        <Field label={`${t.reason} (${t.optional})`}><input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} /></Field>
        <ErrorBox error={action.error} />
        <div className="form-actions">
          <button type="button" className="ghost" onClick={onClose}>{t.cancel}</button>
          <button type="submit" disabled={action.busy}>{t.save}</button>
        </div>
      </form>
    </Modal>
  );
}
