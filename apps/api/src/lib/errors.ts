/** Error de dominio con código estable. El handler global lo convierte en la respuesta JSON uniforme. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const unauthenticated = (): AppError => new AppError(401, 'UNAUTHENTICATED', 'Inicia sesión para continuar.');
export const forbidden = (): AppError => new AppError(403, 'FORBIDDEN', 'No tienes permiso para esta acción.');
/** También para recursos de otro tenant: nunca se revela que existen. */
export const notFound = (): AppError => new AppError(404, 'NOT_FOUND', 'No encontrado.');
export const conflict = (message: string, details?: Record<string, unknown>): AppError =>
  new AppError(409, 'CONFLICT', message, details);
export const validationError = (fields: { path: string; message: string }[]): AppError =>
  new AppError(400, 'VALIDATION_ERROR', 'Datos inválidos.', { fields });
