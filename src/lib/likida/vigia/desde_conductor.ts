// ═══════════════════════════════════════════════════════════════════════════
// LO QUE EL AGENTE 5 «CONDUCTOR» LE ENTREGA AL VIGÍA — PURO.
//
// El Vigía le contesta a un CLIENTE: «¿dónde va?», «¿a qué hora llega?». Hasta la
// ronda 02 solo veía los tres sellos viejos de la 0090 y `etaIso` era siempre
// `null`. El Conductor ya guarda lo que faltaba: los cinco hitos (con la hora del
// MENSAJE del chofer), la cita y la ETA de cada punto y si el operador está en un
// andén. Este archivo traduce `conductor/estatus_viaje.ts` a lo que el Vigía dice.
//
// ── LO QUE NO CAMBIA ────────────────────────────────────────────────────────
//   · NO es telemetría: la hora de un hito es la del mensaje del chofer (o la que
//     declaró la oficina), y la ETA/cita es la que alguien capturó. El redactor lo
//     dice así; este archivo solo entrega el dato con su fuente.
//   · Sin dato no se rellena: sin cita ni ETA, `etaIso` queda `null` (el Vigía
//     contesta «lo consulto» y escala); sin hitos, vale lo que digan los sellos.
//   · Un hito que el Conductor no tiene (el viaje no usa el agente) NO borra lo que
//     digan los sellos viejos: se mezclan, gana el dato más reciente.
// ═══════════════════════════════════════════════════════════════════════════
import type { EstatusViaje as EstatusConductor } from '../conductor/estatus_viaje';
import type { TipoHito } from '../conductor/tipos';
import type { EstatusViaje, EtapaViaje, HitoViaje } from './estatus_viaje';

/** La etapa que cuenta el ÚLTIMO hito registrado. */
const ETAPA_POR_HITO: Record<TipoHito, EtapaViaje> = {
  llegada_carga: 'en_origen',
  salida_carga: 'en_ruta',
  llegada_descarga: 'en_destino',
  salida_descarga: 'entregado',
  regreso: 'regresando',
};

export interface ParteDelConductor {
  etapa: EstatusViaje['etapa'] | null;
  ultimoHito: HitoViaje | null;
  etaIso: string | null;
  etaFuente: 'cita' | 'eta' | null;
  citaCarga: EstatusViaje['citaCarga'];
  enAnden: EstatusViaje['enAnden'];
}

const VACIA: ParteDelConductor = { etapa: null, ultimoHito: null, etaIso: null, etaFuente: null, citaCarga: null, enAnden: null };

/**
 * Lo que aporta el Conductor, o la parte vacía (el viaje sigue diciendo lo que digan sus sellos).
 * Un hito `omitido` o `esperado` no es un dato: el Conductor solo expone como «último» uno ya
 * recibido o validado.
 */
export function parteDelConductor(c: EstatusConductor | null): ParteDelConductor {
  if (!c) return VACIA;
  const ultimo = c.ultimoHito;
  const en = ultimo?.hora ?? null;
  const hito: HitoViaje | null = ultimo && en ? { tipo: ultimo.tipo, en } : null;
  return {
    etapa: ultimo ? ETAPA_POR_HITO[ultimo.tipo] : null,
    ultimoHito: hito,
    etaIso: c.citas.descarga?.en ?? null,
    etaFuente: c.citas.descarga?.fuente ?? null,
    citaCarga: c.citas.carga,
    enAnden: c.enAnden ? { lugar: c.enAnden.lugar, desde: c.enAnden.desde } : null,
  };
}

/**
 * Mezcla lo que dicen los sellos del viaje con lo del Conductor. Gana el hito más reciente: un chofer que
 * usa el agente tiene hitos finos; uno que no, conserva lo que digan los sellos. Un viaje liquidado queda
 * `cerrado` pase lo que pase (la liquidación manda sobre cualquier hito tardío).
 */
export function mezclarEstatus(
  base: Pick<EstatusViaje, 'etapa' | 'ultimoHito'>, parte: ParteDelConductor,
): Pick<EstatusViaje, 'etapa' | 'ultimoHito'> {
  if (base.etapa === 'cerrado') return { etapa: 'cerrado', ultimoHito: parte.ultimoHito ?? base.ultimoHito };
  const ultimoHito = masReciente(base.ultimoHito, parte.ultimoHito);
  // La etapa sale del hito ganador: si fue el del Conductor, su etapa fina; si fue un sello viejo, la de los sellos.
  const gana = parte.ultimoHito !== null && ultimoHito === parte.ultimoHito;
  return { etapa: gana && parte.etapa ? parte.etapa : base.etapa, ultimoHito };
}

function masReciente(a: HitoViaje | null, b: HitoViaje | null): HitoViaje | null {
  if (!a) return b;
  if (!b) return a;
  // Empate: el del Conductor (más fino que el sello viejo que él mismo escribió).
  return Date.parse(a.en) > Date.parse(b.en) ? a : b;
}
