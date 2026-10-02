import { appUrl } from '@/lib/env';
import { logger } from '@/lib/logger';
import { opcionesDeEnvio } from '@/lib/meta/plantillas_catalogo';
import { dentroDeVentana, type ConfigConductor } from './config';
import type { PuertosConductor, NuevoAviso } from './ejecutor';
import { puertosReales } from './ejecutor';
import { horaYDiaMx } from './mensajes';
import type { ViajeContexto } from './repo';
import { leerVeredictos, type VeredictoFila } from './repo_validacion';
import type { MensajeSaliente } from './solicitudes';
import { MINUTOS_GRACIA_LLEGADA_SIN_CONFIRMAR } from './tablero';
import type { HitoFila } from './tipos';
import { leerSitiosDeViajes } from './trabajo';
import { llegadaPorConfirmar, llegadaSinSitio } from './validacion';

// ═══════════════════════════════════════════════════════════════════════════
// EL AVISO AL JEFE DE TRÁFICO POR «LLEGADA SIN CONFIRMAR» — el «ya llegué» que ninguna posición respalda.
//
// Hasta hoy esto solo se veía como excepción en el tablero: el jefe de tráfico tenía que estar mirándolo. Con la perilla
// `avisar_llegada_sin_confirmar` (APAGADA por omisión, por flota: un aviso por llegada a 250 camiones es ruido hasta que el
// tráfico lo pida) el patio responsable recibe UN aviso por llegada, con la hora exacta del mensaje del chofer.
//
// Cubre los tres casos que el tablero muestra como excepción de la llegada:
//   · sin posición (pin o GPS) cercana a la hora del aviso, o con la posición fuera de la ventana;
//   · «sin coincidencia»: la posición comparada cae fuera del sitio (puede ser una muestra vieja: se dice sin acusar);
//   · el viaje SIN SITIO asignado: el «ya llegué» selló la llegada sin que nada lo contrastara (`llegadaSinSitio`).
//
//   · UN aviso por llegada y ciclo: el claim `llegada_sin_confirmar` (nivel 1) sobre el hito es el candado; dos corridas
//     solapadas mandan uno solo y una reentrega no repite. Una llegada que se confirma después NO retira el aviso ya mandado.
//   · Espera los minutos de gracia del tablero (el GPS reporta con retraso) y solo mira llegadas de las últimas
//     `HORAS_MAXIMAS`: encender la perilla no dispara avisos sobre viajes viejos.
//   · Mismo envío que todo lo demás: `enviarConFallback` (ventana 24 h → texto; fuera → su plantilla del catálogo), y nunca
//     fuera de la ventana horaria de la flota (no se reclama hasta que abra).
//   · Un rechazo reintentable libera el claim (se reintenta en la siguiente corrida); uno definitivo lo cierra con `ok = false`.
// ═══════════════════════════════════════════════════════════════════════════

/** Una llegada más vieja que esto ya no es noticia: el viaje siguió su curso. */
export const HORAS_MAXIMAS_LLEGADA_SIN_CONFIRMAR = 12;

export interface ResultadoAlertasLlegada {
  revisadas: number;
  avisos: number;
  yaReclamados: number;
  sinDestinatario: number;
  fueraDeVentana: number;
  rechazosReintentables: number;
  fallos: string[];
}

/** Los puertos del Conductor más las dos lecturas propias del aviso. */
export interface PuertosAlertaLlegada extends Pick<PuertosConductor, 'viajesActivos' | 'hitosDe' | 'configDe' | 'reclamar' | 'cerrarAviso' | 'liberarAviso' | 'enviar' | 'destinatarios' | 'evento'> {
  veredictosDe(tenantId: string, viajeIds: string[]): Promise<VeredictoFila[]>;
  /** Qué viajes traen sitio de carga/descarga asignado. */
  sitiosDe(viajeIds: string[]): Promise<Map<string, { origen: boolean; destino: boolean }>>;
}

export function puertosAlertaLlegadaReales(): PuertosAlertaLlegada {
  return { ...puertosReales(), veredictosDe: leerVeredictos, sitiosDe: leerSitiosDeViajes };
}

type Motivo = 'sin_sitio' | 'sin_coincidencia' | 'sin_ubicacion';

const una = (t: string, n: number): string => t.replace(/\s+/g, ' ').trim().slice(0, n);

