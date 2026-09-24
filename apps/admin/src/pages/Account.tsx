import { useState } from 'react';
import { post } from '../api';
import { useI18n } from '../i18n';
import { useSession } from '../session';
import { ErrorBox, Field, useAction } from '../ui';

export function AccountPage() {
  const { t } = useI18n();
  const { me } = useSession();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [saved, setSaved] = useState(false);
  const action = useAction();
  const save = async () => {
    setSaved(false);
    const ok = await action.run(() => post('/auth/password', { currentPassword, newPassword }));
    if (ok) {
      setSaved(true);
      setCurrent('');
      setNew('');
    }
  };
  return (
    <section>
      <h1>{t.navAccount}</h1>
      <p className="muted">{me.user.email} · {t[`role_${me.user.role}`]}</p>
      <form className="form narrow" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <h2>{t.changePassword}</h2>
        <Field label={t.currentPassword}><input type="password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required /></Field>
        <Field label={t.newPassword}><input type="password" value={newPassword} onChange={(e) => setNew(e.target.value)} autoComplete="new-password" minLength={10} maxLength={128} required /></Field>
        <ErrorBox error={action.error} />
        <div className="form-actions">
          {saved ? <span className="ok">{t.saved}</span> : null}
          <button type="submit" disabled={action.busy}>{t.save}</button>
        </div>
      </form>
    </section>
  );
}
