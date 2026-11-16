// ═══════════════════════════════════════════════════════════════════════════
// ⓘ POR IDIOMA. Pieza pura (sin React): el español sale de `info-catalogo.ts` (siempre en el bundle, como hasta hoy); el inglés vive en
// `info-textos/en/*` y se carga PEREZOSAMENTE (import dinámico) solo cuando el idioma activo es 'en', así que quien usa español no descarga
// ~1,500 textos en inglés. `infoDeIdioma` es síncrona: devuelve el inglés si ya se cargó y existe esa clave; si no, el español.
// El hook que dispara la carga y re-pinta es `useInfoTexto` (`componentes/use-info-texto.ts`).
// ═══════════════════════════════════════════════════════════════════════════
import type { Idioma } from '@/lib/i18n/idioma';
import { infoDe, type InfoClave, type InfoTexto } from './info-catalogo';

export type MapaInfo = Readonly<Record<string, InfoTexto>>;

let cacheEn: MapaInfo | null = null;
let promesaEn: Promise<MapaInfo> | null = null;

/** Carga (una sola vez) los textos en inglés y los junta en un solo mapa por clave. */
export function cargarInfoEn(): Promise<MapaInfo> {
  if (cacheEn) return Promise.resolve(cacheEn);
  promesaEn ??= Promise.all([
    import('./info-textos/en/catalogo'),
    import('./info-textos/en/administracion'),
    import('./info-textos/en/agentes'),
    import('./info-textos/en/agentes_cpv'),
    import('./info-textos/en/liquidacion'),
    import('./info-textos/en/operacion'),
  ]).then(([cat, adm, ag, cpv, liq, op]) => {
    cacheEn = { ...cat.INFO_CATALOGO_EN, ...adm.INFO_ADMIN_EN, ...ag.INFO_AGENTES_EN, ...cpv.INFO_AGENTES_CPV_EN, ...liq.INFO_LIQUIDACION_EN, ...op.INFO_OPERACION_EN };
    return cacheEn;
  }).catch((e: unknown) => { promesaEn = null; throw e; });
  return promesaEn;
}

/** El mapa en inglés si ya se cargó; `null` si no. */
export function infoEnCargado(): MapaInfo | null {
  return cacheEn;
}

/** Solo para pruebas: deja el mapa en inglés ya cargado (o `null` para vaciarlo). */
export function sembrarInfoEnParaPruebas(mapa: MapaInfo | null): void {
  cacheEn = mapa;
  promesaEn = mapa ? Promise.resolve(mapa) : null;
}

/** Texto de una clave en el idioma pedido; inglés si idioma==='en' y ya se cargó y existe, si no español (falla fuerte si la clave no existe). */
export function infoDeIdioma(clave: InfoClave, idioma: Idioma = 'es'): InfoTexto {
  const es = infoDe(clave);
  if (idioma !== 'en') return es;
  return cacheEn?.[clave] ?? es;
}
