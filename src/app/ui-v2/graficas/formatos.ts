// SIN 'use client' y sin importar nada de servidor: lo importan tanto los componentes de servidor (para escribir un id)
// como las gráficas de cliente (para resolverlo). El formato de cifras vive SOLO en `@/lib/formato`; aquí únicamente se
// nombra qué función de ahí se usa.
import { litros, mxn, mxnCompacto, mxnEntero, numero, usd } from '@/lib/formato';

/**
 * Una FUNCIÓN no cruza de un componente de servidor a uno de cliente («Functions cannot be passed directly to Client
 * Components» → /dashboard caía con «No se pudo cargar el panel»). Un llamador de servidor pasa un id (string
 * serializable) y la gráfica de cliente lo resuelve por dentro con `resolverFormato`.
 */
export type FormatoId = 'numero' | 'mxn' | 'mxnEntero' | 'mxnCompacto' | 'usd' | 'litros';

/** Id (desde servidor o cliente) o función (SOLO desde otro componente de cliente). */
export type FormatoGrafica = FormatoId | ((v: number) => string);

const POR_ID: Record<FormatoId, (v: number) => string> = {
  numero: (v) => numero(v),
  mxn: (v) => mxn(v),
  mxnEntero: (v) => mxnEntero(v),
  mxnCompacto: (v) => mxnCompacto(v),
  usd: (v) => usd(v),
  litros: (v) => litros(v),
};

const SIN_FORMATO = (v: number): string => String(v);

/** Devuelve la función de formato; sin `formato` conserva el comportamiento histórico de las gráficas (`String(v)`). */
export function resolverFormato(f?: FormatoGrafica, porDefecto: (v: number) => string = SIN_FORMATO): (v: number) => string {
  if (f === undefined) return porDefecto;
  return typeof f === 'function' ? f : POR_ID[f];
}
