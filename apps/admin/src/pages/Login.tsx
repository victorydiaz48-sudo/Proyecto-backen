import { useState, type FormEvent } from 'react';
import { ApiError, post } from '../api';
import { useI18n } from '../i18n';
import { Field } from '../ui';

export function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const { t } = useI18n();
  const [tenantSlug, setTenantSlug] = useState(() => {
    try {
      return localStorage.getItem('reservas-admin-slug') ?? '';
    } catch {
      return '';
    }
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/auth/login', { tenantSlug: tenantSlug.trim(), email: email.trim(), password });
      try {
        localStorage.setItem('reservas-admin-slug', tenantSlug.trim());
      } catch {
        /* opcional */
      }
      onLoggedIn();
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'INVALID_CREDENTIALS' ? new Error(t.invalidCredentials) : err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <form onSubmit={(e) => void submit(e)} className="card">
        <h1>{t.loginTitle}</h1>
        <Field label={t.business}>
          <input value={tenantSlug} onChange={(e) => setTenantSlug(e.target.value)} autoComplete="organization" required />
        </Field>
        <Field label={t.email}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </Field>
        <Field label={t.password}>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </Field>
        {error ? <p className="error" role="alert">{error instanceof ApiError ? error.message : (error as Error).message}</p> : null}
        <button type="submit" disabled={busy}>
          {t.login}
        </button>
      </form>
    </main>
  );
}
