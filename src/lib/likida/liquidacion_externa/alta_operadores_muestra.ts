// ═══════════════════════════════════════════════════════════════════════════
// ALTA AUTOMÁTICA DE OPERADORES EN EL FORMATO «muestra-tms» (18-nov-2026).
//
// Acuerdo de la reunión del 17-nov: no se lleva control de operadores; si la fuente manda la bitácora con un operador, ese operador es
// válido. El formato `muestra-tms` resuelve al operador contra el padrón ANTES de recibir el desglose, así que un número de empleado sin
// alta mandaba la bitácora a revisión (`numero_sin_alta`). Aquí, antes de resolver, se completa el padrón con los números que la
// bitácora trae y la flota no tiene: se dan de alta (activos, sin WhatsApp, sin correo) y entran al padrón del resto del proceso.
//
// Reglas (todas por diseño, no por descuido):
//   · Solo con `NumeroEmpleado`: sin número no hay con qué dar de alta (se queda en revisión como siempre).
//   · Un número que YA está en el padrón (activo o de baja) NO se toca: el de baja sigue su camino de siempre.
//   · Sin nombre utilizable se rotula «Operador <número>»; no se inventa un nombre.
//   · Con `simular` no se escribe nada, pero el padrón devuelto SÍ incluye a los nuevos: la vista previa dice lo que pasaría.
//   · Si la compuerta de la flota no lo permite o el insert falla, ese número queda fuera del padrón y la bitácora va a revisión.
// ═══════════════════════════════════════════════════════════════════════════

import type { PadronOperadores } from './desglose_muestra_tms';

export interface DepsAltaMuestra {
  /** ¿Esta flota puede dar de alta operadores sin teléfono? (misma compuerta del alta sin WhatsApp, 0932). */
  permite: (tenantId: string) => Promise<boolean>;
  /** Inserta al operador (nombre, número). `null` si no se pudo (p. ej. carrera por el mismo número). */
  insertar: (tenantId: string, nombre: string, numeroEmpleado: string) => Promise<unknown | null>;
}

const esObjeto = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

/** Las bitácoras crudas del cuerpo `muestra-tms` (sobre con `bitacoras`, o una suelta con `BitacoraID`). */
function bitacorasCrudas(cuerpo: Record<string, unknown>): unknown[] {
  if ('BitacoraID' in cuerpo) return [cuerpo];
  return Array.isArray(cuerpo.bitacoras) ? cuerpo.bitacoras : [];
}

export async function completarPadronConAltas(
  tenantId: string, cuerpo: Record<string, unknown>, padron: PadronOperadores, opciones: { simular: boolean }, deps: DepsAltaMuestra,
): Promise<PadronOperadores> {
  const existentes = new Set(padron.map((o) => o.numeroEmpleado.trim()).filter((n) => n !== ''));
  const nuevos = new Map<string, string>();
  for (const f of bitacorasCrudas(cuerpo)) {
    if (!esObjeto(f)) continue;
    const numero = texto(f.NumeroEmpleado);
    if (numero === '' || numero.length > 40 || existentes.has(numero) || nuevos.has(numero)) continue;
    const nombre = texto(f.Operador).replace(/\s+/g, ' ');
    nuevos.set(numero, nombre.length >= 3 && nombre.length <= 120 ? nombre : `Operador ${numero}`);
  }
  if (nuevos.size === 0 || !(await deps.permite(tenantId))) return padron;
  const altas: Array<{ numeroEmpleado: string; nombre: string }> = [];
  for (const [numero, nombre] of nuevos) {
    if (!opciones.simular && (await deps.insertar(tenantId, nombre, numero)) === null) continue;
    altas.push({ numeroEmpleado: numero, nombre });
  }
  return [...padron, ...altas];
}
