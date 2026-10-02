import { puedeVerArea, type Area } from '@/lib/auth/visibilidad';

// ═══════════════════════════════════════════════════════════════════════════
// QUÉ HERRAMIENTAS DEL ORQUESTADOR EXISTEN PARA CADA ROL.
//
// El orquestador (la «pestaña tipo chat» del panel) lee de muchas fuentes. Esas
// fuentes ya tienen dueño de área en `auth/visibilidad.ts`: el jefe de tráfico
// (`encargado`) ve operación y no dinero; el contador ve dinero y no despacha.
// Una pregunta en lenguaje natural NO puede ser la puerta trasera de esa
// frontera, así que cada herramienta declara su área y se aplica en DOS sitios:
//   1. al OFRECER las herramientas al modelo (no ve las que su rol no puede);
//   2. dentro del handler (defensa en profundidad: si el modelo inventa el
//      nombre de una tool que no se le ofreció, el handler la niega).
// Un rol desconocido no ve nada (fail closed, como `areasDe`).
// ═══════════════════════════════════════════════════════════════════════════

/** Área requerida por cada herramienta; `null` = la ve cualquier rol con sesión de flota. */
export const AREA_POR_HERRAMIENTA = {
  // — las del analista de dinero (preexistentes) —
  kpis_flota: 'dinero',
  acreditables_periodo: 'dinero',
  motor_fiscal: 'dinero',
  viajes_flota: 'dinero',
  liquidaciones_flota: 'dinero',
  serie_gasto: 'dinero',
  serie_liquidado: 'dinero',
  top_rutas: 'dinero',
  duplicados_detectados: 'dinero',
  proyectar_serie: 'dinero',
  consultar_carta_porte: 'operacion',
  consultar_normas: null,
  // — las del orquestador —
  tablero_viajes: 'operacion',
  detalle_viaje: 'operacion',
  estado_vigia: 'operacion',
  estado_buzon: 'dinero',
  estado_cobranza: 'dinero',
  estado_autofactura: 'dinero',
  salud_agentes: 'operacion',
  // P6: más lecturas, todas de solo lectura y por área. El convenio y la jornada no enseñan un peso; la entrega de la liquidación
  // externa y la reclamación de peajes sí tocan dinero (conteos de liquidaciones, montos de cobros): área `dinero`.
  convenio_viaje: 'operacion',
  estado_jornada: 'operacion',
  estado_liquidacion_externa: 'dinero',
  reclamacion_peajes: 'dinero',
  // Escalar es DERIVAR: cualquier rol con sesión puede pedir que una persona decida (el contador también
  // escala una diferencia de liquidación). No lee nada de otra área.
  escalar_a_persona: null,
} as const satisfies Record<string, Area | null>;

export type HerramientaOrquestada = keyof typeof AREA_POR_HERRAMIENTA;

export function areaDeHerramienta(nombre: string): Area | null | undefined {
  return Object.prototype.hasOwnProperty.call(AREA_POR_HERRAMIENTA, nombre)
    ? AREA_POR_HERRAMIENTA[nombre as HerramientaOrquestada]
    : undefined;
}

/** ¿Puede este rol llamar esta herramienta? Una desconocida se niega. */
export function rolPuedeUsar(rol: string | undefined, herramienta: string): boolean {
  const area = areaDeHerramienta(herramienta);
  if (area === undefined) return false;
  if (!rol) return false;
  if (area === null) return puedeVerArea(rol, 'operacion') || puedeVerArea(rol, 'dinero');
  return puedeVerArea(rol, area);
}

/** Las herramientas de `todas` que el rol puede ver, en el mismo orden. */
export function herramientasDelRol<T extends string>(rol: string | undefined, todas: readonly T[]): T[] {
  return todas.filter((t) => rolPuedeUsar(rol, t));
}

/** ¿Hay AL MENOS una herramienta para este rol? (la puerta de la ruta del chat) */
export function rolPuedeConversar(rol: string | undefined): boolean {
  return !!rol && (puedeVerArea(rol, 'operacion') || puedeVerArea(rol, 'dinero'));
}

// ── Quién LEE una tarea escalada ─────────────────────────────────────────────
// Escalar es abierto a cualquier rol con sesión, pero el `resumen` que escribe quien escala puede traer cifras de
// dinero («diferencia de $45,320 en anticipos»). La tarea la lee la persona a la que va dirigida, no cualquiera con
// acceso a la pantalla: una tarea de dinero (destino liquidación/contador, o motivo diferencia_liquidacion /
// duda_fiscal) solo la ve quien tiene el área `dinero`; el resto, quien tiene `operacion`. Un rol desconocido no ve nada.
const DESTINOS_DE_DINERO = new Set(['liquidacion', 'contador']);
const MOTIVOS_DE_DINERO = new Set(['diferencia_liquidacion', 'duda_fiscal']);

export function tareaEsDeDinero(t: { destino: string; motivo: string }): boolean {
  return DESTINOS_DE_DINERO.has(t.destino) || MOTIVOS_DE_DINERO.has(t.motivo);
}

export function rolPuedeLeerTarea(rol: string | undefined, t: { destino: string; motivo: string }): boolean {
  if (!rol) return false;
  return puedeVerArea(rol, tareaEsDeDinero(t) ? 'dinero' : 'operacion');
}
