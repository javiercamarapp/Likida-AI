import { appUrl } from '@/lib/env';
import { logger } from '@/lib/logger';
import { opcionesDeEnvio } from '@/lib/meta/plantillas_catalogo';
import { parametrosAvisoOficina } from '@/lib/meta/aviso_oficina';
import { aceptarPorBoton, leerCajaDelViaje, leerCodigosSitios, leerRutasAutorizadas, type ResultadoAceptarPorBoton, type ViajeContexto } from './repo';
import { hoyDeLaFlota, rutasDelViaje, type RutaAutorizada } from './rutas';
import { despacharInstrucciones } from '../convenios/envio';
import type { ConfigConductor } from './config';
import type { NuevoAviso, PuertosConductor } from './ejecutor';
import { puertosReales } from './ejecutor';
import { horaYDiaMx, type Salida } from './mensajes';
import { textoEsperado } from './patio_regla';
import type { MensajeSaliente } from './solicitudes';
import { preguntarGastosAlAceptar } from './gastos_etc';
import { PREFIJO_BOTON, type HitoFila } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// T-A5-47 — ASIGNACIÓN CON BOTONES E INSTRUCCIONES ESTÁNDAR (R02, R03, R05).
//
// Requisito del cliente (reunión 15-oct, 00:01:54–00:04:08 y 00:07:28): al asignar el viaje en el módulo de requerimientos le llega al
// operador por WhatsApp y CONFIRMA; ya confirmado recibe, completitas, las instrucciones (caja/remolque, cita y datos de entrega) para que
// no tenga que llamar; y todo va por botones.
//
// ── CÓMO ENCAJA ────────────────────────────────────────────────────────────
//   · Salida: con `asignacionBotonesActiva`, `operacion.ts → avisarAlChofer` manda la plantilla N01 (`viaje_asignado_confirmar_v1`, botones
//     `viaje_acepto:<viaje>` / `viaje_rechazo:<viaje>`) en lugar de `viaje_asignado`. Sin la perilla nada cambia (la aceptación por texto y
//     `viaje_asignado` siguen disponibles).
//   · Entrada: `atender.ts` lee los botones de este módulo (`viaje_acepto`, `viaje_rechazo`, `instr_ok`) y llama a `responderAsignacion`.
//       acepto  → `aceptado_en` con `aceptado_origen = 'chofer'` (una sola vez) y las instrucciones: texto con botón «Entendido» dentro de la
//                 ventana de 24 h, o la plantilla N02 si cerró (lo decide `enviarConFallback`), más las del convenio del cliente
//                 (`despacharInstrucciones`, ya sellado = no se repite).
//       rechazo → UN aviso al despachador/jefe de tráfico (claim `escalacion` nivel 9: dos toques no lo duplican) y acuse al chofer.
//       Un viaje ya aceptado no se rechaza por botón (se le dice que avise a su supervisor): la aceptación vale la primera vez.
//
// ── RULINGS (reversibles) ──────────────────────────────────────────────────
//   · Origen de la aceptación = 'chofer': el dominio de `viaje_aceptado_origen_dominio` (0800) es chofer | importacion | oficina; 'whatsapp'
//     violaría el CHECK. La métrica de T-A5-06 solo excluye 'importacion', así que el chofer cuenta bien.
//   · Datos que faltan NO se inventan: caja sin dato → «por confirmar con tu supervisor»; cita ausente → se dice; rutas → T-A5-49 las trae del repositorio
//     de rutas autorizadas (`rutasParaAsignacion`); sin ruta vigente, «consulta con tu supervisor».
//   · «Despachador» = los destinatarios de nivel 1 (jefe de tráfico) que ya usa todo el módulo: no hay un rol de despachador aparte.
//   · El botón se atiende aunque la perilla se apague después de mandar N01: dejar al chofer con un botón muerto no ayuda a nadie.
//   · Un rechazo no reasigna ni desasigna (efecto sobre datos de la oficina): solo avisa; el viaje sigue sin aceptar y la escalación de
//     siempre lo cubre si nadie lo atiende.
// ═══════════════════════════════════════════════════════════════════════════

