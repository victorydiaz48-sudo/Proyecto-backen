import { useState } from 'react';
import { get, put } from '../api';
import { useI18n } from '../i18n';
import type { Location, Page, WorkingInterval } from '../types';
import { ErrorBox, Loading, useAction, useLoad } from '../ui';

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Horario semanal de un profesional: varios intervalos por día, cada uno en un local. */
export function HoursEditor({ professionalId, readOnly = false }: { professionalId: string; readOnly?: boolean }) {
  const { t } = useI18n();
  const hours = useLoad(() => get<Page<WorkingInterval>>(`/admin/professionals/${professionalId}/working-hours`).then((p) => p.items), [professionalId]);
  const locations = useLoad(() => get<Page<Location>>('/admin/locations').then((p) => p.items), []);
  const [draft, setDraft] = useState<WorkingInterval[] | null>(null);
  const action = useAction();
  const [saved, setSaved] = useState(false);

  if (hours.loading || locations.loading) return <Loading />;
  const list = draft ?? hours.data ?? [];
  const locs = locations.data ?? [];
  const defaultLoc = locs.find((l) => l.isDefault)?.id ?? locs[0]?.id ?? '';
  const multiLocation = locs.length > 1;

  const update = (i: number, change: Partial<WorkingInterval>) => {
    setSaved(false);
    setDraft(list.map((x, k) => (k === i ? { ...x, ...change } : x)));
  };
  const add = (weekday: number) => {
    setSaved(false);
    setDraft([...list, { weekday, start: '09:00', end: '18:00', locationId: defaultLoc }]);
  };
  const remove = (i: number) => {
    setSaved(false);
    setDraft(list.filter((_, k) => k !== i));
  };
  const save = () =>
    void action.run(async () => {
      await put(`/admin/professionals/${professionalId}/working-hours`, {
        intervals: list.map(({ locationId, weekday, start, end }) => ({ locationId, weekday, start, end })),
      });
      setDraft(null);
      setSaved(true);
      hours.reload();
    });

  return (
    <div className="hours">
      <ErrorBox error={action.error ?? hours.error ?? locations.error} />
      {!readOnly ? <p className="muted small">{t.hoursHint}</p> : null}
      {DAY_ORDER.map((wd) => {
        const rows = list.map((x, i) => ({ x, i })).filter(({ x }) => x.weekday === wd);
        return (
          <div className="hours-day" key={wd}>
            <strong>{t.weekdays[wd]}</strong>
            <div>
              {rows.length === 0 ? <span className="muted">—</span> : null}
              {rows.map(({ x, i }) =>
                readOnly ? (
                  <div key={i}>{x.start}–{x.end}{multiLocation ? ` · ${locs.find((l) => l.id === x.locationId)?.name ?? ''}` : ''}</div>
                ) : (
                  <div className="hours-row" key={i}>
                    {/* Texto HH:MM (24 h) en lugar de type=time: igual en cualquier navegador y admite 24:00. */}
                    <input aria-label={t.from} value={x.start} inputMode="numeric" pattern="([01]\d|2[0-3]):[0-5]\d" placeholder="09:00" size={5} onChange={(e) => update(i, { start: e.target.value })} />
                    <span>–</span>
                    <input aria-label={t.to} value={x.end} inputMode="numeric" pattern="([01]\d|2[0-3]):[0-5]\d|24:00" placeholder="18:00" size={5} onChange={(e) => update(i, { end: e.target.value })} />
                    {multiLocation ? (
                      <select aria-label={t.location} value={x.locationId} onChange={(e) => update(i, { locationId: e.target.value })}>
                        {locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>
                    ) : null}
                    <button type="button" className="ghost small" onClick={() => remove(i)} aria-label={t.delete}>×</button>
                  </div>
                ),
              )}
              {!readOnly ? <button type="button" className="ghost small" onClick={() => add(wd)}>+ {t.addInterval}</button> : null}
            </div>
          </div>
        );
      })}
      {!readOnly ? (
        <div className="form-actions">
          {saved ? <span className="ok">{t.saved}</span> : null}
          <button type="button" onClick={save} disabled={action.busy || draft === null}>{t.save}</button>
        </div>
      ) : null}
    </div>
  );
}
