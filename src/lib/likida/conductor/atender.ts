import { logger } from '@/lib/logger';
import { enviarSolicitudUbicacion } from '@/lib/meta/client';
import type { ConfigConductor } from './config';
import { interpretarBoton, interpretarTexto, pareceHablarDeHito, type Interpretacion } from './interprete';
import { interpretarConLlm } from './llm';
import { decidir, hitoActivo, type Decision } from './maquina';
import { mensajeParaChofer, type ContextoMensaje, type Salida } from './mensajes';
import {
  adjuntarUbicacion, asegurarHitos, guardarContacto, leerConfigConductor, marcarEscalacionAtendida, marcarSinContacto,
  posponerHito, registrarEvento, registrarHito, retirarHitos, sincronizarLegado, viajeDelOperador,
  type ResultadoEscritura, type ViajeContexto,
} from './repo';
import { tenantDelViaje } from './trabajo';
import { leerBotonConductor, PREFIJO_BOTON, type HitoFila, type FuenteHito } from './tipos';
import { escalarPorProblema, puertosReales } from './ejecutor';
import { avisarOficinaDeHito } from './avisos_oficina';
import { puedeAcusar } from './escalamiento';

// ═══════════════════════════════════════════════════════════════════════════
// LA ENTRADA DEL CONDUCTOR EN EL PROCESSOR — del mensaje al hito registrado.
//
//   texto o botón del chofer → intención (reglas; LLM solo de respaldo) →
//   máquina de estados (decide) → UPDATEs condicionales (aplica) → acuse.
//
// Devuelve `null` si el mensaje NO es de este módulo (sigue su camino al agente de
// siempre); `{ mensajes: [] }` si lo atendió sin nada que decir.
//
// ── EL REGISTRO REACTIVO NO DEPENDE DE QUE EL AGENTE ESTÉ ACTIVO ────────────
// Un «ya llegué» se registra siempre (es lo que el producto hacía desde la 0090);
// `agente_conductor_config.activo = false` apaga lo PROACTIVO (el cron que pide,
// persigue y escala), no el oído.
//
// Las dependencias entran por `DepsAtender`: las pruebas las sustituyen por una
// base en memoria y el processor usa las reales.
// ═══════════════════════════════════════════════════════════════════════════

export interface DepsAtender {
  viajeDelOperador(tenantId: string, operadorId: string, viajeId: string): Promise<ViajeContexto | null>;
  config(tenantId: string): Promise<ConfigConductor>;
  asegurarHitos(tenantId: string, viajeId: string): Promise<HitoFila[]>;
  registrarHito: typeof registrarHito;
  sincronizarLegado: typeof sincronizarLegado;
  guardarContacto: typeof guardarContacto;
  marcarSinContacto: typeof marcarSinContacto;
  posponerHito: typeof posponerHito;
  retirarHitos: typeof retirarHitos;
  evento: typeof registrarEvento;
  llm: typeof interpretarConLlm;
  avisarOficina: typeof avisarOficinaDeHito;
  escalarPorProblema(v: ViajeContexto, h: HitoFila, hs: HitoFila[], ahora: Date): ReturnType<typeof escalarPorProblema>;
  solicitarUbicacion(telefono: string, cuerpo: string): Promise<boolean>;
}

export const depsReales: DepsAtender = {
  viajeDelOperador,
  config: leerConfigConductor,
  asegurarHitos,
  registrarHito,
  sincronizarLegado,
  guardarContacto,
  marcarSinContacto,
  posponerHito,
  retirarHitos,
  evento: registrarEvento,
  llm: interpretarConLlm,
  avisarOficina: avisarOficinaDeHito,
  escalarPorProblema: (v, h, hs, ahora) => escalarPorProblema(puertosReales(), v, h, hs, ahora),
  solicitarUbicacion: async (telefono, cuerpo) => (await enviarSolicitudUbicacion(telefono, cuerpo)).ok,
};

export interface EntradaAtender {
  tenantId: string;
  operadorId: string;
  telefono: string;
  /** El viaje abierto del chofer (el de «ya llegué» a secas). */
  viajeAbiertoId: string | null;
  texto: string;
  /** La hora del MENSAJE según Meta; sin ella se usa el reloj local. */
  mensajeEn?: Date | null;
  ahora?: Date;
  waMessageId?: string | null;
  senal?: AbortSignal;
}

