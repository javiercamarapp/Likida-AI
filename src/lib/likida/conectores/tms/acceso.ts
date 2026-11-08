// Piezas LIVIANAS del acceso al sistema de la flota (sin base de datos ni Next): las comparten el sincronizador, el lector de desgloses
// y la prueba en seco (que también corre desde un script de Node con `scripts/tms/verificar-local.mjs`). Viven aquí para que importar
// la prueba en seco no arrastre todo el sincronizador.
import type { ValoresCredencial } from '../tipos';
import { RUTA_LOGIN_POR_DEFECTO } from './ficha';

export const CONECTOR_TMS = 'tms_api_lectura';

export const RECURSOS_SINCRONIZABLES = ['liquidaciones', 'peajes', 'viajes', 'posiciones'] as const;
export type RecursoSincronizable = (typeof RECURSOS_SINCRONIZABLES)[number];

export function urlBaseHttps(v: string | undefined): string | null {
  try {
    const u = new URL((v ?? '').trim());
    return u.protocol === 'https:' ? u.origin + u.pathname.replace(/\/+$/, '') : null;
  } catch {
    return null;
  }
}

/** SUPUESTO: la forma del login. Se corrige aquí cuando llegue la documentación del cliente. */
export function loginDe(v: ValoresCredencial): { ruta: string; cuerpo: Record<string, string>; campo_token: string } {
  return {
    ruta: (v.ruta_login ?? '').trim() || RUTA_LOGIN_POR_DEFECTO,
    cuerpo: { usuario: '{usuario}', clave: '{clave}' },
    campo_token: 'token',
  };
}
