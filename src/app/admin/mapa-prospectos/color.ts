// ═══════════════════════════════════════════════════════════════════════════
// EL COLOR DEL CEREBRO: tres lecturas de un prospecto que la vista pinta distinto y que aquí se deciden UNA sola vez, sin React.
//
//  · URGENCIA: cuatro niveles. El número (0-100) ya lo calcula el servidor a partir de las notas y es el mismo que usan el atajo «Urgentes»
//    y el filtro de urgencia mínima (≥70 y ≥50): aquí solo se le pone nombre. Un prospecto ya cerrado no pide acción (al día) y uno perdido
//    tampoco (frío), aunque su número sea alto. Sin reloj: el nivel sale de lo que viaja en la fila, así el servidor y el cliente coinciden.
//  · ETAPA: seis grupos por matiz (la etapa exacta sigue en la tarjeta y en «El embudo, en luces»).
//  · EMPRESA: un tono categórico determinista por nombre (1 a 8) y sus iniciales, para reconocerla a golpe de vista.
// ═══════════════════════════════════════════════════════════════════════════

import type { ProspectoMapa } from '@/lib/admin/prospectos-mapa-client';
import type { TSistema } from '@/lib/i18n/sistema_tr';

export const UMBRAL_URGENTE = 70;
export const UMBRAL_ATENCION = 50;

export const NIVELES_URGENCIA = ['urgente', 'atencion', 'aldia', 'frio'] as const;
export type NivelUrgencia = (typeof NIVELES_URGENCIA)[number];

export function nivelUrgencia(p: Pick<ProspectoMapa, 'urgencia' | 'estado' | 'ultimoToque'>): NivelUrgencia {
  if (p.estado === 'won' || p.estado === 'cerrado') return 'aldia';
  if (p.estado === 'lost' || p.estado === 'perdido') return 'frio';
  if (p.urgencia >= UMBRAL_URGENTE) return 'urgente';
  if (p.urgencia >= UMBRAL_ATENCION) return 'atencion';
  return p.ultimoToque ? 'aldia' : 'frio';
}

export const GRUPOS_ETAPA = ['inicio', 'cita', 'propuesta', 'cierre', 'caida', 'perdido'] as const;
export type GrupoEtapa = (typeof GRUPOS_ETAPA)[number];
const GRUPO_DE: Record<string, GrupoEtapa> = {
  nuevo: 'inicio', contactado: 'inicio',
  appointment: 'cita', demo: 'cita', rescheduled: 'cita',
  proposal: 'propuesta', negociacion: 'propuesta', pilot: 'propuesta',
  won: 'cierre', cerrado: 'cierre',
  'no-show': 'caida', cancelled: 'caida',
  perdido: 'perdido', lost: 'perdido',
};
export const grupoDeEtapa = (estado: string): GrupoEtapa => GRUPO_DE[estado] ?? 'inicio';

/** Una etapa y su hermana en dos vocabularios (`lost`/`perdido`) cuentan igual: ver `etapaVisible` en cerebro.tsx. */
export type ModoColor = 'urgencia' | 'etapa';

export function rotuloNivel(n: NivelUrgencia, tx: TSistema): string {
  return n === 'urgente' ? tx('cer16.urg_urgente') : n === 'atencion' ? tx('cer16.urg_atencion') : n === 'aldia' ? tx('cer16.urg_aldia') : tx('cer16.urg_frio');
}
export function descripcionNivel(n: NivelUrgencia, tx: TSistema): string {
  return n === 'urgente' ? tx('cer16.urg_urgente_desc') : n === 'atencion' ? tx('cer16.urg_atencion_desc') : n === 'aldia' ? tx('cer16.urg_aldia_desc') : tx('cer16.urg_frio_desc');
}
export function rotuloGrupo(g: GrupoEtapa, tx: TSistema): string {
  return g === 'inicio' ? tx('cer16.grupo_inicio') : g === 'cita' ? tx('cer16.grupo_cita') : g === 'propuesta' ? tx('cer16.grupo_propuesta')
    : g === 'cierre' ? tx('cer16.grupo_cierre') : g === 'caida' ? tx('cer16.grupo_caida') : tx('cer16.grupo_perdido');
}

/** Tono categórico de una empresa: hash FNV-1a del nombre sin acentos ni mayúsculas → 1..8. El mismo nombre da siempre el mismo tono. */
export function tonoDe(nombre: string): number {
  const limpio = nombre.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  let h = 2166136261;
  for (const c of limpio) {
    h = Math.imul(h ^ (c.codePointAt(0) ?? 0), 16777619) >>> 0;
  }
  return (h % 8) + 1;
}

const NEXOS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'sa', 's', 'a', 'cv', 'c', 'v', 'sapi', 'rl', 'srl', 'sc']);

/** Las iniciales de la empresa: dos letras (primeras de las dos primeras palabras con sustancia, o las dos primeras de una sola palabra). */
export function inicialesDe(nombre: string): string {
  const palabras = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^A-Za-z0-9]+/).filter(Boolean);
  const utiles = palabras.filter((w) => !NEXOS.has(w.toLowerCase()));
  const base = utiles.length > 0 ? utiles : palabras;
  if (base.length === 0) return '?';
  const letras = base.length === 1 ? base[0].slice(0, 2) : `${base[0][0]}${base[1][0]}`;
  return letras.toUpperCase();
}