export interface SalidaAtender {
  mensajes: Salida[];
}

const FALLO: Salida = { texto: 'No pude anotarlo ahorita — mándamelo de nuevo en un momento. 🙏' };

export async function atenderConductor(e: EntradaAtender, deps: DepsAtender = depsReales): Promise<SalidaAtender | null> {
  const ahora = e.ahora ?? new Date();
  const boton = interpretarBoton(e.texto);
  let interp: Interpretacion | null = boton;
  if (!interp) interp = interpretarTexto(e.texto);

  // ¿Es de este módulo? Los botones siempre; el texto, solo si las reglas lo entienden
  // o PARECE hablar de un hito (y entonces decide el respaldo con modelo).
  // Los payloads de OTROS botones nuestros (el «Ya lo atiendo» del jefe) no son de este módulo
  // aunque parezcan hablar de un hito: ni se interpretan ni pagan una llamada al modelo.
  if (!boton && leerBotonConductor(e.texto)) return null;
  const llevaViaje = boton?.viajeId ?? e.viajeAbiertoId;
  if (!llevaViaje) return null;
  if (!interp && !pareceHablarDeHito(e.texto)) return null;

  try {
    const viaje = await deps.viajeDelOperador(e.tenantId, e.operadorId, llevaViaje);
    if (!viaje) {
      // Un payload de otro viaje (o inventado a mano): nunca toca datos ajenos.
      if (boton) return { mensajes: [{ texto: 'Ese botón es de otro viaje o ya no está vigente. 🙏' }] };
      return null;
    }
    if (viaje.estatus === 'liquidado') {
      if (boton) return { mensajes: [{ texto: 'Ese viaje ya está cerrado. 👍' }] };
      return null;
    }

    const config = await deps.config(e.tenantId);
    const hitos = await deps.asegurarHitos(e.tenantId, viaje.id);

    if (!interp) {
      if (!config.usarLlm) return null;
      interp = await deps.llm({ tenantId: e.tenantId, texto: e.texto, hitos, senal: e.senal });
      if (!interp) return null; // el modelo tampoco lo entendió: sigue al agente
    }

    const ctx: ContextoMensaje = { viajeId: viaje.id, folio: viaje.folio, origen: viaje.origen, destino: viaje.destino };
    const mensajeEn = e.mensajeEn && !Number.isNaN(e.mensajeEn.getTime()) ? e.mensajeEn : ahora;

    // ── Lo que NO cambia hitos ─────────────────────────────────────────────
    if (interp.intencion.clase === 'pedir_ubicacion') {
      const ok = await deps.solicitarUbicacion(e.telefono, '📍 Toca el botón para compartir tu ubicación y la anoto en tu viaje.');
      return { mensajes: ok ? [] : [{ texto: 'No pude abrir la ubicación. Mándame tu pin desde el clip 📎 → Ubicación. 🙏' }] };
    }
    if (interp.intencion.clase === 'problema') {
      const activo = hitoActivo(hitos);
      if (!activo) return { mensajes: [{ texto: 'Ya tengo todos los avisos de este viaje. Si tienes un problema, avísale directo a tu jefe de tráfico. 🙏' }] };
      const r = await deps.escalarPorProblema(viaje, activo, hitos, ahora);
      return {
        mensajes: [{
          texto: r === 'ok' || r === 'perdido'
            ? 'Gracias por avisar. Ya le avisé a tu jefe de tráfico para que te contacte. 🙏'
            : 'No pude avisarle a tu jefe por WhatsApp ahorita. Si es urgente, márcale directo. 🙏',
        }],
      };
    }

    const decision = decidir({
      hitos, intencion: interp.intencion, contacto: interp.contacto, ahora, mensajeEn,
      ventanaCorreccionMin: config.ventanaCorreccionMin, posponerMin: config.posponerMin,
    });

    const fuente: FuenteHito = boton ? 'boton' : 'texto';
    const aplicado = await aplicar(decision, { deps, e, viaje, hitos, interp, fuente, ahora, mensajeEn, config });
    logger.info('hito.conductor', {
      viaje: viaje.id, accion: decision.accion, via: interp.via, aplicado,
      objetivo: 'objetivo' in decision ? decision.objetivo : null,
    });

    const salida = mensajeParaChofer(decision, ctx, ahora, aplicado);
    // Con la confirmación apagada, el hito registrado queda en silencio (todo lo demás sí se contesta).
    if (!config.confirmarAlChofer && decision.accion === 'registrar' && aplicado === 'ok') return { mensajes: [] };
    return { mensajes: [salida] };
  } catch (err) {
    // Fail-closed: no se finge una anotación. Pero tampoco se rompe el turno entero.
    logger.error('hito.conductor_fallo', { viaje: llevaViaje, err: err instanceof Error ? err.message : String(err) });
    return { mensajes: [FALLO] };
  }
}

