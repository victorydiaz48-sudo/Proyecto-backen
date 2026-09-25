import { useState } from 'react';
import { get, patch, post } from '../api';
import { dateTimeLabel } from '../format';
import { useI18n } from '../i18n';
import { useSession } from '../session';
import type { Page, Professional, Role, User } from '../types';
import { ErrorBox, Field, Loading, Modal, useAction, useLoad } from '../ui';

export function UsersPage() {
  const { t, lang } = useI18n();
  const { me } = useSession();
  const users = useLoad(() => get<Page<User>>('/admin/users').then((p) => p.items), []);
  const pros = useLoad(() => get<Page<Professional>>('/admin/professionals').then((p) => p.items), []);
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);
  const action = useAction();

  const setField = (u: User, body: object) =>
    void action.run(async () => {
      await patch(`/admin/users/${u.id}`, body);
      users.reload();
    });
  const reset = (u: User) =>
    void action.run(async () => {
      const r = await post<{ temporaryPassword: string }>(`/admin/users/${u.id}/reset-password`);
      setSecret({ email: u.email, password: r.temporaryPassword });
    });

  // Fichas libres (sin usuario) + la del propio usuario, para el selector de vinculación.
  const freePros = (u: User) => (pros.data ?? []).filter((p) => !p.userId || p.userId === u.id);

  return (
    <section>
      <header className="page-header">
        <h1>{t.navUsers}</h1>
        <button type="button" onClick={() => setCreating(true)}>{t.new}</button>
      </header>
      <ErrorBox error={action.error ?? users.error} />
      {users.loading ? <Loading /> : (
        <div className="table-wrap">
<table>
          <thead><tr><th>{t.email}</th><th>{t.role}</th><th>{t.linkedProfessional}</th><th>{t.lastLogin}</th><th /></tr></thead>
          <tbody>
            {(users.data ?? []).map((u) => (
              <tr key={u.id} className={u.active ? '' : 'inactive'}>
                <td>{u.email}{u.active ? '' : ` (${t.inactive})`}</td>
                <td>
                  <select aria-label={t.role} value={u.role} disabled={action.busy} onChange={(e) => setField(u, { role: e.target.value })}>
                    <option value="ADMIN">{t.role_ADMIN}</option>
                    <option value="PROFESSIONAL">{t.role_PROFESSIONAL}</option>
                  </select>
                </td>
                <td>
                  {u.role === 'PROFESSIONAL' ? (
                    <select aria-label={t.linkedProfessional} value={u.professionalId ?? ''} disabled={action.busy}
                      onChange={(e) => setField(u, { professionalId: e.target.value || null })}>
                      <option value="">{t.none}</option>
                      {freePros(u).map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
                    </select>
                  ) : '—'}
                </td>
                <td className="small">{u.lastLoginAt ? dateTimeLabel(u.lastLoginAt, me.tenant.timezone, lang) : '—'}</td>
                <td className="row-actions">
                  <button type="button" className="ghost small" disabled={action.busy} onClick={() => reset(u)}>{t.resetPassword}</button>
                  <button type="button" className="ghost small" disabled={action.busy} onClick={() => setField(u, { active: !u.active })}>
                    {u.active ? t.deactivate : t.activate}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
</div>
      )}
      {creating ? (
        <UserForm
          professionals={(pros.data ?? []).filter((p) => !p.userId)}
          onClose={() => setCreating(false)}
          onDone={(email, password) => {
            setCreating(false);
            if (password) setSecret({ email, password });
            users.reload();
            pros.reload();
          }}
        />
      ) : null}
      {secret ? (
        <Modal title={secret.email} onClose={() => setSecret(null)}>
          <p>{t.temporaryPassword}</p>
          <p><code className="secret">{secret.password}</code></p>
          <div className="form-actions"><button type="button" onClick={() => setSecret(null)}>{t.close}</button></div>
        </Modal>
      ) : null}
    </section>
  );
}

function UserForm({ professionals, onClose, onDone }: {
  professionals: Professional[]; onClose: () => void; onDone: (email: string, temporaryPassword: string | null) => void;
}) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('PROFESSIONAL');
  const [professionalId, setProfessionalId] = useState('');
  const action = useAction();
  const save = async () => {
    let result: { user: User; temporaryPassword: string | null } | undefined;
    const ok = await action.run(async () => {
      result = await post('/admin/users', { email, role, ...(role === 'PROFESSIONAL' && professionalId ? { professionalId } : {}) });
    });
    if (ok && result) onDone(result.user.email, result.temporaryPassword);
  };
  return (
    <Modal title={t.new} onClose={onClose}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Field label={t.email}><input type="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        <Field label={t.role}>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="PROFESSIONAL">{t.role_PROFESSIONAL}</option>
            <option value="ADMIN">{t.role_ADMIN}</option>
          </select>
        </Field>
        {role === 'PROFESSIONAL' ? (
          <Field label={t.linkedProfessional}>
            <select value={professionalId} onChange={(e) => setProfessionalId(e.target.value)}>
              <option value="">{t.none}</option>
              {professionals.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
            </select>
          </Field>
        ) : null}
        <ErrorBox error={action.error} />
        <div className="form-actions">
          <button type="button" className="ghost" onClick={onClose}>{t.cancel}</button>
          <button type="submit" disabled={action.busy}>{t.create}</button>
        </div>
      </form>
    </Modal>
  );
}
