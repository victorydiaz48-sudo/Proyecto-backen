import { useState } from 'react';
import { get, qs } from '../api';
import { dateTimeLabel } from '../format';
import { useI18n } from '../i18n';
import { useSession } from '../session';
import type { Notification, NotificationStatus, Page } from '../types';
import { ErrorBox, Loading, useAction, useLoad } from '../ui';

const STATUSES: NotificationStatus[] = ['PENDING', 'SENT', 'FAILED', 'CANCELLED'];

/** Avisos al cliente y al negocio. Con el transporte "log" no salen solos: se pueden enviar a mano. */
export function NotificationsPage() {
  const { t, lang } = useI18n();
  const { me } = useSession();
  const [status, setStatus] = useState<NotificationStatus | ''>('');
  const first = useLoad(() => get<Page<Notification>>(`/admin/notifications${qs({ status, limit: 50 })}`), [status]);
  const [more, setMore] = useState<{ items: Notification[]; next: string | null } | null>(null);
  const action = useAction();
  const items = [...(first.data?.items ?? []), ...(more?.items ?? [])];
  const next = more ? more.next : (first.data?.nextCursor ?? null);

  return (
    <section>
      <header className="page-header">
        <h1>{t.navNotifications}</h1>
        <select aria-label="Status" value={status} onChange={(e) => { setMore(null); setStatus(e.target.value as NotificationStatus | ''); }}>
          <option value="">{t.allStatuses}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{t[`nstatus_${s}`]}</option>)}
        </select>
      </header>
      <p className="notice small">{t.notificationsHint}</p>
      <ErrorBox error={action.error ?? first.error} />
      {first.loading ? <Loading /> : (
        <div className="table-wrap">
<table>
          <thead><tr><th>{t.scheduledFor}</th><th>{t.recipient}</th><th>{t.message}</th><th /></tr></thead>
          <tbody>
            {items.map((n) => (
              <tr key={n.id} className={n.status === 'CANCELLED' ? 'inactive' : ''}>
                <td className="small">
                  {dateTimeLabel(n.scheduledFor, me.tenant.timezone, lang)}
                  <div><span className="badge">{t[`nstatus_${n.status}`]}</span></div>
                </td>
                <td className="small">
                  {t[`audience_${n.audience}`]} · {t[`channel_${n.channel}`]}
                  <div className="muted">{n.to}</div>
                </td>
                <td className="small pre">{n.text}{n.lastError ? <div className="error">{n.lastError}</div> : null}</td>
                <td>
                  {n.status !== 'CANCELLED' && n.waUrl ? (
                    <a className="button-link" href={n.waUrl} target="_blank" rel="noopener noreferrer">{t.openWhatsapp}</a>
                  ) : n.channel === 'telegram' ? (
                    <span className="small muted">{t.telegramSentAuto}</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
</div>
      )}
      {next ? (
        <button type="button" className="ghost" disabled={action.busy}
          onClick={() => void action.run(async () => {
            const p = await get<Page<Notification>>(`/admin/notifications${qs({ status, limit: 50, cursor: next })}`);
            setMore({ items: [...(more?.items ?? []), ...p.items], next: p.nextCursor ?? null });
          })}>
          {t.more}
        </button>
      ) : null}
    </section>
  );
}
