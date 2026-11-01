import { hashCorto } from '@/app/ui-v2/onboarding/estado';
import type { Almacen, Recorrido } from './tipos';

// Progreso en localStorage, versionado. SOLO ids e índice: nunca datos de negocio
// (E-22). `ambito` aísla a quien comparte navegador (usuario/tenant); en la clave va HASHEADO (FNV, igual que `estado.ts`): el id nunca queda en claro en el navegador. Nunca lanza: Safari privado y cuotas llenas solo
// significan «no se pudo guardar».

export type EstadoGuardado = 'en_curso' | 'omitido' | 'terminado';
export interface Guardado { v: 1; version: number; estado: EstadoGuardado; indice: number; pasoId: string | null }

export const claveTour = (ambito: string, recorridoId: string) => `likida:tour:v1:${hashCorto(ambito)}:${recorridoId}`;

export function leerGuardado(almacen: Almacen | null, ambito: string, recorrido: Recorrido): Guardado | null {
  if (!almacen) return null;
  try {
    const crudo = almacen.getItem(claveTour(ambito, recorrido.id));
    if (!crudo) return null;
    const g = JSON.parse(crudo) as Partial<Guardado>;
    if (g?.v !== 1 || g.version !== recorrido.version) return null;
    if (g.estado !== 'en_curso' && g.estado !== 'omitido' && g.estado !== 'terminado') return null;
    let indice = Number.isInteger(g.indice) ? (g.indice as number) : 0;
    if (g.pasoId) {
      const i = recorrido.pasos.findIndex((p) => p.id === g.pasoId);
      if (i >= 0) indice = i;
    }
    indice = Math.min(Math.max(indice, 0), Math.max(recorrido.pasos.length - 1, 0));
    return { v: 1, version: recorrido.version, estado: g.estado, indice, pasoId: recorrido.pasos[indice]?.id ?? null };
  } catch {
    return null;
  }
}

export function guardar(almacen: Almacen | null, ambito: string, recorrido: Recorrido, estado: EstadoGuardado, indice: number): void {
  if (!almacen) return;
  try {
    const g: Guardado = { v: 1, version: recorrido.version, estado, indice, pasoId: recorrido.pasos[indice]?.id ?? null };
    almacen.setItem(claveTour(ambito, recorrido.id), JSON.stringify(g));
  } catch { /* sin almacenamiento: el recorrido sigue, solo no se recuerda */ }
}

export function borrarGuardado(almacen: Almacen | null, ambito: string, recorridoId: string): void {
  try { almacen?.removeItem(claveTour(ambito, recorridoId)); } catch { /* idem */ }
}
