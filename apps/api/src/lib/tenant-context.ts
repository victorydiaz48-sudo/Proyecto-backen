import { AsyncLocalStorage } from 'node:async_hooks';

/*
 * Negocio "actual" para Row-Level Security. El cliente de BD (src/db.ts) lo lee en el momento de cada
 * consulta y lo fija en PostgreSQL (app.tenant_id). Sin negocio, las tablas con RLS no devuelven filas.
 * Se fija SOLO desde fuentes de confianza: la sesión, el slug de la URL pública o el código de sistema
 * (CLI, worker), nunca desde datos del cliente.
 */
interface TenantStore {
  tenantId: string | undefined;
}

const storage = new AsyncLocalStorage<TenantStore>();

export function currentTenantId(): string | undefined {
  return storage.getStore()?.tenantId;
}

/** Ejecuta `fn` con el negocio fijado (CLI, worker, alta de negocios). */
export function withTenant<T>(tenantId: string, fn: () => T): T {
  return storage.run({ tenantId }, fn);
}

/** Abre un contexto sin negocio para una petición HTTP; después se fija con `setRequestTenant`. */
export function runInRequestContext(fn: () => void): void {
  storage.run({ tenantId: undefined }, fn);
}

/** Fija el negocio de la petición en curso (tras resolver la sesión o el slug público). */
export function setRequestTenant(tenantId: string): void {
  const store = storage.getStore();
  if (!store) throw new Error('setRequestTenant fuera de un contexto de petición');
  store.tenantId = tenantId;
}
