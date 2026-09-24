import { useState } from 'react';
import { del, get, patch, post, qs } from '../api';
import { useI18n } from '../i18n';
import type { Location, Page } from '../types';
import { ErrorBox, Field, Loading, Modal, useAction, useLoad } from '../ui';

export function LocationsPage() {
  const { t } = useI18n();
  const [includeInactive, setIncludeInactive] = useState(false);
  const list = useLoad(() => get<Page<Location>>(`/admin/locations${qs({ includeInactive })}`).then((p) => p.items), [includeInactive]);
  const [editing, setEditing] = useState<Location | 'new' | null>(null);
  const action = useAction();

  return (
    <section>
      <header className="page-header">
        <h1>{t.navLocations}</h1>
        <div className="toolbar">
          <label className="check"><input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} /> {t.showInactive}</label>
          <button type="button" onClick={() => setEditing('new')}>{t.new}</button>
        </div>
      </header>
      <ErrorBox error={action.error ?? list.error} />
      {list.loading ? <Loading /> : (
        <table>
          <thead><tr><th>{t.name}</th><th>{t.address}</th><th>{t.whatsapp}</th><th /></tr></thead>
          <tbody>
            {(list.data ?? []).map((l) => (
              <tr key={l.id} className={l.active ? '' : 'inactive'}>
                <td>{l.name}{l.isDefault ? ` · ${t.isDefault}` : ''}{l.active ? '' : ` (${t.inactive})`}</td>
                <td>{l.address ?? ''}</td>
                <td>{l.whatsapp ?? ''}</td>
                <td className="row-actions">
                  <button type="button" className="ghost small" onClick={() => setEditing(l)}>{t.edit}</button>
                  {!l.isDefault && l.active ? (
                    <>
                      <button type="button" className="ghost small" disabled={action.busy}
                        onClick={() => void action.run(async () => { await patch(`/admin/locations/${l.id}`, { isDefault: true }); list.reload(); })}>{t.makeDefault}</button>
                      <button type="button" className="ghost small" disabled={action.busy}
                        onClick={() => void action.run(async () => { await del(`/admin/locations/${l.id}`); list.reload(); })}>{t.archive}</button>
                    </>
                  ) : null}
                  {!l.active ? (
                    <button type="button" className="ghost small" disabled={action.busy}
                      onClick={() => void action.run(async () => { await patch(`/admin/locations/${l.id}`, { active: true }); list.reload(); })}>{t.activate}</button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing ? <LocationForm location={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); list.reload(); }} /> : null}
    </section>
  );
}

function LocationForm({ location, onClose, onDone }: { location: Location | null; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(location?.name ?? '');
  const [address, setAddress] = useState(location?.address ?? '');
  const [mapsUrl, setMapsUrl] = useState(location?.mapsUrl ?? '');
  const [whatsapp, setWhatsapp] = useState(location?.whatsapp ?? '');
  const action = useAction();
  const save = async () => {
    const body = { name, address, mapsUrl: mapsUrl.trim() || null, whatsapp };
    const ok = await action.run(() => (location ? patch(`/admin/locations/${location.id}`, body) : post('/admin/locations', body)));
    if (ok) onDone();
  };
  return (
    <Modal title={location ? t.edit : t.new} onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Field label={t.name}><input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required /></Field>
        <Field label={`${t.address} (${t.optional})`}><input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} /></Field>
        <Field label={`${t.mapsUrl} (${t.optional})`}><input type="url" value={mapsUrl} onChange={(e) => setMapsUrl(e.target.value)} placeholder="https://" /></Field>
        <Field label={`${t.whatsapp} (${t.optional})`}><input type="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} maxLength={40} /></Field>
        <ErrorBox error={action.error} />
        <div className="form-actions">
          <button type="button" className="ghost" onClick={onClose}>{t.cancel}</button>
          <button type="submit" disabled={action.busy}>{t.save}</button>
        </div>
      </form>
    </Modal>
  );
}
