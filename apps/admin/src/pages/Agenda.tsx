import { useMemo, useState, type FormEvent } from 'react';
import { ApiError, get, patch, post, qs } from '../api';
import { addDays, dateLabel, localDate, money } from '../format';
import { useI18n } from '../i18n';
import { isAdmin, useSession } from '../session';
import type { Availability, Booking, BookingStatus, Page, Professional, Service, Slot } from '../types';
import { ErrorBox, Field, Loading, Modal, useAction, useLoad } from '../ui';

/** Acciones de estado que ofrece el panel (el servidor valida las transiciones y los permisos). */
const NEXT: Record<BookingStatus, { status: BookingStatus; label: 'confirm' | 'complete' | 'noShow' | 'cancelBooking' | 'reactivate'; adminOnly?: boolean; afterStart?: boolean }[]> = {
  PENDING: [{ status: 'CONFIRMED', label: 'confirm' }, { status: 'CANCELLED', label: 'cancelBooking' }],
  CONFIRMED: [
    { status: 'COMPLETED', label: 'complete', afterStart: true },
    { status: 'NO_SHOW', label: 'noShow', afterStart: true },
    { status: 'CANCELLED', label: 'cancelBooking' },
  ],
  CANCELLED: [{ status: 'CONFIRMED', label: 'reactivate', adminOnly: true }],
  COMPLETED: [],
  NO_SHOW: [],
};

