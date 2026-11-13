// A quién va el resumen por correo. PURO. Usa la lista de servicio al cliente y los directores (con su turno) que la flota ya
// configura en el tablero del Vigía; no inventa personas. Nivel 2 (dueño) solo recibe si hay una alerta alta en un grupo crítico.
import { filtrarPorTurno, turnoActual, type TurnoActual } from '../turnos';
import type { DestinatariosResumenCrudos } from '../repo';
import type { AlertaSinAtender } from './motor';

export const MAX_DESTINATARIOS_RESUMEN = 10;
/**
 * `clientes`: los clientes cuyas alertas puede ver. `null` (o ausente) = toda la flota (directores y servicio sin cliente asignado);
 * una lista = SOLO alertas de esos clientes (servicio al cliente ligado a un cliente). Es lo que impide la fuga entre clientes.
 */
export interface DestinatarioResumen { nombre: string; correo: string; origen: 'servicio' | 'nivel1' | 'nivel2'; clientes?: readonly string[] | null }

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
  const turno = turnoActual(ahora, crudos.zona, crudos.festivos, crudos.noche);
  const clientes = new Set(alertas.map((a) => e.clienteDeChat.get(a.chatId)).filter((x): x is string => !!x));
  const hayAltaCritica = alertas.some((a) => a.nivel === 'alta' && a.critico);
  const salida: DestinatarioResumen[] = [];
  const vistos = new Map<string, DestinatarioResumen>();
  const agregar = (nombre: string, correo: string, origen: DestinatarioResumen['origen'], alcance: string | null = null) => {
    const c = correo.trim().toLowerCase();
    if (c === '') return;
    const previo = vistos.get(c);
    if (previo) {
      // Mismo correo repetido: ver toda la flota gana; si no, se juntan los clientes (nunca se pierde cobertura ni se amplía de más).
      if (previo.clientes === null || alcance === null) previo.clientes = null;
      else if (!previo.clientes!.includes(alcance)) previo.clientes = [...previo.clientes!, alcance];
      return;
    }
    if (salida.length >= MAX_DESTINATARIOS_RESUMEN) return;
    const nuevo: DestinatarioResumen = { nombre, correo: c, origen, clientes: alcance === null ? null : [alcance] };
    vistos.set(c, nuevo);
    salida.push(nuevo);
  };
  for (const s of crudos.servicio) if (s.clienteId === null || clientes.has(s.clienteId)) agregar(s.nombre, s.correo, 'servicio', s.clienteId);
  const n1 = filtrarPorTurno(crudos.nivel1, ahora, crudos.zona, crudos.festivos, crudos.noche);
  for (const d of n1.lista) agregar(d.nombre, d.correo, 'nivel1');
  let cayo = n1.cayoATodos;
  if (hayAltaCritica) {
    const n2 = filtrarPorTurno(crudos.nivel2, ahora, crudos.zona, crudos.festivos, crudos.noche);
    cayo = cayo || n2.cayoATodos;
    for (const d of n2.lista) agregar(d.nombre, d.correo, 'nivel2');
  }
  return { destinatarios: salida, turno, cayoATodos: cayo };
}
