import { puertosReales } from './ejecutor';
import {
  abrirEpisodioSenalVida, anotarFalloSenalVida, cerrarEpisodioSenalVida, leerConfigConductor, reclamarNivelSenalVida,
} from './repo';
import { leerEpisodiosSenalVida, leerFlotasConConectorDegradado, leerHitosDeViajes, leerMuestrasGps, leerSitiosGeometriaDeFlotas, leerSitiosGeometriaDeViajes, leerUltimaMuestraGps, leerViajesActivos } from './trabajo';
import type { PuertosSenalVida } from './senal_vida';

/** Los puertos reales del barrido de «sin señal de vida»: Supabase y Meta (el envío, los destinatarios y la ubicación son los del motor del Conductor). */
export function puertosSenalVidaReales(): PuertosSenalVida {
  const motor = puertosReales();
  return {
    viajes: leerViajesActivos,
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
  };
}