export function AgendaPage() {
  const { t, lang } = useI18n();
  const { me } = useSession();
  const tz = me.tenant.timezone;
  const [date, setDate] = useState(() => localDate(new Date(), tz));
  const [creating, setCreating] = useState(false);
  const [moving, setMoving] = useState<Booking | null>(null);
  const action = useAction();

  const bookings = useLoad(
    () =>
      get<Page<Booking>>(
        `/admin/bookings${qs({ from: `${addDays(date, -1)}T12:00:00Z`, to: `${addDays(date, 1)}T12:00:00Z` })}`,
      ).then((p) => p.items.filter((b) => b.localDate === date)),
    [date],
  );
  const pros = useLoad(() => get<Page<Professional>>('/admin/professionals').then((p) => p.items), []);

  const columns = useMemo(() => {
    const list = pros.data ?? [];
    const own = me.user.professionalId;
    return isAdmin(me) ? list : list.filter((p) => p.id === own);
  }, [pros.data, me]);

  const changeStatus = (b: Booking, status: BookingStatus) =>
    void action.run(async () => {
      const reason = status === 'CANCELLED' ? (window.prompt(t.cancelReason) ?? undefined) : undefined;
      if (status === 'CANCELLED' && reason === undefined) return;
      await post(`/admin/bookings/${b.id}/status`, { status, ...(reason ? { reason } : {}) });
      bookings.reload();
    });

  return (
    <section>
      <header className="page-header">
        <h1>{t.navAgenda}</h1>
        <div className="toolbar">
          <button type="button" className="ghost" onClick={() => setDate(addDays(date, -1))} aria-label={t.prevDay}>‹</button>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label={t.date} />
          <button type="button" className="ghost" onClick={() => setDate(addDays(date, 1))} aria-label={t.nextDay}>›</button>
          <button type="button" className="ghost" onClick={() => setDate(localDate(new Date(), tz))}>{t.today}</button>
          <button type="button" onClick={() => setCreating(true)}>{t.newBooking}</button>
        </div>
      </header>
      <p className="muted capitalize">{dateLabel(date, lang)}</p>
      <ErrorBox error={action.error ?? bookings.error ?? pros.error} />
      {bookings.loading || pros.loading ? (
        <Loading />
      ) : (
        <div className="agenda">
          {columns.map((p) => {
            const items = (bookings.data ?? []).filter((b) => b.professional.id === p.id);
            return (
              <div className="agenda-col" key={p.id}>
                <h2>{p.displayName}</h2>
                {items.length === 0 ? <p className="muted">{t.noBookings}</p> : null}
                {items.map((b) => {
                  const started = new Date(b.startAt).getTime() <= Date.now();
                  return (
                    <article key={b.id} className={`booking status-${b.status}`}>
                      <div className="booking-head">
                        <strong>{b.localTime}</strong>
                        <span className="badge">{t[`status_${b.status}`]}</span>
                      </div>
                      <div>{b.service.name} · {b.service.durationMinutes} min · {money(b.priceCents, b.currency, lang)}</div>
                      <div>
                        {b.customer.name} · <a href={`tel:${b.customer.phoneE164}`}>{b.customer.phoneE164}</a>
                      </div>
                      {b.customerNotes ? <div className="muted">“{b.customerNotes}”</div> : null}
                      <div className="muted small">{b.location.name} · {t[`source_${b.source}`]}{b.cancelReason ? ` · ${b.cancelReason}` : ''}</div>
                      <div className="row-actions">
                        {NEXT[b.status]
                          .filter((n) => (!n.adminOnly || isAdmin(me)) && (!n.afterStart || started))
                          .map((n) => (
                            <button key={n.status} type="button" className={n.status === 'CANCELLED' || n.status === 'NO_SHOW' ? 'small ghost' : 'small'} disabled={action.busy} onClick={() => changeStatus(b, n.status)}>
                              {t[n.label]}
                            </button>
                          ))}
                        {b.status === 'PENDING' || b.status === 'CONFIRMED' ? (
                          <button type="button" className="small ghost" onClick={() => setMoving(b)}>{t.reschedule}</button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
      {creating ? (
        <BookingForm
          date={date}
          professionals={columns}
          onClose={() => setCreating(false)}
          onDone={(d) => {
            setCreating(false);
            setDate(d);
            bookings.reload();
          }}
        />
      ) : null}
      {moving ? (
        <BookingForm
          date={moving.localDate}
          professionals={columns}
          booking={moving}
          onClose={() => setMoving(null)}
          onDone={(d) => {
            setMoving(null);
            setDate(d);
            bookings.reload();
          }}
        />
      ) : null}
    </section>
  );
}

/** Nueva cita o reprogramación: solo ofrece horas reales calculadas por el servidor. */
function BookingForm({
  date: initialDate,
  professionals,
  booking,
  onClose,
  onDone,
}: {
  date: string;
  professionals: Professional[];
  booking?: Booking;
  onClose: () => void;
  onDone: (date: string) => void;
}) {
  const { t, lang } = useI18n();
  const { me } = useSession();
  const admin = isAdmin(me);
  const services = useLoad(() => get<Page<Service>>('/admin/services').then((p) => p.items), []);
  const [serviceId, setServiceId] = useState(booking?.service.id ?? '');
  const [professionalId, setProfessionalId] = useState(booking?.professional.id ?? (admin ? 'any' : (me.user.professionalId ?? '')));
  const [date, setDate] = useState(initialDate);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [alternatives, setAlternatives] = useState<{ localDate: string; localTime: string }[]>([]);
  const action = useAction();

  const availability = useLoad(
    () =>
      serviceId && professionalId
        ? get<Availability>(`/admin/availability${qs({ serviceId, professionalId, date })}`)
        : Promise.resolve(null),
    [serviceId, professionalId, date],
  );
  const slots = availability.data?.days[0]?.slots ?? [];
  const pros = professionals.filter((p) => !serviceId || p.serviceIds.includes(serviceId));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!slot) return;
    setAlternatives([]);
    const ok = await action.run(async () => {
      try {
        if (booking) {
          await patch(`/admin/bookings/${booking.id}`, {
            date,
            time: slot.localTime,
            ...(professionalId !== booking.professional.id && professionalId !== 'any' ? { professionalId } : {}),
            ...(serviceId !== booking.service.id ? { serviceId } : {}),
          });
        } else {
          await post('/admin/bookings', {
            serviceId,
            professionalId,
            date,
            time: slot.localTime,
            customer: { name, phone },
            ...(notes ? { notes } : {}),
          });
        }
      } catch (err) {
        if (err instanceof ApiError && Array.isArray(err.body.details?.alternatives)) {
          setAlternatives(err.body.details.alternatives as { localDate: string; localTime: string }[]);
          availability.reload();
        }
        throw err;
      }
    });
    if (ok) onDone(date);
  };

  return (
    <Modal title={booking ? t.reschedule : t.newBooking} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="form">
        <Field label={t.service}>
          <select value={serviceId} onChange={(e) => { setServiceId(e.target.value); setSlot(null); }} required>
            <option value="" disabled>—</option>
            {(services.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.name} · {s.durationMinutes} min · {money(s.priceCents, me.tenant.currency, lang)}</option>
            ))}
          </select>
        </Field>
        <Field label={t.professional}>
          <select value={professionalId} onChange={(e) => { setProfessionalId(e.target.value); setSlot(null); }} required disabled={!admin}>
            {admin && !booking ? <option value="any">{t.anyProfessional}</option> : null}
            {pros.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
        </Field>
        <Field label={t.date}>
          <input type="date" value={date} onChange={(e) => { if (e.target.value) { setDate(e.target.value); setSlot(null); } }} required />
        </Field>
        <fieldset className="slots">
          <legend>{t.pickSlot}</legend>
          {availability.loading ? <Loading /> : null}
          {!availability.loading && serviceId && slots.length === 0 ? <p className="muted">{t.noSlots}</p> : null}
          {slots.map((s) => (
            <button
              key={`${s.startAt}-${s.locationId}`}
              type="button"
              className={`slot ${slot?.startAt === s.startAt && slot.locationId === s.locationId ? 'selected' : ''}`}
              aria-pressed={slot?.startAt === s.startAt}
              onClick={() => setSlot(s)}
            >
              {s.localTime}
            </button>
          ))}
        </fieldset>
        {!booking ? (
          <>
            <Field label={t.name}>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
            </Field>
            <Field label={t.phone}>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} required />
            </Field>
            <Field label={`${t.notes} (${t.optional})`}>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} rows={2} />
            </Field>
          </>
        ) : null}
        <ErrorBox error={action.error ?? services.error ?? availability.error} />
        {alternatives.length ? (
          <p className="muted">
            {t.alternatives} {alternatives.map((a) => (a.localDate === date ? a.localTime : `${a.localDate} ${a.localTime}`)).join(', ')}
          </p>
        ) : null}
        <div className="form-actions">
          <button type="button" className="ghost" onClick={onClose}>{t.cancel}</button>
          <button type="submit" disabled={!slot || action.busy}>{t.save}</button>
        </div>
      </form>
    </Modal>
  );
}
