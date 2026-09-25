import { createContext, useContext } from 'react';
import type { Me } from './types';

export const SessionContext = createContext<{ me: Me; refresh: () => void } | null>(null);

export function useSession(): { me: Me; refresh: () => void } {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession fuera de sesión');
  return s;
}

export const isAdmin = (me: Me): boolean => me.user.role === 'ADMIN';
