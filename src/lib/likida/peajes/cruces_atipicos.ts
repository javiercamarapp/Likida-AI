import { normalizarNombre } from './formatos';
import { haversineM, coordenadasValidas } from './geo';

// ═══════════════════════════════════════════════════════════════════════════
// EL DETECTOR DE CRUCES ATÍPICOS — segunda iteración (alerta a un supervisor).
//
// Finanzas lo pidió como «si fuera automático nos gustaría ver: chécate, este es
// irregular»: la misma caseta cruzada varias veces de madrugada, o una unidad que
// aparece en dos casetas lejanas en poco tiempo. Todos los umbrales son
// CONFIGURABLES y ningún valor viene "calibrado con datos del cliente": los
// defaults son un punto de partida conservador, declarado como tal.
//
// Tres señales (cada una es un CANDIDATO para revisar, nunca un veredicto):
//   repeticion_caseta   la misma unidad cruza la MISMA caseta `repeticiones` o más
//                       veces dentro de `ventanaHoras`.
//   horario_anomalo     un cruce dentro de la franja `horario` (p. ej. 01:00–04:59),
//                       solo si la flota la configuró (por defecto NO se aplica).
//   salto_imposible     dos cruces consecutivos de la misma unidad en casetas DISTINTAS
//                       cuya distancia en línea recta, entre el tiempo transcurrido, exige
//                       más de `velocidadMaxKmh`. Necesita coordenadas de AMBAS casetas
//                       (opcionales, nunca inventadas): sin ellas la señal no se aplica y se dice.
//
// La identidad de la unidad es la que declara el archivo (`unidad`), o el TAG si no hay.
// PURO: sin base, sin red.
// ═══════════════════════════════════════════════════════════════════════════

export type SenalAtipica = 'repeticion_caseta' | 'horario_anomalo' | 'salto_imposible';

export const ETIQUETA_SENAL: Record<SenalAtipica, string> = {
  repeticion_caseta: 'Misma caseta, muchas veces',
  horario_anomalo: 'Cruce en horario anómalo',
  salto_imposible: 'Dos casetas lejanas en poco tiempo',
};

export interface UmbralesAtipicos {
  /** Veces que una unidad cruza la misma caseta dentro de la ventana para avisar. Default 4. */
  repeticiones: number;
  /** Ventana de horas de la repetición. Default 6. */
  ventanaHoras: number;
  /** Franja anómala «HH:MM»–«HH:MM» (puede cruzar medianoche). `null` = no se aplica (default). */
  horario: { desde: string; hasta: string } | null;
  /** Velocidad máxima plausible entre dos casetas, en línea recta. Default 130 km/h. */
  velocidadMaxKmh: number;
  /** Tiempo mínimo entre dos cruces para evaluar el salto (evita ruido por horas redondeadas). Default 5 min. */
  minutosMinimosSalto: number;
}

export const UMBRALES_ATIPICOS_DEFAULT: UmbralesAtipicos = {
  repeticiones: 4, ventanaHoras: 6, horario: null, velocidadMaxKmh: 130, minutosMinimosSalto: 5,
};

export interface CruceAtipico {
  senal: SenalAtipica;
  unidad: string;
  /** Líneas (0-based) del archivo que forman la señal. */
  indices: number[];
  fecha: string;
  caseta: string | null;
  monto: number;
  quePaso: string;
  queSignifica: string;
  queHacer: string;
}

export interface LineaAtipica {
  indice: number;
  fecha: string | null;
  hora?: string | null;
  caseta: string | null;
  tag: string | null;
  unidad: string | null;
  monto: number;
}

export interface CasetaConCoordenadas { nombre: string; lat: number; lng: number }

export interface ResultadoAtipicos {
  atipicos: CruceAtipico[];
  /** Señales que no se pudieron aplicar y por qué. */
  noAplicadas: Array<{ senal: SenalAtipica; motivo: string }>;
}

const MIN = 60_000;

function instante(l: LineaAtipica): number | null {
  if (!l.fecha || !l.hora) return null;
  const t = Date.parse(`${l.fecha}T${l.hora.slice(0, 8)}Z`); // reloj local del archivo, sin huso: solo se usan DIFERENCIAS
  return Number.isFinite(t) ? t : null;
}

function enFranja(hora: string, f: { desde: string; hasta: string }): boolean {
  const h = hora.slice(0, 5);
  return f.desde <= f.hasta ? h >= f.desde && h <= f.hasta : h >= f.desde || h <= f.hasta;
}

