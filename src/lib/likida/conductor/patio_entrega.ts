import { logger } from '@/lib/logger';
import type { ConfigConductor } from './config';
import type { NuevoAviso, PuertosConductor } from './ejecutor';
import { puertosReales } from './ejecutor';
import type { Salida } from './mensajes';
import type { EventoPatioFila, ViajeContexto } from './repo';
import { leerEventosPatio, registrarEvento } from './repo';
import { limpiarComoDescarga } from './interprete';
import { listarSitios } from './repo_validacion';
import {
  NIVEL_AVISO_PATIO, armarAvisoPatioDistinto, armarPreguntaPatio, compararPatio, estadoPatio, ordenarPatios, patioDeTexto, textoEsperado,
  type Comparacion, type PatioOpcion,
} from './patio_regla';
import type { HitoFila } from './tipos';

export { leerTextoPatio, excepcionesPatio } from './patio_regla';

// ═══════════════════════════════════════════════════════════════════════════
// T-A5-44 — PATIO DE ENTREGA DECLARADO vs «ENTREGAR EN» (R20, R21).
//
// Requisito del cliente (reunión 15-oct, 47:56–51:48): al llegar a descargar, el chofer elige con BOTONES en qué patio entrega
// (los patios del catálogo + «otro, especifique»). Si elige uno distinto al que la instrucción dice, el supervisor de esa terminal
// recibe un aviso al instante (una caja un mes en patio equivocado genera estadías). Qué campo manda —«Entregar en» o el
// «destino» del requerimiento— es CONFIGURACIÓN (`patioQueManda`, por omisión «Entregar en»), no una decisión nuestra (D-5).
//
// ── CÓMO ENCAJA ────────────────────────────────────────────────────────────
//   · Pregunta: `atender.ts` llama a `preguntarPatio` justo después de registrar la llegada a descarga del chofer (es la respuesta a
//     SU mensaje: no es proactivo y no pasa por la compuerta de «unidad detenida»). Solo con `patioEntregaActivo` (apagado hasta la
//     fase 2) y con patios en el catálogo.
//   · Respuesta: botón `hito_patio:<viaje>:<patio|otro|masN>` o, tras «Otro», un texto «patio <nombre>». `responderPatio` la compara,
//     la guarda y, si difiere, avisa al supervisor de la terminal (claim primero: un solo aviso por llegada) y deja la excepción
//     en el tablero (`excepcionesPatio`, que lee la misma bitácora).
//   · Meta limita a 3 botones por mensaje: se muestran 2 patios por página y el tercer botón es «Más» o, en la última, «Otro».
//
// ── PERSISTENCIA (sin migración; Ruling) ───────────────────────────────────
//   Bitácora `viaje_hito_evento` del hito `llegada_descarga`: `validacion` con `detalle.clase = 'patio_entrega'` y `estado`
//   (preguntado | esperando_texto | respondido | alertado) y `atendido` cuando el supervisor toca «Ya lo atiendo». El claim del
//   aviso usa la clase `escalacion` con el nivel reservado 7 (el CHECK de `viaje_hito_aviso` no admite clases nuevas sin migración).
//   Si una migración propia lo reemplaza más adelante, solo cambia este archivo.
//
// ── LÍMITES CONOCIDOS ──────────────────────────────────────────────────────
//   · «Entregar en» no existe aún en `viaje` (BLOQUEO EXTERNO: campo del TMS): `ViajeContexto.entregarEn` opcional; sin él, el patio
//     esperado es el `destino`.
//   · Una llegada detectada por GPS sin mensaje del chofer no abre la pregunta (haría falta la plantilla `conductor_confirma_patio_v1`,
//     que deja T-A5-59).
//   · El nombre de los patios vive solo en datos de la flota, nunca aquí.
// ═══════════════════════════════════════════════════════════════════════════

