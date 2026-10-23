import { puertosReales } from './ejecutor';
import {
  abrirEpisodioSenalVida, anotarFalloSenalVida, cerrarEpisodioSenalVida, leerConfigConductor, reclamarNivelSenalVida,
} from './repo';
import { leerEpisodiosSenalVida, leerFlotasConConectorDegradado, leerHitosDeViajes, leerMuestrasGps, leerSitiosGeometriaDeFlotas, leerSitiosGeometriaDeViajes, leerUltimaMuestraGps, leerViajesAvisables } from './trabajo';
import type { PuertosSenalVida } from './senal_vida';
import { senalesApagadas } from './senales_conduccion';

/** Los puertos reales del barrido de «sin señal de vida»: Supabase y Meta (el envío, los destinatarios y la ubicación son los del motor del Conductor). */
export function puertosSenalVidaReales(): PuertosSenalVida {
  const motor = puertosReales();
  return {
    viajes: leerViajesAvisables,
    hitosDe: leerHitosDeViajes,
    configDe: leerConfigConductor,
    sitiosDe: leerSitiosGeometriaDeViajes,
    muestras: leerMuestrasGps,
    ultimaMuestra: leerUltimaMuestraGps,
    sitiosFlota: leerSitiosGeometriaDeFlotas,
    conectoresDegradados: leerFlotasConConectorDegradado,
    episodios: leerEpisodiosSenalVida,
    abrir: abrirEpisodioSenalVida,
    reclamarNivel: reclamarNivelSenalVida,
    cerrar: cerrarEpisodioSenalVida,
    anotarFallo: anotarFalloSenalVida,
    enviar: motor.enviar,
    destinatarios: motor.destinatarios,
    ubicacion: motor.ubicacion,
    // T-A5-68: nace apagado (sin adaptador de proveedor real: BLOQUEO EXTERNO); el mismo puerto que el del motor.
    senalesConduccion: motor.senalesConduccion ?? senalesApagadas,
  };
}