/** El texto y la plantilla del aviso. Texto con la hora exacta; la plantilla lleva los cuatro datos en una línea. */
export function armarAvisoLlegadaSinConfirmar(v: ViajeContexto, h: HitoFila, motivo: Motivo, ahora: Date): MensajeSaliente {
  const chofer = una(v.operadorNombre ?? 'El chofer', 60) || 'El chofer';
  const folio = v.folio || v.id.slice(0, 8);
  const esCarga = h.tipo === 'llegada_carga';
  const sitio = una((esCarga ? v.origen : v.destino) ?? '', 60);
  const lugar = `${esCarga ? 'la carga' : 'la descarga'}${sitio ? ` de ${sitio}` : ''}`;
  const cuando = horaYDiaMx(new Date(h.mensajeEn ?? h.recibidoEn ?? ahora.toISOString()), ahora);
  const porQue: Record<Motivo, { largo: string; corto: string }> = {
    sin_sitio: { largo: 'el viaje no tiene sitio asignado y no hay con qué compararlo contra el GPS', corto: 'el viaje no tiene sitio asignado para compararlo con el GPS' },
    sin_coincidencia: { largo: 'la posición que se comparó cae fuera del sitio (puede ser una muestra vieja: revísalo antes de dar por mala la llegada)', corto: 'la posición comparada cae fuera del sitio' },
    sin_ubicacion: { largo: 'ninguna posición (pin o GPS) la respalda todavía', corto: 'ninguna posición la respalda todavía' },
  };
  const texto = `Llegada sin confirmar: ${chofer} avisó a las ${cuando} (hora de su mensaje) que llegó a ${lugar} (viaje ${folio}) y ${porQue[motivo].largo}. Revísalo en el tablero de hitos: ${appUrl()}/dashboard/agentes/conductores`;
  return {
    texto,
    botones: [],
    plantilla: {
      nombre: 'conductor_llegada_sin_confirmar_v1',
      ...opcionesDeEnvio('conductor_llegada_sin_confirmar_v1', { cuerpo: [chofer, una(lugar, 90), folio, porQue[motivo].corto] }),
    },
  };
}

const llave = (v: ViajeContexto, h: HitoFila): NuevoAviso => ({
  tenantId: v.tenantId, viajeId: v.id, hitoId: h.id, operadorId: null, ciclo: h.ciclo, clase: 'llegada_sin_confirmar', nivel: 1,
});