/** Valida y completa los umbrales; devuelve el motivo si alguno es absurdo. */
export function validarUmbrales(x: Partial<UmbralesAtipicos>): { ok: true; umbrales: UmbralesAtipicos } | { ok: false; motivo: string } {
  const u = { ...UMBRALES_ATIPICOS_DEFAULT, ...x };
  if (!Number.isInteger(u.repeticiones) || u.repeticiones < 2) return { ok: false, motivo: 'Las repeticiones deben ser un entero de 2 o más.' };
  if (!(u.ventanaHoras > 0 && u.ventanaHoras <= 72)) return { ok: false, motivo: 'La ventana debe estar entre 0 y 72 horas.' };
  if (!(u.velocidadMaxKmh >= 60 && u.velocidadMaxKmh <= 300)) return { ok: false, motivo: 'La velocidad máxima debe estar entre 60 y 300 km/h.' };
  if (!(u.minutosMinimosSalto >= 0 && u.minutosMinimosSalto <= 120)) return { ok: false, motivo: 'Los minutos mínimos del salto deben estar entre 0 y 120.' };
  if (u.horario) {
    const re = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!re.test(u.horario.desde) || !re.test(u.horario.hasta)) return { ok: false, motivo: 'La franja de horario debe ser HH:MM a HH:MM.' };
  }
  return { ok: true, umbrales: u };
}

