import type { Declaraciones, IdPaso } from '@/lib/likida/asistente/pasos_cinco_agentes';

// Progreso del asistente en el NAVEGADOR (localStorage, versionado). Solo declaraciones de la persona: lo medido nunca se
// guarda (se vuelve a leer cada vez). Nunca lanza: Safari privado o cuota llena solo significan «no se pudo recordar».
// `ambito` = tenant + usuario, para que dos cuentas en el mismo navegador no se crucen (E-22).

export interface AlmacenLocal {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export const claveProgreso = (ambito: string) => `likida:asistente:v1:${ambito}`;

const IDS: readonly IdPaso[] = ['equipo', 'tms', 'correo', 'catalogos', 'carta_porte', 'simulacro', 'whatsapp', 'peajes', 'vigia_conductor', 'legal'];
const VACIAS: Declaraciones = {};

export function leerDeclaraciones(almacen: AlmacenLocal | null, ambito: string): Declaraciones {
  if (!almacen) return VACIAS;
  try {
    const crudo = almacen.getItem(claveProgreso(ambito));
    if (!crudo) return VACIAS;
    const j = JSON.parse(crudo) as { v?: number; d?: Record<string, unknown> };
    if (j?.v !== 1 || typeof j.d !== 'object' || j.d === null) return VACIAS;
    const d: Declaraciones = {};
    if (j.d.equipoInvitado === true) d.equipoInvitado = true;
    if (j.d.correoRecibido === true) d.correoRecibido = true;
    if (j.d.simulacroVisto === true) d.simulacroVisto = true;
    const om = j.d.omitidos;
    if (om && typeof om === 'object') {
      const limpio: Partial<Record<IdPaso, string>> = {};
      for (const id of IDS) {
        const m = (om as Record<string, unknown>)[id];
        if (typeof m === 'string' && m.trim()) limpio[id] = m.trim().slice(0, 140);
      }
      if (Object.keys(limpio).length > 0) d.omitidos = limpio;
    }
    return d;
  } catch {
    return VACIAS;
  }
}

export function guardarDeclaraciones(almacen: AlmacenLocal | null, ambito: string, d: Declaraciones): boolean {
  if (!almacen) return false;
  try {
    almacen.setItem(claveProgreso(ambito), JSON.stringify({ v: 1, d }));
    return true;
  } catch {
    return false;
  }
}

/** Nombre de la cookie con la que el layout pinta la insignia de avance en el menú. Solo lleva «listos/total». */
export const nombreCookieAvance = (tenantId: string) => `likida_pem_${tenantId.replace(/[^a-z0-9]/gi, '').slice(0, 12)}`;

export function valorCookieAvance(listos: number, total: number): string {
  return `${Math.max(0, Math.min(listos, total))}/${total}`;
}

/** Lo que el layout acepta de la cookie: exactamente «N/M» con M ≤ 20. Cualquier otra cosa se ignora. */
export function insigniaDeCookie(valor: string | undefined): string | null {
  if (!valor) return null;
  const m = /^(\d{1,2})\/(\d{1,2})$/.exec(valor);
  if (!m) return null;
  const [n, t] = [Number(m[1]), Number(m[2])];
  if (t < 1 || t > 20 || n > t) return null;
  return n === t ? null : valor; // completo = sin insignia
}
