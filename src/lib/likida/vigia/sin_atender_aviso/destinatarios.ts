// A quién va el resumen por correo. PURO. Usa la lista de servicio al cliente y los directores (con su turno) que la flota ya
// configura en el tablero del Vigía; no inventa personas. Nivel 2 (dueño) solo recibe si hay una alerta alta en un grupo crítico.
import { filtrarPorTurno, turnoActual, type TurnoActual } from '../turnos';
import type { DestinatariosResumenCrudos } from '../repo';
import type { AlertaSinAtender } from './motor';

export const MAX_DESTINATARIOS_RESUMEN = 10;
export interface DestinatarioResumen { nombre: string; correo: string; origen: 'servicio' | 'nivel1' | 'nivel2' }

export interface EntradaDestinatarios {
  crudos: DestinatariosResumenCrudos;
  alertas: readonly AlertaSinAtender[];
  /** grupo (chatId) -> cliente dueño del grupo, para elegir al servicio al cliente de ese cliente. */
  clienteDeChat: ReadonlyMap<string, string>;
  /** El momento del ENVÍO (no el de la foto): decide qué turno recibe. */
  ahora: Date;
}

export function destinatariosDelResumen(e: EntradaDestinatarios): { destinatarios: DestinatarioResumen[]; turno: TurnoActual; cayoATodos: boolean } {
  const { crudos, alertas, ahora } = e;
  const turno = turnoActual(ahora, crudos.zona, crudos.festivos);
  const clientes = new Set(alertas.map((a) => e.clienteDeChat.get(a.chatId)).filter((x): x is string => !!x));
  const hayAltaCritica = alertas.some((a) => a.nivel === 'alta' && a.critico);
  const salida: DestinatarioResumen[] = [];
  const vistos = new Set<string>();
  const agregar = (nombre: string, correo: string, origen: DestinatarioResumen['origen']) => {
    const c = correo.trim().toLowerCase();
    if (c === '' || vistos.has(c) || salida.length >= MAX_DESTINATARIOS_RESUMEN) return;
    vistos.add(c);
    salida.push({ nombre, correo: c, origen });
  };
  for (const s of crudos.servicio) if (s.clienteId === null || clientes.has(s.clienteId)) agregar(s.nombre, s.correo, 'servicio');
  const n1 = filtrarPorTurno(crudos.nivel1, ahora, crudos.zona, crudos.festivos);
  for (const d of n1.lista) agregar(d.nombre, d.correo, 'nivel1');
  let cayo = n1.cayoATodos;
  if (hayAltaCritica) {
    const n2 = filtrarPorTurno(crudos.nivel2, ahora, crudos.zona, crudos.festivos);
    cayo = cayo || n2.cayoATodos;
    for (const d of n2.lista) agregar(d.nombre, d.correo, 'nivel2');
  }
  return { destinatarios: salida, turno, cayoATodos: cayo };
}