const MAX_PATIOS = 30;
const TEXTO_PEDIR_NOMBRE = 'Escríbeme el nombre del patio donde estás entregando, empezando con la palabra «patio» (por ejemplo: patio Norte).';
const TEXTO_NO_PUDE_ANOTAR = 'No pude anotarlo ahorita. Intenta de nuevo en un momento. 🙏';
const una = (t: string, n: number): string => t.replace(/\s+/g, ' ').trim().slice(0, n);

// ── Con puertos ─────────────────────────────────────────────────────────────

export interface PuertosPatio extends Pick<PuertosConductor, 'reclamar' | 'cerrarAviso' | 'enviar' | 'destinatarios' | 'evento'> {
  patios(tenantId: string): Promise<PatioOpcion[]>;
  eventos(tenantId: string, viajeIds: string[]): Promise<EventoPatioFila[]>;
  /** A37-S36-03: como `evento`, pero devuelve si quedó guardado. Sin él (puertos de prueba) se asume que sí. */
  guardar?(h: HitoFila, evento: Parameters<PuertosConductor['evento']>[1], detalle: Record<string, string | number | boolean | null>): Promise<boolean>;
}

/** Escribe un renglón y dice si quedó: «respondido» no se acusa como anotado si se perdió (el tablero no vería la excepción). */
async function escribir(p: PuertosPatio, h: HitoFila, evento: Parameters<PuertosConductor['evento']>[1], d: Record<string, string | number | boolean | null>): Promise<boolean> {
  if (p.guardar) return p.guardar(h, evento, d);
  await p.evento(h, evento, d);
  return true;
}

export function puertosPatioReales(): PuertosPatio {
  const base = puertosReales();
  return {
    ...base,
    patios: async (tenantId) => {
      const { sitios } = await listarSitios(tenantId, { tipo: 'patio', limite: MAX_PATIOS });
      return sitios.filter((s) => s.activa).map((s) => ({ id: s.id, nombre: s.nombre }));
    },
    eventos: leerEventosPatio,
    guardar: registrarEvento,
  };
}

type ConfigPatio = Pick<ConfigConductor, 'patioEntregaActivo' | 'patioQueManda'>;
const detalle = (ciclo: number, estado: string, extra: Record<string, string | number | boolean | null> = {}) => ({ clase: 'patio_entrega', estado, ciclo, ...extra });

/**
 * Tras registrar la llegada a descarga: la pregunta del patio, o `null` (apagado, sin patios, ya preguntada, o la base falló: nunca
 * rompe el acuse de la llegada).
 */
