import type { EstadoGuia, ParcheEstadoGuia } from '@/lib/likida/guia/tipos';
import type { EstadoOnboarding } from './estado';

// Puente entre el estado cosmético que ya usa el motor (`visto`, `descartado`, `modo`, `pistas`) y el estado v1 que vive en servidor
// (SPEC 2.4). Funciones PURAS: el proveedor decide cuándo leer y escribir; aquí solo se traduce y se fusiona. Sin red, sin DOM.

/** El servidor manda: la invitación «vista», «ahora no» o «descartada» cuenta como ya ofrecida. */
export function cosmeticoDeServidor(e: EstadoGuia): EstadoOnboarding {
  return { visto: e.invitacion !== 'pendiente', descartado: e.invitacion === 'descartada', modo: e.modo, pistas: [...e.pistas] };
}

export const hayEstadoLocal = (l: EstadoOnboarding): boolean => l.visto || l.descartado || l.modo !== null || l.pistas.length > 0;

/** Migración desde localStorage: se importa UNA vez (cuando no hay fila en servidor) y queda marcada `importado`. */
export function parcheDeImportacion(l: EstadoOnboarding): ParcheEstadoGuia {
  return { invitacion: l.descartado ? 'descartada' : l.visto ? 'vista' : 'pendiente', modo: l.modo, pistas: l.pistas, importado: true };
}

/** Acumula parches mientras se espera el envío: `recorridos`, `tareas` y `declaraciones` por clave; lo demás lo último gana. */
export function fusionarParches(a: ParcheEstadoGuia, b: ParcheEstadoGuia): ParcheEstadoGuia {
  const sal: ParcheEstadoGuia = { ...a, ...b };
  if (a.recorridos || b.recorridos) sal.recorridos = { ...a.recorridos, ...b.recorridos };
  if (a.tareas || b.tareas) sal.tareas = { ...a.tareas, ...b.tareas };
  if (a.declaraciones || b.declaraciones) sal.declaraciones = { ...a.declaraciones, ...b.declaraciones };
  return sal;
}
