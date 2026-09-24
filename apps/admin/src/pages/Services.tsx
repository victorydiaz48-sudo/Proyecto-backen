import { useState } from 'react';
import { del, get, patch, post, qs } from '../api';
import { money, parseMoney } from '../format';
import { useI18n } from '../i18n';
import { useSession } from '../session';
import type { Page, Service } from '../types';
import { ErrorBox, Field, Loading, Modal, useAction, useLoad } from '../ui';

export function ServicesPage() {
  const { t, lang } = useI18n();
  const { me } = useSession();
  const [includeInactive, setIncludeInactive] = useState(false);
  const list = useLoad(() => get<Page<Service>>(`/admin/services${qs({ includeInactive })}`).then((p) => p.items), [includeInactive]);
  const [editing, setEditing] = useState<Service | 'new' | null>(null);
  const action = useAction();

  return (
    <section>
      <header className="page-header">
        <h1>{t.navServices}</h1>
        <div className="toolbar">
          <label className="check"><input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} /> {t.showInactive}</label>
          <button type="button" onClick={() => setEditing('new')}>{t.new}</button>
        </div>
      </header>
      <ErrorBox error={action.error ?? list.error} />
      {list.loading ? <Loading /> : (
        <div className="table-wrap">
<table>
          <thead><tr><th>{t.name}</th><th>{t.category}</th><th>{t.duration}</th><th>{t.buffer}</th><th>{t.price}</th><th /></tr></thead>
          <tbody>
            {(list.data ?? []).map((s) => (
              <tr key={s.id} className={s.active ? '' : 'inactive'}>
                <td>{s.name}{s.active ? '' : ` (${t.inactive})`}</td>
                <td>{s.category ?? ''}</td>
                <td>{s.durationMinutes}</td>
                <td>{s.bufferAfterMinutes}</td>
                <td>{money(s.priceCents, me.tenant.currency, lang)}</td>
                <td className="row-actions">
                  <button type="button" className="ghost small" onClick={() => setEditing(s)}>{t.edit}</button>
                  {s.active ? (
                    <button type="button" className="ghost small" disabled={action.busy}
                      onClick={() => void action.run(async () => { await del(`/admin/services/${s.id}`); list.reload(); })}>{t.archive}</button>
                  ) : (
                    <button type="button" className="ghost small" disabled={action.busy}
                      onClick={() => void action.run(async () => { await patch(`/admin/services/${s.id}`, { active: true }); list.reload(); })}>{t.activate}</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
</div>
      )}
      {editing ? <ServiceForm service={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); list.reload(); }} /> : null}
    </section>
  );
}

function ServiceForm({ service, onClose, onDone }: { service: Service | null; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(service?.name ?? '');
  const [category, setCategory] = useState(service?.category ?? '');
  const [description, setDescription] = useState(service?.description ?? '');
  const [duration, setDuration] = useState(String(service?.durationMinutes ?? 30));
  const [buffer, setBuffer] = useState(String(service?.bufferAfterMinutes ?? 0));
  const [price, setPrice] = useState(service ? (service.priceCents / 100).toFixed(2).replace('.', ',') : '');
  const [sortOrder, setSortOrder] = useState(String(service?.sortOrder ?? 0));
  const action = useAction();
  const cents = parseMoney(price);

  const save = async () => {
    const body = {
      name,
      category,
      description,
      durationMinutes: Number(duration),
      bufferAfterMinutes: Number(buffer),
      priceCents: cents ?? -1,
      sortOrder: Number(sortOrder),
    };
    const ok = await action.run(() => (service ? patch(`/admin/services/${service.id}`, body) : post('/admin/services', body)));
    if (ok) onDone();
  };

  return (
    <Modal title={service ? t.edit : t.new} onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Field label={t.name}><input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required /></Field>
        <div className="grid2">
          <Field label={t.duration}><input type="number" min={5} max={600} value={duration} onChange={(e) => setDuration(e.target.value)} required /></Field>
          <Field label={t.buffer}><input type="number" min={0} max={120} value={buffer} onChange={(e) => setBuffer(e.target.value)} /></Field>
          <Field label={t.price}><input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} required aria-invalid={cents === null} /></Field>
          <Field label={t.order}><input type="number" min={0} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></Field>
        </div>
        <Field label={`${t.category} (${t.optional})`}><input value={category} onChange={(e) => setCategory(e.target.value)} maxLength={40} /></Field>
        <Field label={`${t.description} (${t.optional})`}><textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} rows={2} /></Field>
        <ErrorBox error={action.error} />
        <div className="form-actions">
          <button type="button" className="ghost" onClick={onClose}>{t.cancel}</button>
          <button type="submit" disabled={action.busy || cents === null}>{t.save}</button>
        </div>
      </form>
    </Modal>
  );
}
