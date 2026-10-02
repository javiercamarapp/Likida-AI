import { appUrl } from '@/lib/env';
import { logger } from '@/lib/logger';
import { opcionesDeEnvio } from '@/lib/meta/plantillas_catalogo';
import { parametrosAvisoOficina } from '@/lib/meta/aviso_oficina';
import { dentroDeVentana, type ConfigConductor } from './config';
import { calcularEstancias, excedeUmbral, umbralDe, type Estancia } from './estadias_anden';
import type { PuertosConductor, NuevoAviso } from './ejecutor';
import { horaYDiaMx } from './mensajes';
import { textoTiempo } from './planificador';
import type { ViajeContexto } from './repo';
import type { MensajeSaliente } from './solicitudes';
import type { HitoFila } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// LA ALERTA POR EXCESO DE ESTADÍA — «lleva 3 h en el andén».
//
// Configurable por flota y por parada (`estadia_alerta_carga_min` /
// `estadia_alerta_descarga_min`; NULL = sin alerta, que es el default: un aviso por
// cada parada larga es ruido hasta que el tráfico lo pida). Mientras la unidad sigue
// en el andén y rebasa el umbral, el patio responsable de la terminal recibe UN aviso
// con la hora exacta de la llegada (la del mensaje del chofer).
//
//   · UN aviso por parada y ciclo: el claim `alerta_estadia` (nivel 1) sobre el hito
//     de LLEGADA es el candado — dos corridas solapadas mandan uno solo, y una
//     reentrega no repite.
//   · Mismo envío que todo lo demás: `enviarConFallback` (ventana 24 h → texto;
//     fuera → la plantilla genérica `aviso_operacion_v1`).
//   · Nunca fuera de la ventana horaria de la flota: una alerta nocturna espera a
//     que abra (no se reclama hasta entonces).
//   · Un rechazo reintentable libera el claim (se reintenta en la siguiente corrida);
//     uno definitivo lo deja cerrado con `ok = false` y el motivo a la vista.
// ═══════════════════════════════════════════════════════════════════════════

export interface ResultadoAlertasEstadia {
  revisadas: number;
  alertas: number;
  yaReclamadas: number;
  sinDestinatario: number;
  fueraDeVentana: number;
  rechazosReintentables: number;
  fallos: string[];
}

