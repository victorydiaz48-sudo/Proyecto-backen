import { useI18n } from '../i18n';
import { useSession } from '../session';
import { HoursEditor } from './HoursEditor';

/** Profesional: su horario (solo lectura; lo cambia el ADMIN). */
export function MyHoursPage() {
  const { t } = useI18n();
  const { me } = useSession();
  return (
    <section>
      <h1>{t.navMyHours}</h1>
      {me.user.professionalId ? <HoursEditor professionalId={me.user.professionalId} readOnly /> : <p className="muted">{t.none}</p>}
    </section>
  );
}