/** Nivel reservado del claim `escalacion` para el aviso del rechazo (1–2 cron, 3–5 reporte, 6 resultado, 7 patio, 8 estadía). */
export const NIVEL_AVISO_RECHAZO = 9;

/** Lo que se le dice cuando falta un dato que no se puede inventar. */
export const SIN_DATO = 'consulta con tu supervisor';
const POR_CONFIRMAR = 'por confirmar con tu supervisor';

const una = (t: string | null | undefined, n: number): string => (t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export interface DatosInstrucciones {
  caja: string | null;
  /** Link de Google Maps al punto de carga (T-A5-49 lo llena desde el repositorio de rutas autorizadas). */
  rutaCarga: string | null;
  /** Link de Google Maps al patio de entrega (T-A5-49). */
  rutaPatio: string | null;
}

export const SIN_DATOS: DatosInstrucciones = Object.freeze({ caja: null, rutaCarga: null, rutaPatio: null });

/** La cita del viaje en la hora del Centro de México: «08:00» si es hoy, «08:00 del 16/10» si no. `null` = sin cita registrada. */
function citaLegible(v: Pick<ViajeContexto, 'citaOrigenEn'>, ahora: Date): string | null {
  if (!v.citaOrigenEn) return null;
  const f = new Date(v.citaOrigenEn);
  return Number.isNaN(f.getTime()) ? null : horaYDiaMx(f, ahora);
}

/**
 * Las instrucciones estándar del viaje: texto libre (una línea por dato, con botón «Entendido») y la plantilla N02 por si la ventana de 24 h
 * cerró. Pura: ni base ni WhatsApp. Un dato ausente se DICE, nunca se rellena.
 */
export function armarInstrucciones(
  v: Pick<ViajeContexto, 'id' | 'folio' | 'origen' | 'destino' | 'entregarEn' | 'operadorNombre' | 'citaOrigenEn'>,
  d: DatosInstrucciones, campoPatio: ConfigConductor['patioQueManda'], ahora: Date,
): MensajeSaliente {
  const folio = una(v.folio, 30) || v.id.slice(0, 8);
  const nombre = una(v.operadorNombre, 40).split(' ')[0] || 'chofer';
  const caja = una(d.caja, 40) || POR_CONFIRMAR;
  const lugar = una(v.origen, 60) || 'el punto de carga';
  const hora = citaLegible(v, ahora);
  const patio = una(textoEsperado(v, campoPatio ?? 'entregar_en').texto, 60) || POR_CONFIRMAR;
  const rutaCarga = una(d.rutaCarga, 300) || SIN_DATO;
  const rutaPatio = una(d.rutaPatio, 300) || SIN_DATO;

  const texto = [
    `✅ Confirmado el viaje ${folio}. Estas son tus instrucciones:`,
    `• Caja: ${caja}`,
    `• Cita: ${hora ? `${lugar} a las ${hora}` : 'sin cita registrada, confírmala con tu supervisor'}`,
    `• Entrega en el patio: ${patio}`,
    `• Ruta al punto de carga: ${rutaCarga}`,
    `• Ruta al patio de entrega: ${rutaPatio}`,
    'Si tienes dudas, responde por aquí.',
  ].join('\n');

  return {
    texto,
    botones: [{ id: `${PREFIJO_BOTON.instruccionesOk}:${v.id}`, titulo: 'Entendido' }],
    plantilla: {
      nombre: 'viaje_instrucciones_ruta_v1',
      ...opcionesDeEnvio('viaje_instrucciones_ruta_v1', {
        cuerpo: [folio, nombre, caja, lugar, hora ?? POR_CONFIRMAR, patio, rutaCarga, rutaPatio],
        idsBotones: v.id,
      }),
    },
  };
}

/** El aviso al despachador cuando el chofer no puede tomar el viaje. Sin botones: no hay «Ya lo atiendo» que tenga a qué colgarse. */
export function armarAvisoRechazo(v: Pick<ViajeContexto, 'id' | 'folio' | 'operadorNombre'>): MensajeSaliente {
  const chofer = una(v.operadorNombre, 60) || 'El chofer';
  const folio = una(v.folio, 30) || v.id.slice(0, 8);
  return {
    texto: `Aviso para el despachador: ${chofer} no puede tomar el viaje ${folio} (lo rechazó por WhatsApp). Reasígnalo a otro operador.`,
    botones: [],
    plantilla: {
      nombre: 'aviso_operacion_v1',
      ...opcionesDeEnvio('aviso_operacion_v1', {
        cuerpo: parametrosAvisoOficina(chofer, `no puede tomar el viaje ${folio}, reasígnalo`, `${appUrl()}/dashboard/agentes/conductores`),
      }),
    },
  };
}

// ── Con puertos ─────────────────────────────────────────────────────────────

export interface PuertosAsignacion extends Pick<PuertosConductor, 'reclamar' | 'cerrarAviso' | 'enviar' | 'destinatarios' | 'avisosDe'> {
  aceptar(tenantId: string, viajeId: string, operadorId: string, ahora: Date): Promise<ResultadoAceptarPorBoton>;
  /** Los datos que el viaje todavía no trae (caja y rutas). Lanza si la base falla: quien llama manda las instrucciones con «por confirmar». */
  datos(viaje: ViajeContexto): Promise<DatosInstrucciones>;
  /** Las instrucciones del convenio del cliente (puerta, con quién reportarse…): idempotentes por sello. Nunca lanza. */
  convenio(tenantId: string, viajeId: string): Promise<void>;
}

export interface LectorRutasViaje {
  /** Las rutas autorizadas de la flota (vigentes o no). Lanza si la base falla. */
  rutas(tenantId: string): Promise<readonly RutaAutorizada[]>;
  /** id de sitio → código. Lanza si la base falla. */
  codigos(tenantId: string, sitioIds: readonly string[]): Promise<Map<string, string>>;
}

/**
 * T-A5-49 (R04): los links de ruta del mensaje, SOLO de la base de rutas autorizadas (T-A5-48). Importación = origen; exportación = origen y
 * destino. Si no hay ruta vigente (o no se pudo leer la base) devuelve null y el mensaje dice «consulta con tu supervisor»: nunca inventa.
 * La excepción para la oficina NO se guarda aquí: el tablero la calcula al leer con la misma `rutasDelViaje`.
 */
export async function rutasParaAsignacion(
  l: LectorRutasViaje, v: Pick<ViajeContexto, 'tenantId' | 'id' | 'origen' | 'destino' | 'origenSitioId' | 'destinoSitioId' | 'servicio'>, ahora: Date, zona?: string,
): Promise<Pick<DatosInstrucciones, 'rutaCarga' | 'rutaPatio'>> {
  try {
    const rutas = await l.rutas(v.tenantId);
    if (rutas.length === 0) return { rutaCarga: null, rutaPatio: null };
    const ids = [v.origenSitioId, v.destinoSitioId].filter((x): x is string => !!x);
    const codigos = ids.length === 0 ? new Map<string, string>() : await l.codigos(v.tenantId, ids);
    const r = rutasDelViaje(rutas, {
      origen: v.origen, destino: v.destino, servicio: v.servicio,
      sitioOrigenCodigo: (v.origenSitioId && codigos.get(v.origenSitioId)) || null,
      sitioDestinoCodigo: (v.destinoSitioId && codigos.get(v.destinoSitioId)) || null,
    }, hoyDeLaFlota(ahora, zona));
    return { rutaCarga: r.carga, rutaPatio: r.patio };
  } catch (err) {
    logger.warn('conductor.asignacion_rutas_fallo', { viaje: v.id, err: err instanceof Error ? err.message : String(err) });
    return { rutaCarga: null, rutaPatio: null };
  }
}

const LECTOR_RUTAS_REAL: LectorRutasViaje = { rutas: leerRutasAutorizadas, codigos: leerCodigosSitios };

export function puertosAsignacionReales(): PuertosAsignacion {
  const base = puertosReales();
  return {
    reclamar: base.reclamar, cerrarAviso: base.cerrarAviso, enviar: base.enviar, destinatarios: base.destinatarios, avisosDe: base.avisosDe,
    aceptar: aceptarPorBoton,
    // Caja del programa del Vigía y rutas del repositorio de rutas autorizadas (T-A5-49); cada una falla sola, sin tirar a la otra.
    datos: async (viaje) => {
      const [caja, rutas] = await Promise.allSettled([leerCajaDelViaje(viaje), rutasParaAsignacion(LECTOR_RUTAS_REAL, viaje, new Date())]);
      if (caja.status === 'rejected') logger.warn('conductor.asignacion_caja_fallo', { viaje: viaje.id, err: caja.reason instanceof Error ? caja.reason.message : String(caja.reason) });
      return { caja: caja.status === 'fulfilled' ? caja.value : null, ...(rutas.status === 'fulfilled' ? rutas.value : { rutaCarga: null, rutaPatio: null }) };
    },
    convenio: async (tenantId, viajeId) => { await despacharInstrucciones(tenantId, viajeId); },
  };
}

export type OpcionAsignacion = 'acepto' | 'rechazo' | 'entendido';

export interface EntradaAsignacion {
  viaje: ViajeContexto;
  /** El teléfono de quien tocó el botón (la ventana de 24 h es suya). */
  telefono: string;
  opcion: OpcionAsignacion;
  config: Pick<ConfigConductor, 'patioQueManda'> & Partial<Pick<ConfigConductor, 'gastosEtcActiva'>>;
  /** Solo para el rechazo: los hitos ya sembrados del viaje; el primero cuelga el claim del aviso. */
  hitos?: readonly HitoFila[];
  ahora: Date;
}

const FALLO: Salida = { texto: 'No pude anotarlo ahorita. Intenta de nuevo en un momento. 🙏' };
const NO_VIGENTE: Salida = { texto: 'Ese aviso ya no está vigente. 👍' };

/** La respuesta del chofer a la asignación. Nunca lanza. */
export async function responderAsignacion(p: PuertosAsignacion, x: EntradaAsignacion): Promise<Salida[]> {
  const v = x.viaje;
  const folio = una(v.folio, 30) || v.id.slice(0, 8);
  try {
    if (x.opcion === 'entendido') return [{ texto: 'Anotado, gracias. 👍' }];

    if (x.opcion === 'acepto') {
      const r = await p.aceptar(v.tenantId, v.id, v.operadorId, x.ahora);
      if (r === 'ya_aceptado') return [{ texto: `Ya tengo confirmado tu viaje ${folio}. 👍` }];
      if (r === 'sin_aviso' || r === 'no_encontrado') return [NO_VIGENTE];
      if (r === 'fallo') return [FALLO];

      let datos: DatosInstrucciones = SIN_DATOS;
      try {
        datos = await p.datos(v);
      } catch (err) {
        // Sin caja/rutas no se retiene la confirmación: se mandan las instrucciones diciendo «por confirmar».
        logger.warn('conductor.asignacion_datos_fallo', { viaje: v.id, err: err instanceof Error ? err.message : String(err) });
      }
      const m = armarInstrucciones(v, datos, x.config.patioQueManda, x.ahora);
      const envio = await p.enviar(x.telefono, m, 'conductor.asignacion_instrucciones', v.tenantId, x.ahora);
      await p.convenio(v.tenantId, v.id).catch((err) => logger.warn('conductor.asignacion_convenio_fallo', { viaje: v.id, err: err instanceof Error ? err.message : String(err) }));
      // T-A5-51 (R07): con la perilla, DESPUÉS de las instrucciones, la pregunta de gastos/ETC. Nunca lanza ni retiene la confirmación.
      await preguntarGastosAlAceptar(p.enviar, x.config, v, x.telefono, x.ahora);
      // Salió por el envío (texto con botón o plantilla N02): ya es la confirmación. Si no, el texto va como respuesta del turno.
      return envio.ok ? [] : [{ texto: m.texto, botones: m.botones }];
    }

    // rechazo
    if (v.aceptadoEn) return [{ texto: `Ya habías aceptado el viaje ${folio}. Si no puedes tomarlo, avísale directo a tu supervisor. 🙏` }];
    const avisado = await avisarRechazo(p, v, x.hitos?.[0] ?? null, x.ahora);
    return [{
      texto: avisado
        ? `Anotado ✅ Ya le avisé al despachador que no puedes tomar el viaje ${folio}. Gracias por avisar. 🙏`
        : `Anotado, pero no pude avisarle al despachador por WhatsApp. Avísale directo que no puedes tomar el viaje ${folio}. 🙏`,
    }];
  } catch (err) {
    logger.error('conductor.asignacion_respuesta_fallo', { viaje: v.id, err: err instanceof Error ? err.message : String(err) });
    return [FALLO];
  }
}

/** Claim primero (un solo aviso por viaje); devuelve si al menos un destinatario lo recibió (o quedó en cola). */
async function avisarRechazo(p: PuertosAsignacion, v: ViajeContexto, hito: HitoFila | null, ahora: Date): Promise<boolean> {
  if (!hito) {
    logger.warn('conductor.asignacion_rechazo_sin_hito', { viaje: v.id });
    return false;
  }
  const claim: NuevoAviso = { tenantId: v.tenantId, viajeId: v.id, hitoId: hito.id, operadorId: null, ciclo: hito.ciclo, clase: 'escalacion', nivel: NIVEL_AVISO_RECHAZO };
  const gano = await p.reclamar(claim);
  if (gano !== 'ganado') {
    if (gano !== 'perdido') return false;
    // A37-S34-03: «perdido» solo dice que YA hay un claim, no que el aviso haya salido: el primer intento pudo cerrar con ok:false
    // (sin destinatario, envío rechazado). Solo se le dice al chofer «ya le avisé» si ese aviso salió, quedó en cola o sigue en camino.
    try {
      const previo = (await p.avisosDe([hito.id])).find((a) => a.hitoId === hito.id && a.clase === claim.clase && a.nivel === claim.nivel && a.ciclo === claim.ciclo);
      return previo !== undefined && previo.ok !== false;
    } catch (err) {
      logger.warn('conductor.asignacion_rechazo_estado_fallo', { viaje: v.id, err: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }
  try {
    const destinos = await p.destinatarios(v.tenantId, v.terminalId, 1);
    if (destinos.length === 0) {
      logger.warn('conductor.asignacion_rechazo_sin_destinatario', { viaje: v.id });
      await p.cerrarAviso(claim, { ok: false, canal: 'ninguno', motivo: 'sin_destinatario', ult4: null });
      return false;
    }
    const msg = armarAvisoRechazo(v);
    let entregados = 0;
    let canal: 'texto' | 'botones' | 'plantilla' = 'texto';
    let ultimoError = '';
    let encolados = 0;
    for (const d of destinos) {
      const r = await p.enviar(d.telefono, msg, 'conductor.asignacion_rechazo', v.tenantId, ahora);
      if (r.ok) { entregados++; canal = r.via; } else { ultimoError = r.mensaje; if (r.reintentable || r.encolado) encolados++; }
    }
    // Un rechazo reintentable YA quedó en `wa_outbox`: el claim se cierra «en cola» y NO se suelta (soltarlo duplicaría el aviso).
    const enCola = entregados === 0 && encolados === destinos.length;
    await p.cerrarAviso(claim, {
      ok: entregados > 0 || enCola, canal: entregados > 0 ? canal : enCola ? 'texto' : 'ninguno',
      motivo: entregados > 0 ? null : enCola ? 'en_cola_outbox' : ultimoError.slice(0, 200), ult4: destinos[0].telefono.slice(-4),
    });
    return entregados > 0 || enCola;
  } catch (err) {
    logger.error('conductor.asignacion_rechazo_aviso_fallo', { viaje: v.id, err: err instanceof Error ? err.message : String(err) });
    await p.cerrarAviso(claim, { ok: false, canal: 'ninguno', motivo: 'error_inesperado', ult4: null }).catch(() => undefined);
    return false;
  }
}
