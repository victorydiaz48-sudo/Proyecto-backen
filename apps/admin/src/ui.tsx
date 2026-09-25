import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError } from './api';
import { useI18n } from './i18n';

/** Carga datos y permite recargarlos. Ignora respuestas de cargas anteriores (cambios rápidos de filtro). */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]): { data: T | undefined; error: unknown; loading: boolean; reload: () => void } {
  const [state, setState] = useState<{ data: T | undefined; error: unknown; loading: boolean }>({ data: undefined, error: null, loading: true });
  const seq = useRef(0);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const n = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    load().then(
      (data) => n === seq.current && setState({ data, error: null, loading: false }),
      (error: unknown) => n === seq.current && setState({ data: undefined, error, loading: false }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

export function errorMessage(err: unknown, networkError: string): string {
  if (err instanceof ApiError) {
    if (err.code === 'NETWORK') return networkError;
    const fields = err.fields.map((f) => `${f.path.replace(/^body\./, '')}: ${f.message}`);
    return fields.length ? `${err.message} ${fields.join(' · ')}` : err.message;
  }
  return String(err);
}

export function ErrorBox({ error }: { error: unknown }) {
  const { t } = useI18n();
  if (!error) return null;
  return (
    <p className="error" role="alert">
      {errorMessage(error, t.networkError)}
    </p>
  );
}

export function Loading() {
  const { t } = useI18n();
  return <p className="muted">{t.loading}</p>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <small className="muted">{hint}</small> : null}
    </label>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button type="button" className="ghost" onClick={onClose} aria-label={t.close}>
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

/** Ejecuta una acción mostrando "ocupado" y guardando el error para enseñarlo. */
export function useAction(): { busy: boolean; error: unknown; run: (fn: () => Promise<unknown>) => Promise<boolean>; clear: () => void } {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, clear: () => setError(null) };
}