export function detectarAtipicos(
  lineas: readonly LineaAtipica[],
  casetasConCoordenadas: readonly CasetaConCoordenadas[] = [],
  parciales: Partial<UmbralesAtipicos> = {},
): ResultadoAtipicos {
  const v = validarUmbrales(parciales);
  const u = v.ok ? v.umbrales : UMBRALES_ATIPICOS_DEFAULT;
  const atipicos: CruceAtipico[] = [];
  const noAplicadas: ResultadoAtipicos['noAplicadas'] = [];
  if (!v.ok) {
    noAplicadas.push({ senal: 'repeticion_caseta', motivo: `Los umbrales configurados no son válidos (${v.motivo}): se usaron los de partida.` });
  }

  const conInstante = lineas
    .map((l) => ({ l, t: instante(l), quien: (l.unidad?.trim() || l.tag?.trim() || '') }))
    .filter((x): x is { l: LineaAtipica; t: number; quien: string } => x.t !== null && x.quien !== '');
  if (lineas.length > 0 && conInstante.length === 0) {
    const motivo = 'El archivo no trae hora o no trae unidad/TAG: no se puede ver el patrón de cruces de una unidad.';
    noAplicadas.push({ senal: 'repeticion_caseta', motivo }, { senal: 'salto_imposible', motivo });
  }

  const porQuien = new Map<string, Array<{ l: LineaAtipica; t: number }>>();
  for (const x of conInstante) {
    const a = porQuien.get(x.quien) ?? [];
    a.push({ l: x.l, t: x.t });
    porQuien.set(x.quien, a);
  }
  for (const a of porQuien.values()) a.sort((p, q) => p.t - q.t || p.l.indice - q.l.indice);

  // ── repeticion_caseta ─────────────────────────────────────────────────────
  for (const [quien, cruces] of porQuien) {
    const porCaseta = new Map<string, Array<{ l: LineaAtipica; t: number }>>();
    for (const c of cruces) {
      const k = normalizarNombre(c.l.caseta);
      if (!k) continue;
      const a = porCaseta.get(k) ?? [];
      a.push(c);
      porCaseta.set(k, a);
    }
    for (const a of porCaseta.values()) {
      // Ventana deslizante: cada `j` marcado pertenece a una racha; las `j` marcadas contiguas son UNA señal.
      let i = 0;
      let racha: { desde: number; hasta: number } | null = null;
      const cerrar = () => {
        if (!racha) return;
        const grupo = a.slice(racha.desde, racha.hasta + 1);
        atipicos.push({
          senal: 'repeticion_caseta', unidad: quien, indices: grupo.map((g) => g.l.indice),
          fecha: grupo[0].l.fecha as string, caseta: grupo[0].l.caseta, monto: Math.round(grupo.reduce((s, g) => s + g.l.monto, 0) * 100) / 100,
          quePaso: `${quien} cruzó ${grupo[0].l.caseta ?? 'una caseta'} ${grupo.length} veces en ${((grupo[grupo.length - 1].t - grupo[0].t) / 3_600_000).toFixed(1)} horas (a partir del ${grupo[0].l.fecha} ${grupo[0].l.hora?.slice(0, 5) ?? ''}).`,
          queSignifica: 'Cruzar la misma caseta tantas veces en pocas horas es poco común. Puede ser una ruta de ida y vuelta legítima, un desvío, un TAG usado por otra unidad o cobros repetidos del proveedor. No es un cobro indebido confirmado.',
          queHacer: 'Pregunta al despacho si la unidad hizo ese recorrido. Si no, revisa si el TAG lo trae otra unidad y valida los cobros con el proveedor.',
        });
        racha = null;
      };
      for (let j = 0; j < a.length; j++) {
        while (a[j].t - a[i].t > u.ventanaHoras * 60 * MIN) i++;
        if (j - i + 1 >= u.repeticiones) {
          racha = racha ? { desde: Math.min(racha.desde, i), hasta: j } : { desde: i, hasta: j };
        } else {
          cerrar();
        }
      }
      cerrar();
    }
  }

  // ── horario_anomalo ───────────────────────────────────────────────────────
  if (u.horario) {
    for (const x of conInstante) {
      if (!enFranja(x.l.hora as string, u.horario)) continue;
      atipicos.push({
        senal: 'horario_anomalo', unidad: x.quien, indices: [x.l.indice], fecha: x.l.fecha as string, caseta: x.l.caseta, monto: x.l.monto,
        quePaso: `${x.quien} cruzó ${x.l.caseta ?? 'una caseta'} el ${x.l.fecha} a las ${(x.l.hora as string).slice(0, 5)}, dentro de la franja que la flota marcó como anómala (${u.horario.desde}–${u.horario.hasta}).`,
        queSignifica: 'La flota considera irregular circular en ese horario. El cruce puede estar autorizado: solo indica que cae fuera de lo habitual.',
        queHacer: 'Confirma con el despacho que la unidad tenía viaje a esa hora.',
      });
    }
  } else {
    noAplicadas.push({ senal: 'horario_anomalo', motivo: 'La flota no ha definido una franja de horario anómalo: configúrala para activar esta señal.' });
  }

  // ── salto_imposible ───────────────────────────────────────────────────────
  const coords = new Map<string, CasetaConCoordenadas>();
  for (const c of casetasConCoordenadas) if (coordenadasValidas(c)) coords.set(normalizarNombre(c.nombre), c);
  if (coords.size === 0) {
    noAplicadas.push({ senal: 'salto_imposible', motivo: 'Ninguna caseta tiene coordenadas cargadas: sin ellas no se puede medir la distancia entre dos cruces. Cárgalas (opcionales, de una fuente real) para activar esta señal.' });
  } else {
    let sinCoordenadas = 0;
    for (const [quien, cruces] of porQuien) {
      for (let i = 1; i < cruces.length; i++) {
        const a = cruces[i - 1];
        const b = cruces[i];
        const ka = normalizarNombre(a.l.caseta);
        const kb = normalizarNombre(b.l.caseta);
        if (!ka || !kb || ka === kb) continue;
        const ca = coords.get(ka);
        const cb = coords.get(kb);
        if (!ca || !cb) { sinCoordenadas++; continue; }
        const minutos = (b.t - a.t) / MIN;
        if (minutos < u.minutosMinimosSalto) continue;
        const km = haversineM(ca, cb) / 1000;
        const kmh = km / (minutos / 60);
        if (kmh > u.velocidadMaxKmh) {
          atipicos.push({
            senal: 'salto_imposible', unidad: quien, indices: [a.l.indice, b.l.indice], fecha: b.l.fecha as string, caseta: b.l.caseta,
            monto: Math.round((a.l.monto + b.l.monto) * 100) / 100,
            quePaso: `${quien} pasó por ${a.l.caseta} y ${Math.round(minutos)} minutos después por ${b.l.caseta}, a ${km.toFixed(0)} km en línea recta: tendría que ir a ${kmh.toFixed(0)} km/h.`,
            queSignifica: 'Una misma unidad no puede estar en dos casetas tan lejanas en tan poco tiempo. Lo más probable es que el TAG lo traiga otro vehículo, que la unidad del archivo esté mal asignada o que el proveedor haya registrado mal una hora.',
            queHacer: 'Revisa a qué unidades corresponde ese TAG y pide al proveedor confirmar la hora de ambos cruces.',
          });
        }
      }
    }
    if (sinCoordenadas > 0) {
      noAplicadas.push({ senal: 'salto_imposible', motivo: `${sinCoordenadas} pares de cruces consecutivos no se pudieron medir porque alguna de sus casetas no tiene coordenadas.` });
    }
  }

  atipicos.sort((p, q) => p.indices[0] - q.indices[0]);
  return { atipicos, noAplicadas };
}