export async function correrAlertasLlegadaSinConfirmar(
  p: PuertosAlertaLlegada, opts: { ahora?: Date; venceEn?: number } = {},
): Promise<ResultadoAlertasLlegada> {
  const ahora = opts.ahora ?? new Date();
  const r: ResultadoAlertasLlegada = { revisadas: 0, avisos: 0, yaReclamados: 0, sinDestinatario: 0, fueraDeVentana: 0, rechazosReintentables: 0, fallos: [] };
  const viajes = await p.viajesActivos(400);
  if (viajes.length === 0) return r;

  // La config se lee por flota; solo las que encendieron la perilla pasan a leer hitos, veredictos y sitios.
  const configs = new Map<string, ConfigConductor | null>();
  for (const t of new Set(viajes.map((v) => v.tenantId))) {
    try { configs.set(t, await p.configDe(t)); } catch (e) {
      configs.set(t, null);
      logger.error('conductor.llegada_config_ilegible', { tenant: t, err: e instanceof Error ? e.message : String(e) });
    }
  }
  const activos = viajes.filter((v) => { const c = configs.get(v.tenantId); return !!c && c.activo && c.avisarLlegadaSinConfirmar && c.validarUbicacion; });
  if (activos.length === 0) return r;

  const hitos = await p.hitosDe(activos.map((v) => v.id));
  const porViaje = new Map<string, HitoFila[]>();
  for (const h of hitos) porViaje.set(h.viajeId, [...(porViaje.get(h.viajeId) ?? []), h]);
  const sitios = await p.sitiosDe(activos.map((v) => v.id));
  const veredictos = new Map<string, VeredictoFila>(); // hitoId → veredicto del ciclo vigente
  for (const t of new Set(activos.map((v) => v.tenantId))) {
    for (const f of await p.veredictosDe(t, activos.filter((v) => v.tenantId === t).map((v) => v.id))) {
      const previo = veredictos.get(f.hitoId);
      if (!previo || f.ciclo >= previo.ciclo) veredictos.set(f.hitoId, f);
    }
  }

  let rechazosSeguidos = 0;
  for (const v of activos) {
    if (opts.venceEn !== undefined && Date.now() >= opts.venceEn) break;
    const config = configs.get(v.tenantId) as ConfigConductor;
    const sitio = sitios.get(v.id);
    if (!sitio) continue; // no se supo si el viaje trae sitio: no se adivina
    for (const h of porViaje.get(v.id) ?? []) {
      if (h.tipo !== 'llegada_carga' && h.tipo !== 'llegada_descarga') continue;
      if (!h.recibidoEn) continue;
      const edadMs = ahora.getTime() - new Date(h.recibidoEn).getTime();
      if (edadMs < MINUTOS_GRACIA_LLEGADA_SIN_CONFIRMAR * 60_000 || edadMs > HORAS_MAXIMAS_LLEGADA_SIN_CONFIRMAR * 3_600_000) continue;
      const f = veredictos.get(h.id);
      const vigente = f && f.ciclo === h.ciclo ? f : undefined;
      const haySitio = h.tipo === 'llegada_carga' ? sitio.origen : sitio.destino;
      let motivo: Motivo;
      if (llegadaSinSitio(h, vigente, true, haySitio)) motivo = 'sin_sitio';
      else if (llegadaPorConfirmar(h, vigente, true, haySitio)) motivo = vigente?.resultado === 'sin_coincidencia' ? 'sin_coincidencia' : 'sin_ubicacion';
      else continue;

      r.revisadas++;
      if (!dentroDeVentana(config, ahora)) { r.fueraDeVentana++; continue; }
      try {
        const claim = llave(v, h);
        const gano = await p.reclamar(claim);
        if (gano === 'perdido') { r.yaReclamados++; continue; }
        if (gano === 'fallo') { r.fallos.push(`reclamo llegada ${v.id}`); continue; }

        const destinos = await p.destinatarios(v.tenantId, v.terminalId, 1);
        if (destinos.length === 0) {
          r.sinDestinatario++;
          r.fallos.push(`${v.folio ?? v.id}: no hay a quién avisar la llegada sin confirmar`);
          await p.cerrarAviso(claim, { ok: false, canal: 'ninguno', motivo: 'sin_destinatario', ult4: null });
          continue;
        }
        const msg = armarAvisoLlegadaSinConfirmar(v, h, motivo, ahora);
        let entregados = 0;
        let reintentables = 0;
        let ultimoError = '';
        let canal: 'texto' | 'botones' | 'plantilla' = 'texto';
        for (const d of destinos) {
          const envio = await p.enviar(d.telefono, msg, 'conductor.llegada_sin_confirmar', v.tenantId, ahora);
          if (envio.ok) { entregados++; canal = envio.via; } else { ultimoError = envio.mensaje; if (envio.reintentable) reintentables++; }
        }
        if (entregados === 0 && reintentables === destinos.length) {
          await p.liberarAviso(claim);
          r.rechazosReintentables++;
          rechazosSeguidos++;
          r.fallos.push(`llegada ${v.folio ?? v.id}: ${ultimoError} (se reintenta en la siguiente corrida)`);
        } else {
          rechazosSeguidos = 0;
          await p.cerrarAviso(claim, { ok: entregados > 0, canal: entregados > 0 ? canal : 'ninguno', motivo: entregados > 0 ? null : ultimoError.slice(0, 200), ult4: destinos[0].telefono.slice(-4) });
          if (entregados > 0) {
            r.avisos++;
            await p.evento(h, 'alerta_llegada_sin_confirmar', { motivo, destinatarios: destinos.length, entregados });
          } else r.fallos.push(`llegada ${v.folio ?? v.id}: ${ultimoError}`);
        }
      } catch (err) {
        r.fallos.push(`${v.folio ?? v.id}: ${err instanceof Error ? err.message : 'error inesperado'}`);
        logger.error('conductor.llegada_fallo', { viaje: v.id, err: err instanceof Error ? err.message : String(err) });
      }
      if (rechazosSeguidos >= 5) {
        logger.error('conductor.llegada_rechazo_masivo', { rechazosSeguidos });
        return r;
      }
    }
  }
  return r;
}