interface ContextoAplicar {
  deps: DepsAtender;
  e: EntradaAtender;
  viaje: ViajeContexto;
  hitos: HitoFila[];
  interp: Interpretacion;
  fuente: FuenteHito;
  ahora: Date;
  mensajeEn: Date;
  config: ConfigConductor;
}

const hitoDe = (hs: readonly HitoFila[], tipo: HitoFila['tipo']): HitoFila => {
  const h = hs.find((x) => x.tipo === tipo);
  if (!h) throw new Error(`falta el hito ${tipo}`);
  return h;
};

/** Aplica la decisión con escrituras condicionales. Devuelve cómo salió. */
async function aplicar(d: Decision, c: ContextoAplicar): Promise<'ok' | 'carrera' | 'fallo'> {
  const { deps, viaje, hitos, ahora } = c;
  const resultado = (r: ResultadoEscritura) => r;

  switch (d.accion) {
    case 'registrar': {
      const objetivo = hitoDe(hitos, d.objetivo);
      const r = resultado(await deps.registrarHito({
        hito: objetivo, fuente: c.fuente, interpretacion: c.interp.via, confianza: c.interp.confianza,
        waMessageId: c.e.waMessageId ?? null, mensajeEn: d.mensajeEn, ahora,
        texto: c.fuente === 'boton' ? null : c.e.texto, contacto: d.contacto,
        omitir: d.omitir.map((t) => hitoDe(hitos, t)),
      }));
      if (r !== 'ok') return r;
      await deps.sincronizarLegado(viaje.tenantId, viaje.id, d.legado, d.mensajeEn);
      await deps.evento(objetivo, 'recibido', { fuente: c.fuente, via: c.interp.via, ambigua: d.ambigua, tarde: d.reabre, hora_ajustada: d.ajustadaPorFuturo });
      for (const t of d.omitir) await deps.evento(hitoDe(hitos, t), 'omitido', { por: d.objetivo });
      if (d.contacto) await deps.evento(objetivo, 'contacto', {});
      // El aviso a la oficina es best-effort y no retrasa el acuse más de lo que cuesta un envío.
      const esLlegada = d.objetivo === 'llegada_carga' || d.objetivo === 'llegada_descarga';
      if (esLlegada ? c.config.avisarOficinaLlegada : c.config.avisarOficinaSalida) {
        await deps.avisarOficina({ viaje, hito: { ...objetivo, estado: 'recibido' }, mensajeEn: d.mensajeEn, contacto: d.contacto, ahora });
      }
      return 'ok';
    }
    case 'duplicado': {
      // Repetir un hito no mueve su hora; sí puede completar el contacto o el sello de la 0090.
      await deps.sincronizarLegado(viaje.tenantId, viaje.id, d.legado, c.mensajeEn);
      const h = hitoDe(hitos, d.objetivo);
      if (d.contacto && (h.estado === 'recibido' || h.estado === 'validado')) {
        const r = await deps.guardarContacto(h, d.contacto, ahora);
        if (r === 'ok') await deps.evento(h, 'contacto', {});
      }
      return 'ok';
    }
    case 'contacto': {
      const h = hitoDe(hitos, d.objetivo);
      const r = await deps.guardarContacto(h, d.contacto, ahora);
      if (r === 'ok') await deps.evento(h, 'contacto', {});
      return r;
    }
    case 'sin_contacto':
      return deps.marcarSinContacto(hitoDe(hitos, d.objetivo), ahora);
    case 'posponer': {
      await deps.sincronizarLegado(viaje.tenantId, viaje.id, d.legado, c.mensajeEn);
      if (!d.aplicado) return 'ok';
      const h = hitoDe(hitos, d.objetivo);
      const r = await deps.posponerHito(h, d.minutos, ahora);
      if (r === 'ok') await deps.evento(h, 'pospuesto', { minutos: d.minutos });
      return r;
    }
    case 'corregir': {
      const objetivo = hitoDe(hitos, d.objetivo);
      const r = await deps.retirarHitos(d.revertir.map((t) => hitoDe(hitos, t)), d.objetivo, ahora, d.despues ? null : c.config.posponerMin);
      if (r !== 'ok') return r;
      await deps.evento(objetivo, 'corregido', { revertidos: d.revertir.length });
      if (d.despues) {
        // Tras retirar, el mundo cambió: se recarga y se vuelve a decidir lo pedido («Es en descarga»).
        const frescos = await deps.asegurarHitos(viaje.tenantId, viaje.id);
        const otra = d.despues.accion === 'registrar'
          ? decidir({
            hitos: frescos, intencion: { clase: 'llegada', lugar: lugarDeObjetivo(d.despues.objetivo) }, contacto: null, ahora, mensajeEn: c.mensajeEn,
            ventanaCorreccionMin: c.config.ventanaCorreccionMin, posponerMin: c.config.posponerMin,
          })
          : d.despues;
        return aplicar(otra, { ...c, hitos: frescos });
      }
      return 'ok';
    }
    case 'aclarar':
    case 'rechazar':
      return 'ok';
  }
}

