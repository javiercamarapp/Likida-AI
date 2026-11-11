// Lógica pura del Cerebro de ventas (filtros, orden, radio y CSV), sacada de cerebro.tsx para poder fijarla con pruebas sin montar el mapa.
// Nada de React aquí: lo que el Cerebro decide sobre la cartera vive en este archivo y la piel del mapa solo lo pinta.

import { COLOR_EMBUDO, NOMBRE_GIRO, type Giro, type ProspectoMapa, type Tamano, type TextosProspecto } from '@/lib/admin/prospectos-mapa-client';
import { celdaCsv } from './csv_prospectos';

export interface Filtros {
  giros: Set<Giro> | null;      // null = todas
  etapas: Set<string> | null;
  fuentes: Set<string> | null;
  minUrgencia: 0 | 50 | 70;
  soloTel: boolean;
  soloDecisor: boolean;
  orden: 'cierre' | 'urgencia' | 'recientes' | 'completos' | 'similitud' | 'necesidad';
  tamanos: Set<Tamano | 'n/d'> | null;   // null = todos
  minCompletitud: 0 | 50 | 75;
  /** 0140, GENERADAS — ver CRITERIO_SCORES.similitud/.necesidad. */
  minSimilitud: 0 | 40 | 65 | 85;
  minNecesidad: 0 | 40 | 65 | 85;
  /** «Sin contactar en N días» (0130): 0 = apagado; N = sin toque registrado en los últimos N días (o nunca tocado). */
  sinToqueDias: 0 | 7 | 14 | 30;
  soloMensajeIA: boolean;
  soloVacante: boolean;
  /** «Todos a 50 km de Nuevo Laredo»: centro elegido de la lista de plazas + radio. 0 = apagado. Con radio activo solo pasan los
   *  prospectos CON coordenadas: al resto no se le adivina distancia. */
  centro: { lat: number; lng: number; nombre: string } | null;
  radioKm: number;
}

export const SIN_FILTROS: Filtros = {
  giros: null, etapas: null, fuentes: null, minUrgencia: 0,
  soloTel: false, soloDecisor: false, orden: 'cierre',
  tamanos: null, minCompletitud: 0, soloMensajeIA: false, soloVacante: false,
  sinToqueDias: 0, minSimilitud: 0, minNecesidad: 0,
  centro: null, radioKm: 0,
};

/** Distancia esférica en km: suficiente para un radio comercial. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** ADITIVO: por omisión nada seleccionado (null = sin filtro, se ve todo); un clic AGREGA el valor, otro lo quita; el conjunto vacío vuelve a null. */
export function alternarEnSet<T>(actual: Set<T> | null, valor: T): Set<T> | null {
  const s = new Set(actual ?? []);
  if (s.has(valor)) s.delete(valor); else s.add(valor);
  return s.size === 0 ? null : s;
}

/** Cuántos criterios están encendidos (el contador del botón «Filtros»). */
export function contarFiltrosActivos(f: Filtros): number {
  return (f.giros ? 1 : 0) + (f.etapas ? 1 : 0) + (f.fuentes ? 1 : 0)
    + (f.minUrgencia ? 1 : 0) + (f.soloTel ? 1 : 0) + (f.soloDecisor ? 1 : 0)
    + (f.tamanos ? 1 : 0) + (f.minCompletitud ? 1 : 0)
    + (f.soloMensajeIA ? 1 : 0) + (f.soloVacante ? 1 : 0)
    + (f.sinToqueDias ? 1 : 0)
    + (f.minSimilitud ? 1 : 0) + (f.minNecesidad ? 1 : 0)
    + (f.centro && f.radioKm ? 1 : 0);
}

