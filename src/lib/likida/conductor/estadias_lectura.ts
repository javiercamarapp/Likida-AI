import type { PoliticaDetencion } from '../estadias/motor';
import {
  calcularEstancias, resumirEstadias, valorarEstancias, type FilaEstadia, type ResumenEstadias, type ViajeParaCobro,
} from './estadias_anden';
import type { DatosEstadias, ViajeTablero } from './repo_validacion';
import type { ResultadoValidacion } from './validacion';

// ═══════════════════════════════════════════════════════════════════════════
// De los datos leídos de un periodo a las FILAS de estadía — puro.
// Lo comparten el panel, el CSV de /v1/estadias y el servicio para la liquidación.
// ═══════════════════════════════════════════════════════════════════════════

export function aViajeParaCobro(v: ViajeTablero, sitios: ReadonlyMap<string, string>): ViajeParaCobro {
  return {
    id: v.id, folio: v.folio, estatus: v.estatus, operadorNombre: v.operadorNombre, clienteId: v.clienteId, clienteNombre: v.clienteNombre,
    terminalNombre: v.terminalNombre, origen: v.origen, destino: v.destino,
    origenSitio: v.origenSitioId ? sitios.get(v.origenSitioId) ?? null : null,
    destinoSitio: v.destinoSitioId ? sitios.get(v.destinoSitioId) ?? null : null,
  };
}

export interface ResultadoEstadiasPeriodo {
  filas: FilaEstadia[];
  resumen: ResumenEstadias;
  truncada: boolean;
}

/** Las estancias de TODOS los viajes leídos, valoradas con el pacto del cliente (gana) o el de la flota. */
export function armarFilasEstadias(
  datos: DatosEstadias, ahora: Date,
  politicas: { flota: PoliticaDetencion | null; porCliente: ReadonlyMap<string, PoliticaDetencion> },
  /** Si se da, solo estas estancias (p. ej. el panel de operación no valora dinero: pasa `soloMinutos`). */
  opciones: { soloLugar?: 'carga' | 'descarga' } = {},
): ResultadoEstadiasPeriodo {
  const hitosPorViaje = new Map<string, typeof datos.hitos>();
  for (const h of datos.hitos) hitosPorViaje.set(h.viajeId, [...(hitosPorViaje.get(h.viajeId) ?? []), h]);

  const filas: FilaEstadia[] = [];
  for (const v of datos.viajes) {
    const hs = hitosPorViaje.get(v.id) ?? [];
    const validaciones = new Map<string, ResultadoValidacion>();
    for (const veredicto of datos.veredictos) {
      const h = hs.find((x) => x.id === veredicto.hitoId);
      if (h && veredicto.ciclo === h.ciclo) validaciones.set(h.id, veredicto.resultado);
    }
    const evidencias = new Map<string, number>();
    for (const e of datos.evidencias) {
      const h = hs.find((x) => x.id === e.hitoId);
      if (h && e.ciclo === h.ciclo && e.ruta !== null) evidencias.set(h.id, (evidencias.get(h.id) ?? 0) + 1);
    }
    let estancias = calcularEstancias(v, hs, ahora, { validaciones, evidencias });
    if (opciones.soloLugar) estancias = estancias.filter((e) => e.lugar === opciones.soloLugar);
    filas.push(...valorarEstancias(aViajeParaCobro(v, datos.sitios), estancias, politicas));
  }
  // Más reciente primero (por la hora de llegada).
  filas.sort((a, b) => (b.estancia.llegada?.en ?? '').localeCompare(a.estancia.llegada?.en ?? ''));
  return { filas, resumen: resumirEstadias(filas), truncada: datos.truncada };
}

/** Los días «AAAA-MM-DD» del periodo → el instante de inicio y de fin (exclusivo) en hora de México. */
export function rangoDeDias(desde: string, hasta: string, maxDias = 93): { desde: Date; hasta: Date } | { error: string } {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(desde) || !re.test(hasta)) return { error: 'Las fechas van como AAAA-MM-DD.' };
  const ini = new Date(`${desde}T00:00:00-06:00`);
  const fin = new Date(new Date(`${hasta}T00:00:00-06:00`).getTime() + 86_400_000);
  if (Number.isNaN(ini.getTime()) || Number.isNaN(fin.getTime())) return { error: 'Alguna fecha no existe.' };
  if (ini.toISOString().slice(0, 10) > fin.toISOString().slice(0, 10) || fin <= ini) return { error: '`desde` no puede ser posterior a `hasta`.' };
  if ((fin.getTime() - ini.getTime()) / 86_400_000 > maxDias) return { error: `El periodo máximo es de ${maxDias} días.` };
  return { desde: ini, hasta: fin };
}
