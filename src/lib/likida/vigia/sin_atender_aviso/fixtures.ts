// Datos ficticios para las pruebas del resumen de «sin atender». Nada de personas ni clientes reales.
import type { DestinatariosResumenCrudos } from '../repo';
import { ZONA_POR_OMISION } from '../turnos';
import type { AlertaSinAtender, ResultadoSinAtender } from './motor';

export const TENANT_A = '11111111-1111-4111-8111-111111111111';
export const TENANT_B = '22222222-2222-4222-8222-222222222222';
export const CLIENTE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const CLIENTE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
/** Miércoles 12:00 hora de México. */
export const AHORA_DIA = Date.parse('2026-11-04T18:00:00Z');
/** Miércoles 23:00 hora de México. */
export const AHORA_NOCHE = Date.parse('2026-11-05T05:00:00Z');

export function alerta(p: Partial<AlertaSinAtender> = {}): AlertaSinAtender {
  return {
    chatId: 'g1', chatNombre: 'Grupo A', critico: false, nivel: 'normal', motivos: ['espera_sobre_umbral'], desde: '2026-11-04T16:00:00.000Z', ultimoEn: '2026-11-04T16:05:00.000Z',
    fotoEn: '2026-11-04T18:00:00.000Z', antiguedadMin: 120, umbralAplicadoMin: 30, excesoMin: 90, mensajesSinAtender: 1, preguntasSinAtender: 0, turno: 'dia',
    clave: 'clave-g1', vistaPrevia: null, ...p,
  };
}
export function resultado(alertas: AlertaSinAtender[]): ResultadoSinAtender {
  return {
    ahoraEn: new Date(AHORA_DIA).toISOString(), alertas,
    resumen: {
      chatsRevisados: 2, chatsConAlerta: new Set(alertas.map((a) => a.chatId)).size, alertas: alertas.length, altas: alertas.filter((a) => a.nivel === 'alta').length,
      normales: alertas.filter((a) => a.nivel === 'normal').length, ignorados: 0, mensajesAnalizados: 4, descartados: 0,
      masAntiguaMin: alertas.length ? Math.max(...alertas.map((a) => a.antiguedadMin)) : null, porTurno: { dia: alertas.length, noche: 0, festivo: 0 },
    },
  };
}
export function crudos(p: Partial<DestinatariosResumenCrudos> = {}): DestinatariosResumenCrudos {
  return {
    servicio: [{ nombre: 'Servicio 1', correo: 'servicio1@ejemplo.test', clienteId: null }],
    nivel1: [{ nombre: 'Gerente día', correo: 'dia@ejemplo.test', turno: 'siempre' }, { nombre: 'Guardia noche', correo: 'noche@ejemplo.test', turno: 'noche' }],
    nivel2: [{ nombre: 'Dueño', correo: 'dueno@ejemplo.test', turno: 'siempre' }],
    zona: ZONA_POR_OMISION, festivos: [], ...p,
  };
}
