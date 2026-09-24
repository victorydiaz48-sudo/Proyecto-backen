import { useState } from 'react';
import { get, patch, post, qs } from '../api';
import { useI18n } from '../i18n';
import { isAdmin, useSession } from '../session';
import type { Customer, Page } from '../types';
import { ErrorBox, Field, Loading, Modal, useAction, useLoad } from '../ui';

export function CustomersPage() {
  const { t } = useI18n();
  const { me } = useSession();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [extra, setExtra] = useState<{ items: Customer[]; next: string | null } | null>(null);
  const page = useLoad(() => get<Page<Customer>>(`/admin/customers${qs({ search: query, limit: 50 })}`), [query]);
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);
  const action = useAction();

  const items = [...(page.data?.items ?? []), ...(extra?.items ?? [])];
  const next = extra ? extra.next : (page.data?.nextCursor ?? null);
  const loadMore = () =>
    void action.run(async () => {
      const p = await get<Page<Customer>>(`/admin/customers${qs({ search: query, limit: 50, cursor: next })}`);
      setExtra({ items: [...(extra?.items ?? []), ...p.items], next: p.nextCursor ?? null });
    });

  return (
    <section>
      <header className="page-header">
        <h1>{t.navCustomers}</h1>
        <form className="toolbar" onSubmit={(e) => { e.preventDefault(); setExtra(null); setQuery(search.trim()); }}>
          <input type="search" placeholder={t.searchCustomers} value={search} onChange={(e) => setSearch(e.target.value)} aria-label={t.search} />
          <button type="submit" className="ghost">{t.search}</button>
          {isAdmin(me) ? <button type="button" onClick={() => setEditing('new')}>{t.new}</button> : null}
        </form>
      </header>
      <ErrorBox error={action.error ?? page.error} />
      {page.loading ? <Loading /> : (
        <table>
          <thead><tr><th>{t.name}</th><th>{t.phone}</th><th>{t.email}</th><th>{t.notes}</th><th /></tr></thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td><a href={`tel:${c.phoneE164}`}>{c.phoneE164}</a></td>
                <td>{c.email ?? ''}</td>
                <td className="muted">{c.notes ?? ''}</td>
                <td>{isAdmin(me) ? <button type="button" className="ghost small" onClick={() => setEditing(c)}>{t.edit}</button> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {next ? <button type="button" className="ghost" onClick={loadMore} disabled={action.busy}>{t.more}</button> : null}
      {editing ? (
        <CustomerForm
          customer={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); setExtra(null); page.reload(); }}
        />
      ) : null}
    </section>
  );
}

function CustomerForm({ customer, onClose, onDone }: { customer: Customer | null; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(customer?.name ?? '');
  const [phone, setPhone] = useState(customer?.phoneE164 ?? '');
  const [email, setEmail] = useState(customer?.email ?? '');
  const [notes, setNotes] = useState(customer?.notes ?? '');
  const action = useAction();
  const save = async () => {
    const body = { name, phone, email, notes };
    const ok = await action.run(() => (customer ? patch(`/admin/customers/${customer.id}`, body) : post('/admin/customers', body)));
    if (ok) onDone();
  };
  return (
    <Modal title={customer ? t.edit : t.new} onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Field label={t.name}><input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required /></Field>
        <Field label={t.phone}><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} required /></Field>
        <Field label={`${t.email} (${t.optional})`}><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label={`${t.notes} (${t.optional})`}><textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} rows={3} /></Field>
        <ErrorBox error={action.error} />
        <div className="form-actions">
          <button type="button" className="ghost" onClick={onClose}>{t.cancel}</button>
          <button type="submit" disabled={action.busy}>{t.save}</button>
        </div>
      </form>
    </Modal>
  );
}
