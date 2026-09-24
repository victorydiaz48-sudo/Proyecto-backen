import { useState } from 'react';
import { get, qs } from '../api';
import { dateTimeLabel } from '../format';
import { useI18n } from '../i18n';
import { useSession } from '../session';
import type { AuditLog, Page } from '../types';
import { ErrorBox, Loading, useAction, useLoad } from '../ui';

export function AuditPage() {
  const { t, lang } = useI18n();
  const { me } = useSession();
  const first = useLoad(() => get<Page<AuditLog>>(`/admin/audit-logs${qs({ limit: 50 })}`), []);
  const [more, setMore] = useState<{ items: AuditLog[]; next: string | null } | null>(null);
  const action = useAction();
  const items = [...(first.data?.items ?? []), ...(more?.items ?? [])];
  const next = more ? more.next : (first.data?.nextCursor ?? null);

  const who = (l: AuditLog) => (l.actor ? l.actor.email : l.actorType === 'PUBLIC' ? t.actor_PUBLIC : t.actor_SYSTEM);
  const summary = (v: unknown) => (v ? JSON.stringify(v) : '');

  return (
    <section>
      <h1>{t.navAudit}</h1>
      <ErrorBox error={action.error ?? first.error} />
      {first.loading ? <Loading /> : (
        <div className="table-wrap">
<table className="audit">
          <thead><tr><th>{t.when}</th><th>{t.who}</th><th>{t.action}</th><th>{t.entity}</th><th /></tr></thead>
          <tbody>
            {items.map((l) => (
              <tr key={l.id}>
                <td className="small">{dateTimeLabel(l.createdAt, me.tenant.timezone, lang)}</td>
                <td>{who(l)}</td>
                <td><code>{l.action}</code></td>
                <td className="small">{l.entityType}</td>
                <td className="small muted mono">
                  {l.before ? <div>− {summary(l.before)}</div> : null}
                  {l.after ? <div>+ {summary(l.after)}</div> : null}
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
            const p = await get<Page<AuditLog>>(`/admin/audit-logs${qs({ limit: 50, cursor: next })}`);
            setMore({ items: [...(more?.items ?? []), ...p.items], next: p.nextCursor ?? null });
          })}>
          {t.more}
        </button>
      ) : null}
    </section>
  );
}
