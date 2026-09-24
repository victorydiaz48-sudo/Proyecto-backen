import { useState } from 'react';
import { del, get, patch, post, put, qs } from '../api';
import { useI18n } from '../i18n';
import type { Page, Professional, Service } from '../types';
import { ErrorBox, Field, Loading, Modal, useAction, useLoad } from '../ui';
import { HoursEditor } from './HoursEditor';

export function ProfessionalsPage() {
  const { t } = useI18n();
  const [includeInactive, setIncludeInactive] = useState(false);
  const list = useLoad(() => get<Page<Professional>>(`/admin/professionals${qs({ includeInactive })}`).then((p) => p.items), [includeInactive]);
  const services = useLoad(() => get<Page<Service>>('/admin/services').then((p) => p.items), []);
  const [editing, setEditing] = useState<Professional | 'new' | null>(null);
  const [hoursOf, setHoursOf] = useState<Professional | null>(null);
  const action = useAction();
  const svcName = (id: string) => services.data?.find((s) => s.id === id)?.name;

  return (
    <section>
      <header className="page-header">
        <h1>{t.navProfessionals}</h1>
        <div className="toolbar">
          <label className="check"><input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} /> {t.showInactive}</label>
          <button type="button" onClick={() => setEditing('new')}>{t.new}</button>
        </div>
      </header>
      <ErrorBox error={action.error ?? list.error ?? services.error} />
      {list.loading ? <Loading /> : (
        <table>
          <thead><tr><th>{t.displayName}</th><th>{t.title}</th><th>{t.servicesOffered}</th><th /></tr></thead>
          <tbody>
            {(list.data ?? []).map((p) => (
              <tr key={p.id} className={p.active ? '' : 'inactive'}>
                <td>{p.displayName}{p.active ? '' : ` (${t.inactive})`}</td>
                <td>{p.title ?? ''}</td>
                <td className="small">{p.serviceIds.map(svcName).filter(Boolean).join(', ') || '—'}</td>
                <td className="row-actions">
                  <button type="button" className="ghost small" onClick={() => setEditing(p)}>{t.edit}</button>
                  <button type="button" className="ghost small" onClick={() => setHoursOf(p)}>{t.workingHours}</button>
                  {p.active ? (
                    <button type="button" className="ghost small" disabled={action.busy}
                      onClick={() => void action.run(async () => { await del(`/admin/professionals/${p.id}`); list.reload(); })}>{t.archive}</button>
                  ) : (
                    <button type="button" className="ghost small" disabled={action.busy}
                      onClick={() => void action.run(async () => { await patch(`/admin/professionals/${p.id}`, { active: true }); list.reload(); })}>{t.activate}</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing ? (
        <ProfessionalForm
          professional={editing === 'new' ? null : editing}
          services={services.data ?? []}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); list.reload(); }}
        />
      ) : null}
      {hoursOf ? (
        <Modal title={`${t.workingHours} · ${hoursOf.displayName}`} onClose={() => setHoursOf(null)}>
          <HoursEditor professionalId={hoursOf.id} />
        </Modal>
      ) : null}
    </section>
  );
}

function ProfessionalForm({ professional, services, onClose, onDone }: {
  professional: Professional | null; services: Service[]; onClose: () => void; onDone: () => void;
}) {
  const { t } = useI18n();
  const [displayName, setDisplayName] = useState(professional?.displayName ?? '');
  const [title, setTitle] = useState(professional?.title ?? '');
  const [bio, setBio] = useState(professional?.bio ?? '');
  const [photoUrl, setPhotoUrl] = useState(professional?.photoUrl ?? '');
  const [sortOrder, setSortOrder] = useState(String(professional?.sortOrder ?? 0));
  const [serviceIds, setServiceIds] = useState<string[]>(professional?.serviceIds ?? services.map((s) => s.id));
  const action = useAction();
  const toggle = (id: string) => setServiceIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const save = async () => {
    const fields = { displayName, title, bio, photoUrl: photoUrl.trim() || null, sortOrder: Number(sortOrder) };
    const ok = await action.run(async () => {
      if (professional) {
        await patch(`/admin/professionals/${professional.id}`, fields);
        await put(`/admin/professionals/${professional.id}/services`, { serviceIds });
      } else {
        await post('/admin/professionals', { ...fields, serviceIds });
      }
    });
    if (ok) onDone();
  };

  return (
    <Modal title={professional ? t.edit : t.new} onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Field label={t.displayName}><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={80} required /></Field>
        <Field label={`${t.title} (${t.optional})`}><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} /></Field>
        <Field label={`${t.bio} (${t.optional})`}><textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={400} rows={2} /></Field>
        <Field label={`${t.photoUrl} (${t.optional})`}><input type="url" value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="https://" /></Field>
        <Field label={t.order}><input type="number" min={0} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></Field>
        <fieldset>
          <legend>{t.servicesOffered}</legend>
          {services.map((s) => (
            <label key={s.id} className="check">
              <input type="checkbox" checked={serviceIds.includes(s.id)} onChange={() => toggle(s.id)} /> {s.name}
            </label>
          ))}
        </fieldset>
        <ErrorBox error={action.error} />
        <div className="form-actions">
          <button type="button" className="ghost" onClick={onClose}>{t.cancel}</button>
          <button type="submit" disabled={action.busy}>{t.save}</button>
        </div>
      </form>
    </Modal>
  );
}