export async function preguntarPatio(
  p: PuertosPatio, config: ConfigPatio, viaje: ViajeContexto, hito: HitoFila,
): Promise<Salida | null> {
  if (config.patioEntregaActivo !== true || hito.tipo !== 'llegada_descarga') return null;
  try {
    const patios = await p.patios(viaje.tenantId);
    if (patios.length === 0) return null;
    const previo = estadoPatio(await p.eventos(viaje.tenantId, [viaje.id]), hito.id, hito.ciclo);
    if (previo.preguntado || previo.respondido) return null;
    const { texto } = textoEsperado(viaje, config.patioQueManda ?? 'entregar_en');
    const ordenados = ordenarPatios(patios, patioDeTexto(texto, patios)?.id ?? null);
    await p.evento(hito, 'validacion', detalle(hito.ciclo, 'preguntado', { patios: ordenados.length }));
    return armarPreguntaPatio(viaje, ordenados, 0);
  } catch (e) {
    logger.warn('conductor.patio_pregunta_fallo', { viaje: viaje.id, err: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

export type RespuestaPatio =
  | { tipo: 'boton'; opcion: string }
  | { tipo: 'texto'; nombre: string };

export interface EntradaPatio {
  viaje: ViajeContexto;
  hito: HitoFila;
  config: ConfigPatio & Pick<ConfigConductor, 'zonaHoraria'>;
  respuesta: RespuestaPatio;
  ahora: Date;
}

/** La respuesta del chofer: la compara, la guarda y avisa al supervisor si difiere. Devuelve lo que se le contesta (nunca lanza). */
export async function responderPatio(p: PuertosPatio, e: EntradaPatio): Promise<Salida[]> {
  const { viaje, hito, ahora } = e;
  try {
    const [patios, eventos] = await Promise.all([p.patios(viaje.tenantId), p.eventos(viaje.tenantId, [viaje.id])]);
    const st = estadoPatio(eventos, hito.id, hito.ciclo);
    if (st.respondido) return [{ texto: `Ya tengo anotado tu patio de entrega: ${una(st.respondido.elegido, 60)}. 👍` }];
    if (e.respuesta.tipo === 'texto' && !st.preguntado && !st.esperandoTexto) return []; // «patio X» sin pregunta abierta: no es de este módulo
    if (patios.length === 0) return [{ texto: 'Ese aviso ya no está vigente. 👍' }];

    const { texto: esperadoTexto, campoUsado } = textoEsperado(viaje, e.config.patioQueManda ?? 'entregar_en');
    const ordenados = ordenarPatios(patios, patioDeTexto(esperadoTexto, patios)?.id ?? null);

    if (e.respuesta.tipo === 'boton') {
      const op = e.respuesta.opcion;
      const mas = /^mas(\d+)$/.exec(op);
      if (mas) return [armarPreguntaPatio(viaje, ordenados, Number(mas[1]))];
      if (op === 'otro') {
        if (!await escribir(p, hito, 'validacion', detalle(hito.ciclo, 'esperando_texto'))) return [{ texto: TEXTO_NO_PUDE_ANOTAR }];
        return [{ texto: TEXTO_PEDIR_NOMBRE }];
      }
      if (!patios.some((x) => x.id === op)) return [{ texto: 'Ese patio ya no está en la lista. Toca uno de los botones nuevos. 🙏' }, armarPreguntaPatio(viaje, ordenados, 0)];
    }

    // A37-S36-04: el nombre libre se guarda en una bitácora que lee un feed ajeno y que la cancelación ARCO no reescribe: sin teléfonos,
    // correos ni enlaces (mismo limpiador que «¿cómo descargas?»). Si no queda nada utilizable se vuelve a pedir, no se guarda.
    let elegido: { id: string } | { texto: string };
    if (e.respuesta.tipo === 'boton') elegido = { id: e.respuesta.opcion };
    else {
      const limpio = limpiarComoDescarga(e.respuesta.nombre);
      if (!limpio) return [{ texto: TEXTO_PEDIR_NOMBRE }];
      elegido = { texto: limpio };
    }
    const c = compararPatio(elegido, esperadoTexto, patios);
    if (!await escribir(p, hito, 'validacion', detalle(hito.ciclo, 'respondido', {
      resultado: c.resultado, elegido: una(c.elegido, 60), esperado: c.esperado ? una(c.esperado, 60) : null, campo: campoUsado,
      via: e.respuesta.tipo,
    }))) return [{ texto: TEXTO_NO_PUDE_ANOTAR }];
    if (c.resultado === 'igual' || c.resultado === 'sin_referencia') {
      return [{ texto: `Anotado ✅ entregas en ${una(c.elegido, 60)}.` }];
    }
    // A37-S36-02: solo se dice «ya le avisé» si el aviso de verdad salió (o quedó en cola).
    const avisado = await avisarSupervisor(p, viaje, hito, c, ahora);
    return [{
      texto: avisado
        ? `Anotado ✅ entregas en ${una(c.elegido, 60)}. Es distinto al patio de tu instrucción: ya le avisé a tu supervisor para que lo confirme contigo. 🙏`
        : `Anotado ✅ entregas en ${una(c.elegido, 60)}. Es distinto al patio de tu instrucción y NO pude avisar a tu supervisor: llámale tú para que lo confirme. 🙏`,
    }];
  } catch (err) {
    logger.error('conductor.patio_respuesta_fallo', { viaje: viaje.id, err: err instanceof Error ? err.message : String(err) });
    return [{ texto: 'No pude anotarlo ahorita. Intenta de nuevo en un momento. 🙏' }];
  }
}

/** Claim primero (un solo aviso por llegada); sin destinatario NO es silencio: queda cerrado con el motivo y la excepción del tablero. */
async function avisarSupervisor(p: PuertosPatio, v: ViajeContexto, h: HitoFila, c: Comparacion, ahora: Date): Promise<boolean> {
  const claim: NuevoAviso = { tenantId: v.tenantId, viajeId: v.id, hitoId: h.id, operadorId: null, ciclo: h.ciclo, clase: 'escalacion', nivel: NIVEL_AVISO_PATIO };
  const gano = await p.reclamar(claim);
  if (gano !== 'ganado') return gano === 'perdido'; // un aviso previo ya salió (o va en camino)
  try {
    const destinos = await p.destinatarios(v.tenantId, v.terminalId, 1);
    if (destinos.length === 0) {
      await p.cerrarAviso(claim, { ok: false, canal: 'ninguno', motivo: 'sin_destinatario', ult4: null });
      await p.evento(h, 'validacion', detalle(h.ciclo, 'alertado', { destinatarios: 0, entregados: 0 }));
      return false;
    }
    const msg = armarAvisoPatioDistinto(v, c);
    let entregados = 0;
    let canal: 'texto' | 'botones' | 'plantilla' = 'texto';
    let ultimoError = '';
    let encolados = 0;
    for (const d of destinos) {
      const r = await p.enviar(d.telefono, msg, 'conductor.patio_distinto', v.tenantId, ahora);
      if (r.ok) { entregados++; canal = r.via; } else { ultimoError = r.mensaje; if (r.reintentable || r.encolado) encolados++; }
    }
    // Un rechazo reintentable YA quedó en `wa_outbox`: el claim se cierra «en cola» y NO se suelta (soltarlo duplicaría el aviso).
    const enCola = entregados === 0 && encolados === destinos.length;
    await p.cerrarAviso(claim, {
      ok: entregados > 0 || enCola, canal: entregados > 0 ? canal : enCola ? 'texto' : 'ninguno',
      motivo: entregados > 0 ? null : enCola ? 'en_cola_outbox' : ultimoError.slice(0, 200), ult4: destinos[0].telefono.slice(-4),
    });
    const llegaron = entregados > 0 || enCola;
    await p.evento(h, 'validacion', detalle(h.ciclo, 'alertado', { destinatarios: destinos.length, entregados: llegaron ? Math.max(entregados, 1) : 0 }));
    return llegaron;
  } catch (err) {
    logger.error('conductor.patio_aviso_fallo', { viaje: v.id, err: err instanceof Error ? err.message : String(err) });
    await p.cerrarAviso(claim, { ok: false, canal: 'ninguno', motivo: 'error_inesperado', ult4: null }).catch(() => undefined);
    return false;
  }
}

/**
 * «Ya lo atiendo» del supervisor: marca atendida la excepción de patio del viaje (si la hay). Devuelve cuántas cerró.
 * Lo llama `atenderAcuseJefe` junto con el cierre de escalaciones.
 */
export async function marcarPatioAtendido(p: Pick<PuertosPatio, 'eventos' | 'evento'>, tenantId: string, hitos: readonly HitoFila[]): Promise<number> {
  const descarga = hitos.find((h) => h.tipo === 'llegada_descarga');
  if (!descarga) return 0;
  const evs = await p.eventos(tenantId, [descarga.viajeId]);
  const st = estadoPatio(evs, descarga.id, descarga.ciclo);
  const r = st.respondido;
  if (!r || (r.resultado !== 'distinto' && r.resultado !== 'otro') || st.atendido) return 0;
  await p.evento(descarga, 'atendido', detalle(descarga.ciclo, 'atendido'));
  return 1;
}
