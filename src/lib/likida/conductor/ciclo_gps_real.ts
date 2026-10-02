import { logger } from '@/lib/logger';
import { avisarOficinaDeHito } from './avisos_oficina';
import { MINUTOS_CLAIM_VENCIDO, type Deteccion, type PuertosCicloGps, type ResultadoAplicar } from './ciclo_gps';
import type { ConfigConductor } from './config';
import { completarCruce, leerConfigConductor, liberarCruce, registrarEvento, registrarHito, reclamarCruce, sincronizarLegado, validarHito, type ViajeContexto } from './repo';
import { aplicarVeredicto } from './repo_validacion';
import { leerHitosDeViajes, leerMuestrasGps, leerSitiosGeometriaDeViajes, leerViajesActivos } from './trabajo';
import type { HitoFila } from './tipos';
import type { Veredicto } from './validacion';

// ═══════════════════════════════════════════════════════════════════════════
// APLICAR UNA DETECCIÓN DEL GPS — registrar, validar, sellar y avisar (P2).
//
// `registrarHito` es la MISMA escritura condicional que usa el chofer (`esperado|escalado|omitido → recibido`): si el chofer
// o la oficina llegaron primero, `carrera` y no se toca nada. Lo que cambia es la fuente: `sistema`, con la hora de la MUESTRA
// de GPS que probó el cruce (no la de la corrida), y que el hito se valida con el GPS, que es justo la evidencia:
//   · una LLEGADA entra con su veredicto («validado», fuente gps, distancia al centro): lo mismo que dejaría la validación
//     contra el sitio, y el tablero lo muestra igual;
//   · una SALIDA no se compara contra el sitio (al salir el tractor ya se va): se valida por `gps` y listo.
// Si el veredicto no se pudo escribir, el hito queda `recibido` y el barrido de validación lo toma como cualquier llegada sin
// veredicto. Los sellos de la 0090 (`llegada_en`, `descarga_en`) que lee el Vigía se sellan como los sella el chofer.
// ═══════════════════════════════════════════════════════════════════════════

export interface DepsAplicarDeteccion {
  registrarHito: typeof registrarHito;
  aplicarVeredicto: typeof aplicarVeredicto;
  validarHito: typeof validarHito;
  sincronizarLegado: typeof sincronizarLegado;
  evento: typeof registrarEvento;
  avisarOficina: typeof avisarOficinaDeHito;
}

export const depsAplicarReales: DepsAplicarDeteccion = {
  registrarHito, aplicarVeredicto, validarHito, sincronizarLegado, evento: registrarEvento, avisarOficina: avisarOficinaDeHito,
};

export async function aplicarDeteccion(
  v: ViajeContexto, h: HitoFila, d: Deteccion, config: ConfigConductor, ahora: Date, deps: DepsAplicarDeteccion = depsAplicarReales,
): Promise<ResultadoAplicar> {
  const r = await deps.registrarHito({
    hito: h, fuente: 'sistema', interpretacion: 'sistema', confianza: null, waMessageId: null,
    mensajeEn: d.detectadoEn, ahora, texto: null, contacto: null, omitir: d.omitir,
  });
  if (r !== 'ok') return r === 'carrera' ? 'carrera' : 'fallo';

  const registrado: HitoFila = { ...h, estado: 'recibido', fuente: 'sistema', interpretacion: 'sistema', mensajeEn: d.detectadoEn.toISOString(), recibidoEn: ahora.toISOString() };
  await deps.evento(registrado, 'recibido', { fuente: 'sistema', por: 'geocerca', cruce: d.entrada ? 'entrada' : 'salida', distancia_m: d.distanciaM, fuera_de_orden: d.fueraDeOrden });

  let validado = false;
  if (d.entrada) {
    const veredicto: Veredicto = {
      resultado: 'validado', motivo: null, fuente: 'gps', distanciaM: d.distanciaM, toleranciaM: config.toleranciaUbicacionM,
      radioM: d.sitio.radioM, sitioId: d.sitio.id, medidaEn: d.detectadoEn, metodo: d.sitio.poligono ? 'poligono' : 'circulo',
    };
    const a = await deps.aplicarVeredicto(v.tenantId, registrado, veredicto, ahora);
    validado = a === 'nuevo' || a === 'mejorado' || a === 'igual';
  }
  if (!validado) {
    const a = await deps.validarHito(registrado, 'gps', ahora);
    if (a === 'fallo') logger.warn('conductor.ciclo_gps_sin_validar', { viaje: v.id, hito: h.tipo });
  }

  if (d.tipo === 'llegada_descarga') await deps.sincronizarLegado(v.tenantId, v.id, ['llegada'], d.detectadoEn);
  if (d.tipo === 'salida_descarga') await deps.sincronizarLegado(v.tenantId, v.id, ['descarga'], d.detectadoEn);

  if (d.entrada ? config.avisarOficinaLlegada : config.avisarOficinaSalida) {
    try { await deps.avisarOficina({ viaje: v, hito: registrado, mensajeEn: d.detectadoEn, contacto: null, ahora }); } catch (e) {
      logger.warn('conductor.ciclo_gps_aviso_oficina_fallo', { viaje: v.id, err: e instanceof Error ? e.message : String(e) });
    }
  }
  return 'ok';
}

export function puertosCicloGpsReales(): PuertosCicloGps {
  return {
    viajes: leerViajesActivos,
    hitosDe: leerHitosDeViajes,
    configDe: leerConfigConductor,
    sitiosDe: leerSitiosGeometriaDeViajes,
    muestras: leerMuestrasGps,
    reclamar: (c, ahora) => reclamarCruce(c, ahora, MINUTOS_CLAIM_VENCIDO),
    completar: (c, ahora) => completarCruce(c, ahora),
    liberar: (c) => liberarCruce(c),
    aplicar: (v, h, d, config, ahora) => aplicarDeteccion(v, h, d, config, ahora),
  };
}