/** El texto y la plantilla del aviso. Texto con la hora exacta; plantilla = la genérica de operación. */
export function armarAlertaEstadia(v: ViajeContexto, e: Estancia, umbralMin: number, ahora: Date): MensajeSaliente {
  const chofer = (v.operadorNombre ?? 'El chofer').replace(/\s+/g, ' ').trim().slice(0, 60) || 'El chofer';
  const folio = v.folio || v.id.slice(0, 8);
  const lugar = e.lugar === 'carga' ? 'la carga' : 'la descarga';
  const sitio = ((e.lugar === 'carga' ? v.origen : v.destino) ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const llegada = e.llegada ? horaYDiaMx(new Date(e.llegada.en), ahora) : 'hora desconocida';
  const duracion = textoTiempo(e.minutos ?? 0);
  const texto = `Estadía larga: ${chofer} lleva ${duracion} en ${lugar}${sitio ? ` de ${sitio}` : ''} (viaje ${folio}). Llegó a las ${llegada} (hora de su mensaje) y no ha avisado su salida. Tu alerta está en ${textoTiempo(umbralMin)}. Revísalo en el tablero.`;
  const resumen = `lleva ${duracion} en ${lugar} (${folio})`;
  return {
    texto,
    botones: [],
    plantilla: {
      nombre: 'aviso_operacion_v1',
      ...opcionesDeEnvio('aviso_operacion_v1', { cuerpo: parametrosAvisoOficina(chofer, resumen, `${appUrl()}/dashboard/agentes/conductores`) }),
    },
  };
}

const llave = (v: ViajeContexto, hitoLlegada: HitoFila): NuevoAviso => ({
  tenantId: v.tenantId, viajeId: v.id, hitoId: hitoLlegada.id, operadorId: null, ciclo: hitoLlegada.ciclo, clase: 'alerta_estadia', nivel: 1,
});

export async function correrAlertasEstadia(
  p: PuertosConductor, opts: { ahora?: Date; venceEn?: number } = {},
): Promise<ResultadoAlertasEstadia> {
  const ahora = opts.ahora ?? new Date();
  const r: ResultadoAlertasEstadia = { revisadas: 0, alertas: 0, yaReclamadas: 0, sinDestinatario: 0, fueraDeVentana: 0, rechazosReintentables: 0, fallos: [] };
  const viajes = await p.viajesActivos(400);
  if (viajes.length === 0) return r;
  const hitos = await p.hitosDe(viajes.map((v) => v.id));
  const porViaje = new Map<string, HitoFila[]>();
  for (const h of hitos) porViaje.set(h.viajeId, [...(porViaje.get(h.viajeId) ?? []), h]);

  const configs = new Map<string, ConfigConductor | null>();
  for (const t of new Set(viajes.map((v) => v.tenantId))) {
    try { configs.set(t, await p.configDe(t)); } catch (e) {
      configs.set(t, null);
      logger.error('conductor.estadia_config_ilegible', { tenant: t, err: e instanceof Error ? e.message : String(e) });
    }
  }
  const vacio = new Map<string, never>();
  let rechazosSeguidos = 0;
  for (const v of viajes) {
    if (opts.venceEn !== undefined && Date.now() >= opts.venceEn) break;
    const config = configs.get(v.tenantId);
    if (!config || !config.activo) continue;
    if (config.estadiaAlertaCargaMin === null && config.estadiaAlertaDescargaMin === null) continue;
    const hs = porViaje.get(v.id) ?? [];
    const enCurso = calcularEstancias(v, hs, ahora, { validaciones: vacio, evidencias: vacio }).filter((e) => excedeUmbral(e, config));
    for (const e of enCurso) {
      r.revisadas++;
      if (!dentroDeVentana(config, ahora)) { r.fueraDeVentana++; continue; }
      const hl = hs.find((h) => h.id === e.llegada?.hitoId);
      if (!hl) continue;
      try {
        const claim = llave(v, hl);
        const gano = await p.reclamar(claim);
        if (gano === 'perdido') { r.yaReclamadas++; continue; }
        if (gano === 'fallo') { r.fallos.push(`reclamo estadía ${v.id}`); continue; }

        const destinos = await p.destinatarios(v.tenantId, v.terminalId, 1);
        if (destinos.length === 0) {
          r.sinDestinatario++;
          r.fallos.push(`${v.folio ?? v.id}: no hay a quién avisar la estadía`);
          await p.cerrarAviso(claim, { ok: false, canal: 'ninguno', motivo: 'sin_destinatario', ult4: null });
          continue;
        }
        const msg = armarAlertaEstadia(v, e, umbralDe(config, e.lugar) ?? 0, ahora);
        let entregados = 0;
        let reintentables = 0;
        let ultimoError = '';
        let canal: 'texto' | 'botones' | 'plantilla' = 'texto';
        for (const d of destinos) {
          const envio = await p.enviar(d.telefono, msg, 'conductor.alerta_estadia', v.tenantId, ahora);
          if (envio.ok) { entregados++; canal = envio.via; } else { ultimoError = envio.mensaje; if (envio.reintentable) reintentables++; }
        }
        if (entregados === 0 && reintentables === destinos.length) {
          // Un rechazo reintentable (timeout, 429, 5xx) YA dejó el texto en `wa_outbox` (client.ts), que lo
          // entrega con su backoff. Soltar el claim aquí haría que la siguiente corrida lo mande otra vez y el
          // outbox entregue el primero: dos avisos. El claim se CIERRA como «en cola» y el outbox es quien reintenta.
          await p.cerrarAviso(claim, { ok: true, canal: 'texto', motivo: 'en_cola_outbox', ult4: destinos[0].telefono.slice(-4) });
          r.rechazosReintentables++;
          rechazosSeguidos++;
          r.fallos.push(`estadía ${v.folio ?? v.id}: ${ultimoError} (queda en la cola de WhatsApp; no se reenvía)`);
        } else {
          rechazosSeguidos = 0;
          await p.cerrarAviso(claim, { ok: entregados > 0, canal: entregados > 0 ? canal : 'ninguno', motivo: entregados > 0 ? null : ultimoError.slice(0, 200), ult4: destinos[0].telefono.slice(-4) });
          if (entregados > 0) {
            r.alertas++;
            await p.evento(hl, 'alerta_estadia', { lugar: e.lugar, minutos: e.minutos ?? 0, destinatarios: destinos.length, entregados });
          } else r.fallos.push(`estadía ${v.folio ?? v.id}: ${ultimoError}`);
        }
      } catch (err) {
        r.fallos.push(`${v.folio ?? v.id}: ${err instanceof Error ? err.message : 'error inesperado'}`);
        logger.error('conductor.estadia_fallo', { viaje: v.id, err: err instanceof Error ? err.message : String(err) });
      }
      if (rechazosSeguidos >= 5) {
        logger.error('conductor.estadia_rechazo_masivo', { rechazosSeguidos });
        return r;
      }
    }
  }
  return r;
}