/** La cartera que pasa los filtros. `ahora` (ms) entra como argumento para que «sin toque en N días» sea determinista. */
export function filtrarProspectos(prospectos: readonly ProspectoMapa[], f: Filtros, ahora: number): ProspectoMapa[] {
  return prospectos.filter((p) =>
    (!f.giros || f.giros.has(p.giro))
    && (!f.etapas || f.etapas.has(p.estado))
    && (!f.fuentes || f.fuentes.has(p.fuente))
    && p.urgencia >= f.minUrgencia
    && (!f.soloTel || p.telefono !== null)
    && (!f.soloDecisor || p.contacto !== null)
    && (!f.tamanos || f.tamanos.has(p.tamano ?? 'n/d'))
    && p.completitud >= f.minCompletitud
    && p.similitudIcpPct >= f.minSimilitud
    && p.necesidadPct >= f.minNecesidad
    && (!f.soloMensajeIA || p.mensajesGeneradosEn !== null)
    && (!f.soloVacante || p.vacante !== null)
    && (f.sinToqueDias === 0 || !p.ultimoToque
      || (ahora - new Date(p.ultimoToque).getTime()) >= f.sinToqueDias * 86_400_000)
    && (!f.centro || f.radioKm === 0
      || (p.lat !== null && p.lng !== null && haversineKm(f.centro, { lat: p.lat, lng: p.lng }) <= f.radioKm)),
  );
}

/** El comparador del orden elegido. `recientes` no reordena: el servidor ya entrega created_at desc. */
export function ordenarProspectos(lista: readonly ProspectoMapa[], orden: Filtros['orden']): ProspectoMapa[] {
  return [...lista].sort((a, b) =>
    orden === 'urgencia' ? (b.urgencia - a.urgencia || b.cierre - a.cierre)
      : orden === 'recientes' ? 0
        : orden === 'completos' ? (b.completitud - a.completitud || b.cierre - a.cierre)
          : orden === 'similitud' ? (b.similitudIcpPct - a.similitudIcpPct || b.necesidadPct - a.necesidadPct)
            : orden === 'necesidad' ? (b.necesidadPct - a.necesidadPct || b.similitudIcpPct - a.similitudIcpPct)
              : (b.cierre - a.cierre || b.urgencia - a.urgencia));
}

/** Las plazas con coordenadas (centro del radio): promedio por ciudad, las 250 más pobladas. */
export function plazasDe(prospectos: readonly ProspectoMapa[]): Array<{ nombre: string; lat: number; lng: number; n: number }> {
  const acc = new Map<string, { lat: number; lng: number; n: number }>();
  for (const p of prospectos) {
    if (p.lat === null || p.lng === null || !p.ciudad) continue;
    const k = p.entidad ? `${p.ciudad}, ${p.entidad}` : p.ciudad;
    const a = acc.get(k) ?? { lat: 0, lng: 0, n: 0 };
    acc.set(k, { lat: a.lat + p.lat, lng: a.lng + p.lng, n: a.n + 1 });
  }
  return [...acc.entries()]
    .map(([nombre, a]) => ({ nombre, lat: a.lat / a.n, lng: a.lng / a.n, n: a.n }))
    .sort((x, y) => y.n - x.n)
    .slice(0, 250);
}

/** El CSV de la vista actual: columnas fijas, comillas escapadas y BOM para que Excel en español lo abra con acentos. `notas` llega
 *  por los textos que el exportador pidió por id ANTES de armar el archivo. */
export function csvDe(lista: readonly ProspectoMapa[], textos: ReadonlyMap<string, TextosProspecto>): string {
  const cab = ['empresa', 'giro', 'etapa', 'urgencia_pct', 'cierre_pct', 'similitud_icp_pct', 'necesidad_pct', 'num_unidades', 'contacto', 'telefono', 'correo', 'ciudad', 'entidad', 'vacante', 'fuente', 'lat', 'lng', 'notas'];
  const filas = lista.map((p) => [
    p.empresa, NOMBRE_GIRO[p.giro], COLOR_EMBUDO[p.estado]?.nombre ?? p.estado, p.urgencia, p.cierre,
    p.similitudIcpPct, p.necesidadPct, p.numUnidades,
    p.contacto, p.telefono, p.correo, p.ciudad, p.entidad, p.vacante, p.fuente, p.lat, p.lng,
    textos.get(p.id)?.notas ?? null,
  ].map(celdaCsv).join(','));
  return '﻿' + [cab.join(','), ...filas].join('\n');
}