function lugarDeObjetivo(t: HitoFila['tipo']): 'carga' | 'descarga' | null {
  if (t === 'llegada_carga') return 'carga';
  if (t === 'llegada_descarga') return 'descarga';
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// «YA LO ATIENDO» — el acuse del jefe o del patio a una escalación.
// ═══════════════════════════════════════════════════════════════════════════

export interface DepsAcuse {
  viaje(viajeId: string): Promise<{ tenantId: string } | null>;
  puedeAcusar(tenantId: string, telefono: string): Promise<boolean>;
  marcar(tenantId: string, viajeId: string, ahora: Date): Promise<HitoFila[]>;
  evento: typeof registrarEvento;
}

const depsAcuseReales: DepsAcuse = {
  // El tenant sale del VIAJE del payload; después `puedeAcusar` exige que el teléfono sea de ESA
  // flota (contacto de tráfico o cuenta de oficina).
  viaje: async (id) => {
    const tenantId = await tenantDelViaje(id);
    return tenantId ? { tenantId } : null;
  },
  puedeAcusar,
  marcar: marcarEscalacionAtendida,
  evento: registrarEvento,
};

/** `null` = el texto no es un acuse de escalación. Un número ajeno NO puede acusar viajes de otra flota. */
export async function atenderAcuseJefe(
  telefono: string, texto: string, ahora: Date = new Date(), deps: DepsAcuse = depsAcuseReales,
): Promise<string | null> {
  const b = leerBotonConductor(texto);
  if (!b || b.prefijo !== PREFIJO_BOTON.jefeAtiendo) return null;
  try {
    const v = await deps.viaje(b.viajeId);
    // Misma respuesta para «no existe» y «no es tuyo»: no se confirma qué viajes hay.
    if (!v || !(await deps.puedeAcusar(v.tenantId, telefono))) return 'No tengo ese aviso asignado a este número.';
    const marcados = await deps.marcar(v.tenantId, b.viajeId, ahora);
    for (const h of marcados) await deps.evento(h, 'atendido', {});
    return marcados.length > 0
      ? 'Anotado ✅ lo marqué como atendido; ya no insisto por este viaje.'
      : 'Ya estaba atendido o el chofer ya respondió. 👍';
  } catch (err) {
    logger.error('conductor.acuse_fallo', { err: err instanceof Error ? err.message : String(err) });
    return 'No pude anotarlo ahorita. Intenta de nuevo en un momento. 🙏';
  }
}

/**
 * El pin del chofer se adjunta como evidencia al hito que acaba de registrar
 * (≤ 30 min). Best-effort y mudo: la respuesta del pin sigue siendo la de siempre.
 */
export async function adjuntarUbicacionAHito(
  tenantId: string, viajeId: string, lat: number, lng: number, ahora: Date = new Date(),
): Promise<boolean> {
  try {
    return (await adjuntarUbicacion(tenantId, viajeId, lat, lng, ahora)) !== null;
  } catch (err) {
    logger.warn('conductor.ubicacion_no_adjunta', { viaje: viajeId, err: err instanceof Error ? err.message : String(err) });
    return false;
  }
}
