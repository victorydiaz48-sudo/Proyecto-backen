import { useEffect, useState, type ReactNode } from 'react';
import { get, post, setUnauthenticatedHandler } from './api';
import { langFromLocale, useI18n } from './i18n';
import { AccountPage } from './pages/Account';
import { AgendaPage } from './pages/Agenda';
import { AuditPage } from './pages/Audit';
import { BlocksPage } from './pages/Blocks';
import { CustomersPage } from './pages/Customers';
import { LocationsPage } from './pages/Locations';
import { LoginPage } from './pages/Login';
import { MyHoursPage } from './pages/MyHours';
import { ProfessionalsPage } from './pages/Professionals';
import { ServicesPage } from './pages/Services';
import { SettingsPage } from './pages/Settings';
import { UsersPage } from './pages/Users';
import { Link, navigate, usePath } from './router';
import { SessionContext } from './session';
import type { Me } from './types';
import { Loading } from './ui';

interface RouteDef {
  path: string;
  label: (t: ReturnType<typeof useI18n>['t']) => string;
  page: () => ReactNode;
  adminOnly?: boolean;
  professionalOnly?: boolean;
}

const ROUTES: RouteDef[] = [
  { path: '/', label: (t) => t.navAgenda, page: () => <AgendaPage /> },
  { path: '/blocks', label: (t) => t.navBlocks, page: () => <BlocksPage /> },
  { path: '/my-hours', label: (t) => t.navMyHours, page: () => <MyHoursPage />, professionalOnly: true },
  { path: '/customers', label: (t) => t.navCustomers, page: () => <CustomersPage /> },
  { path: '/services', label: (t) => t.navServices, page: () => <ServicesPage />, adminOnly: true },
  { path: '/professionals', label: (t) => t.navProfessionals, page: () => <ProfessionalsPage />, adminOnly: true },
  { path: '/locations', label: (t) => t.navLocations, page: () => <LocationsPage />, adminOnly: true },
  { path: '/users', label: (t) => t.navUsers, page: () => <UsersPage />, adminOnly: true },
  { path: '/settings', label: (t) => t.navSettings, page: () => <SettingsPage />, adminOnly: true },
  { path: '/audit', label: (t) => t.navAudit, page: () => <AuditPage />, adminOnly: true },
  { path: '/account', label: (t) => t.navAccount, page: () => <AccountPage /> },
];

export function App() {
  const { t, lang, setLang, setDefaultLang } = useI18n();
  const path = usePath();
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  const refresh = () => {
    get<Me>('/auth/me').then(
      (m) => {
        setMe(m);
        setDefaultLang(langFromLocale(m.tenant.locale));
      },
      () => setMe(null),
    );
  };

  useEffect(() => {
    setUnauthenticatedHandler(() => setMe(null));
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (me === undefined) return <Loading />;
  if (me === null) return <LoginPage onLoggedIn={refresh} />;

  const admin = me.user.role === 'ADMIN';
  const visible = ROUTES.filter((r) => (!r.adminOnly || admin) && (!r.professionalOnly || !admin));
  const route = visible.find((r) => r.path === path) ?? visible[0]!;

  const logout = async () => {
    await post('/auth/logout').catch(() => undefined);
    navigate('/');
    setMe(null);
  };

  return (
    <SessionContext.Provider value={{ me, refresh }}>
      <div className="layout">
        <nav className="sidebar" aria-label="Menu">
          <div className="brand">
            <strong>{me.tenant.name}</strong>
            <small className="muted">{me.user.email}</small>
          </div>
          {visible.map((r) => (
            <Link key={r.path} to={r.path} className={r === route ? 'active' : ''}>
              {r.label(t)}
            </Link>
          ))}
          <div className="sidebar-footer">
            <select aria-label={t.language} value={lang} onChange={(e) => setLang(e.target.value as 'pt' | 'es')}>
              <option value="pt">Português</option>
              <option value="es">Español</option>
            </select>
            <button type="button" className="ghost" onClick={() => void logout()}>
              {t.logout}
            </button>
          </div>
        </nav>
        <main className="content">{route.page()}</main>
      </div>
    </SessionContext.Provider>
  );
}
