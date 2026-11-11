import type { Variables } from '@/lib/i18n/traducir';
import type { ClaveDe } from '@/lib/i18n/catalogo';
import type { EvaluacionFuente, IdFuente } from './estado';

// ═══════════════════════════════════════════════════════════════════════════
// El copy de una evaluación sale del diccionario `fuentes` (es/en), nunca de un
// literal: `estado.ts` devuelve un MOTIVO, y este archivo lo vuelve frase con
// el traductor que le pasen (`getT('fuentes')` en servidor, `useT` en cliente).
// ═══════════════════════════════════════════════════════════════════════════

export type TFuentes = (clave: ClaveDe<'fuentes'>, variables?: Variables) => string;

/** «hace 3 h», «hace 2 días»: legible y sin falsa precisión. */
export function haceTexto(ms: number, t: TFuentes): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return t('hace.menosMin');
  if (min < 60) return t('hace.min', { n: min });
  const h = Math.floor(min / 60);
  if (h < 48) return t('hace.h', { n: h });
  return t('hace.dias', { n: Math.floor(h / 24) });
}

/** «cada 15 min», «cada 3 días». */
export function cadaTexto(ms: number, t: TFuentes): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return t('cada.min', { n: min });
  const h = Math.round(min / 60);
  if (h < 48) return t('cada.h', { n: h });
  return t('cada.dias', { n: Math.round(h / 24) });
}

export function nombreFuente(id: IdFuente, t: TFuentes): string {
  return t(`nombre.${id}`);
}

export function rotuloEstado(e: EvaluacionFuente, t: TFuentes): string {
  return t(`rotulo.${e.estado ?? 'sin_dato'}`);
}

/** La frase completa de la evaluación, con su fuente y su cadencia a la vista. */
export function detalleFuente(e: EvaluacionFuente, t: TFuentes): string {
  return t(`detalle.${e.motivo}`, {
    senal: t(`senal.${e.id}`),
    hace: e.haceMs === null ? '' : haceTexto(e.haceMs, t),
    cada: cadaTexto(e.cadenciaMs, t),
    falla: e.falla ?? '',
    n: e.muestra30d ?? 0,
  }).replace(/\s+([.;])/g, '$1');
}

export interface FilaFuenteTexto {
  id: string;
  nombre: string;
  rotulo: string;
  tono: EvaluacionFuente['tono'];
  detalle: string;
  nota: string;
}

/** Las filas de `ListaFuentes`, con todo el copy ya resuelto. `notaExtra` agrega algo propio de la pantalla (p. ej. el reloj). */
export function filasDeEvaluaciones(
  evals: ReadonlyArray<EvaluacionFuente>,
  t: TFuentes,
  notaExtra?: (e: EvaluacionFuente) => string | null,
): FilaFuenteTexto[] {
  return evals.map((e) => ({
    id: e.id,
    nombre: nombreFuente(e.id, t),
    rotulo: rotuloEstado(e, t),
    tono: e.tono,
    detalle: detalleFuente(e, t),
    nota: [t('conexiones.cadencia', { cada: cadaTexto(e.cadenciaMs, t) }), notaExtra?.(e) ?? null].filter(Boolean).join(' · '),
  }));
}
