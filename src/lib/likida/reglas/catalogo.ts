// ═══════════════════════════════════════════════════════════════════════════
// EL CATÁLOGO CERRADO DE VIGILANCIAS (A19 — reglas en lenguaje natural).
//
// El dueño de la flota escribe "avísame si una unidad sale a viaje sin póliza
// vigente" y Likida lo vigila. La tentación obvia —dejar que un modelo lea la
// frase cada hora y decida si algo la cumple— es exactamente lo que este
// producto no puede hacer: un LLM que "vigila" inventa disparos, se calla los
// que sí importan, y nadie puede auditar por qué avisó. Peor: prometería
// vigilar cosas que los datos no permiten vigilar.
//
// LA ARQUITECTURA HONESTA, entonces:
//
//   1. Este archivo — un catálogo CERRADO de plantillas deterministas. Cada
//      una es una consulta que el sistema SÍ sabe correr con los datos que
//      hoy existen, con parámetros tipados y dominios cerrados.
//   2. El traductor (`traductor.ts`) — el LLM corre UNA VEZ por regla, al
//      crearla, y su único trabajo es MAPEAR la frase a una plantilla de esta
//      lista. Si no calza, contesta "no puedo vigilar eso todavía" y enseña
//      lo que sí. Jamás inventa una vigilancia.
//   3. La confirmación humana — lo que se guarda es la ESTRUCTURA (plantilla
//      + parámetros), nunca el texto libre. La persona ve `frase(params)` en
//      español y confirma antes de que la regla se active. La base lo exige
//      (`regla_activa_confirmada`, 0229), no un `if`.
//   4. El vigilante (`vigilante.ts`) — corre las plantillas, no el modelo.
//
// Este archivo es PURO a propósito: sin Supabase, sin red, sin `process.env`.
// Lo importan la UI, el traductor, el vigilante y las pruebas por igual, y
// una plantilla nueva se agrega aquí Y en `lectores.ts` (hay una prueba que
// falla si divergen).
// ═══════════════════════════════════════════════════════════════════════════
import { z } from 'zod';
import type { ConceptoGasto } from '@/types/likida';
import { mxn, usd } from '@/lib/formato';

/** Las diez vigilancias que el sistema sabe correr hoy. Dominio cerrado:
 *  espeja `regla_plantilla_dominio` de la migración 0229. */
export const PLANTILLAS_ID = [
  'unidad_sin_papel_vigente_al_despachar',
  'gasto_de_concepto_mayor_a',
  'gasto_sin_cfdi_mayor_a',
  'chofer_con_viajes_sin_liquidar',
  'documento_por_vencer',
  'factura_sin_cobrar_mas_de',
  'estadia_mayor_a',
  'incidencia_abierta_mas_de',
  'viaje_abierto_sin_comprobantes_mas_de',
  'costo_ia_dia_mayor_a',
] as const;

export type PlantillaId = (typeof PLANTILLAS_ID)[number];

/** Sobre qué clase de fila cae el disparo. Espeja `regla_disparo_objeto_dominio`. */
export type ObjetoVigilado = 'viaje' | 'gasto' | 'operador' | 'unidad' | 'factura' | 'incidencia' | 'tenant';

/**
 * Por qué canal sale el aviso.
 *
 * El mismo reparto que los relojes legales (`relojes_legales.ts`): lo que es
 * dinero va a quien ve dinero (dueño, contador) y lo que es operación va al
 * jefe de tráfico. Mandar un tope de gasto al encargado es ruido para él y
 * una fuga de cifras para la flota.
 */
export type CanalAviso = 'dinero' | 'operacion';

/** Los papeles con fecha de vencimiento que la flota captura hoy. */
export const DOCUMENTOS_UNIDAD = ['poliza', 'permiso_sict', 'verificacion'] as const;
export const DOCUMENTOS_VIGILABLES = [...DOCUMENTOS_UNIDAD, 'licencia'] as const;
export type DocumentoVigilable = (typeof DOCUMENTOS_VIGILABLES)[number];

/** Cómo se nombra cada papel en el aviso. Mismo texto que `ROTULO_DOC` de
 *  relojes_legales.ts: dos nombres para el mismo papel se leen como dos
 *  papeles. */
export const ROTULO_DOCUMENTO: Record<DocumentoVigilable, string> = {
  poliza: 'póliza',
  permiso_sict: 'permiso SICT',
  verificacion: 'verificación físico-mecánica',
  licencia: 'licencia federal',
};

/** Los conceptos de gasto que el intake sabe clasificar (`ConceptoGasto`). */
export const CONCEPTOS_VIGILABLES: readonly ConceptoGasto[] = [
  'diesel', 'caseta', 'factura', 'alimentacion', 'hospedaje',
  'transporte', 'flete', 'viaticos', 'otro',
];

/** Cómo se lee cada concepto en una frase. */
export const ROTULO_CONCEPTO: Record<ConceptoGasto, string> = {
  diesel: 'diésel',
  caseta: 'casetas',
  factura: 'facturas de taller/refacciones',
  alimentacion: 'alimentación',
  hospedaje: 'hospedaje',
  transporte: 'transporte del operador',
  flete: 'fletes y paquetería',
  viaticos: 'viáticos (concepto heredado)',
  otro: 'otros gastos',
};

// ── Los esquemas de parámetros ─────────────────────────────────────────────
//
// Cada tope tiene un TECHO además de un piso, y no por gusto: un traductor
// que alucine "3000000" en vez de "3000" produciría una regla que no dispara
// nunca y que el dueño creería viva. Un valor fuera de rango es un rechazo
// visible, no una regla muerta en silencio.

/** Tope alto pero finito para montos en pesos. Un gasto de un viaje de carga
 *  no llega a siete cifras; más que eso es un cero de más al teclear. */
const MONTO_MAX = 1_000_000;

const montoMxn = z.number().finite().positive().max(MONTO_MAX);
const dias = z.number().int().positive().max(365);
const horas = z.number().positive().max(24 * 60);

const ESQUEMAS = {
  unidad_sin_papel_vigente_al_despachar: z.object({
    documento: z.enum(DOCUMENTOS_UNIDAD),
  }),
  gasto_de_concepto_mayor_a: z.object({
    concepto: z.enum(CONCEPTOS_VIGILABLES as readonly [ConceptoGasto, ...ConceptoGasto[]]),
    monto: montoMxn,
  }),
  gasto_sin_cfdi_mayor_a: z.object({ monto: montoMxn }),
  chofer_con_viajes_sin_liquidar: z.object({
    n: z.number().int().min(2).max(50),
  }),
  documento_por_vencer: z.object({
    documento: z.enum(DOCUMENTOS_VIGILABLES),
    dias,
  }),
  factura_sin_cobrar_mas_de: z.object({ dias }),
  estadia_mayor_a: z.object({ horas }),
  incidencia_abierta_mas_de: z.object({ horas }),
  viaje_abierto_sin_comprobantes_mas_de: z.object({ dias }),
  costo_ia_dia_mayor_a: z.object({
    usd: z.number().finite().positive().max(10_000),
  }),
} as const satisfies Record<PlantillaId, z.ZodType>;

export type ParamsDe<K extends PlantillaId> = z.infer<(typeof ESQUEMAS)[K]>;
export type ParamsCualquiera = { [K in PlantillaId]: ParamsDe<K> }[PlantillaId];

/** Un parámetro, descrito para que la pantalla lo pueda dibujar sin saber de
 *  qué plantilla es. */
export interface CampoParametro {
  nombre: string;
  etiqueta: string;
  tipo: 'numero' | 'opcion';
  /** Dominio cerrado (tipo 'opcion'): valor → cómo se lee. */
  opciones?: ReadonlyArray<{ valor: string; rotulo: string }>;
  sufijo?: string;
}

export interface Plantilla {
  id: PlantillaId;
  /** El nombre corto, para la lista de "esto es lo que sé vigilar". */
  titulo: string;
  /** Qué mira exactamente, dicho sin marketing — es lo que el traductor lee
   *  para decidir, y lo que la pantalla enseña cuando no hay calce. */
  queVigila: string;
  objeto: ObjetoVigilado;
  canal: CanalAviso;
  /** `true` = solo el superadmin de Likida puede declararla (es un dato de
   *  la plataforma, no de la flota). */
  soloAdmin?: true;
  campos: readonly CampoParametro[];
  /** Frases reales con las que alguien pediría esta vigilancia. Alimentan el
   *  prompt del traductor y los chips de la pantalla. */
  ejemplos: readonly string[];
  /** La interpretación en español que la persona CONFIRMA. Recibe parámetros
   *  ya validados. */
  frase: (params: never) => string;
}

const OPCIONES_DOCUMENTO_UNIDAD = DOCUMENTOS_UNIDAD.map((d) => ({ valor: d, rotulo: ROTULO_DOCUMENTO[d] }));
const OPCIONES_DOCUMENTO = DOCUMENTOS_VIGILABLES.map((d) => ({ valor: d, rotulo: ROTULO_DOCUMENTO[d] }));
const OPCIONES_CONCEPTO = CONCEPTOS_VIGILABLES.map((c) => ({ valor: c, rotulo: ROTULO_CONCEPTO[c] }));

/** Cuántos días es el plazo, dicho sin que "1 días" delate a la máquina. */
function enDias(n: number): string {
  return n === 1 ? '1 día' : `${n} días`;
}

function enHoras(n: number): string {
  const redondo = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return n === 1 ? '1 hora' : `${redondo} horas`;
}

export const CATALOGO: { [K in PlantillaId]: Plantilla & { id: K; frase: (p: ParamsDe<K>) => string } } = {
  // ── 1 ───────────────────────────────────────────────────────────────────
  // La que Javier pidió con nombre propio. Ojo con el `null`: una unidad a la
  // que NADIE le capturó la póliza no está en regla, está sin verificar —
  // `vigencias.ts` lo dice desde julio y aquí se sostiene: sale en el aviso,
  // con el motivo dicho. Callarla sería pintar de verde lo que ni siquiera se
  // midió, que es la mentira que este producto no se puede permitir.
  unidad_sin_papel_vigente_al_despachar: {
    id: 'unidad_sin_papel_vigente_al_despachar',
    titulo: 'Unidad que sale a viaje con un papel vencido o sin capturar',
    queVigila: 'Un viaje abierto o en cuadre cuya unidad tiene el documento vencido a la fecha de inicio del viaje — o sin fecha capturada, que no es lo mismo que estar en regla.',
    objeto: 'viaje',
    canal: 'operacion',
    campos: [{ nombre: 'documento', etiqueta: 'Papel', tipo: 'opcion', opciones: OPCIONES_DOCUMENTO_UNIDAD }],
    ejemplos: [
      'avísame si una unidad sale a viaje sin póliza vigente',
      'no quiero unidades en carretera con la verificación vencida',
      'alértame cuando despachemos con el permiso SICT caducado',
    ],
    frase: (p) => `Voy a avisarte cuando salga un viaje con una unidad cuya ${ROTULO_DOCUMENTO[p.documento]} esté vencida — o sin fecha capturada, que también se avisa.`,
  },

  // ── 2 ───────────────────────────────────────────────────────────────────
  gasto_de_concepto_mayor_a: {
    id: 'gasto_de_concepto_mayor_a',
    titulo: 'Gasto de un concepto por arriba de un monto',
    queVigila: 'Un comprobante capturado cuyo concepto es el elegido y cuyo monto supera el tope.',
    objeto: 'gasto',
    canal: 'dinero',
    campos: [
      { nombre: 'concepto', etiqueta: 'Concepto', tipo: 'opcion', opciones: OPCIONES_CONCEPTO },
      { nombre: 'monto', etiqueta: 'Monto', tipo: 'numero', sufijo: 'MXN' },
    ],
    ejemplos: [
      'avísame si un gasto de caseta pasa de $3,000',
      'quiero saber cuando una carga de diésel rebase 15 mil pesos',
      'alerta si una comida del chofer sale en más de 800',
    ],
    frase: (p) => `Voy a avisarte cuando entre un comprobante de ${ROTULO_CONCEPTO[p.concepto]} por más de ${mxn(p.monto)}.`,
  },

  // ── 3 ───────────────────────────────────────────────────────────────────
  gasto_sin_cfdi_mayor_a: {
    id: 'gasto_sin_cfdi_mayor_a',
    titulo: 'Gasto grande sin CFDI',
    queVigila: 'Un comprobante sin UUID de CFDI capturado por arriba del monto — el que no se va a poder deducir.',
    objeto: 'gasto',
    canal: 'dinero',
    campos: [{ nombre: 'monto', etiqueta: 'Monto', tipo: 'numero', sufijo: 'MXN' }],
    ejemplos: [
      'avísame de cualquier gasto sin factura arriba de 2,000 pesos',
      'quiero enterarme si comprueban más de mil pesos sin CFDI',
    ],
    frase: (p) => `Voy a avisarte cuando entre un comprobante SIN CFDI por más de ${mxn(p.monto)} — ese no se deduce.`,
  },

  // ── 4 ───────────────────────────────────────────────────────────────────
  // El sello lleva el conteo (ver `clave` en lectores.ts): 2 viajes sin
  // liquidar avisa una vez, y si sube a 3 vuelve a avisar. Sellar solo por
  // chofer haría que el problema creciera en silencio después del primer
  // aviso.
  chofer_con_viajes_sin_liquidar: {
    id: 'chofer_con_viajes_sin_liquidar',
    titulo: 'Chofer que acumula viajes sin liquidar',
    queVigila: 'Un operador con N o más viajes en estatus abierto o en cuadre al mismo tiempo.',
    objeto: 'operador',
    canal: 'dinero',
    campos: [{ nombre: 'n', etiqueta: 'Viajes sin liquidar', tipo: 'numero', sufijo: 'viajes' }],
    ejemplos: [
      'avísame si un chofer lleva 2 viajes sin liquidar',
      'alerta cuando un operador junte 3 viajes sin cerrar',
    ],
    frase: (p) => `Voy a avisarte cuando un chofer acumule ${p.n} o más viajes sin liquidar.`,
  },

  // ── 5 ───────────────────────────────────────────────────────────────────
  // Convive a propósito con el barrido de `relojes_legales.ts`, que avisa en
  // 30/7/0 días fijos para TODA flota. Esta plantilla es la ventana que el
  // dueño eligió (45, 60, lo que él sepa que tarda su aseguradora). Son dos
  // avisos distintos y cada uno tiene su propio sello: el de la ley no se
  // apaga porque alguien declare el suyo.
  documento_por_vencer: {
    id: 'documento_por_vencer',
    titulo: 'Papel por vencer con tu propia anticipación',
    queVigila: 'Un papel de unidad u operador que vence dentro de los próximos N días, con la ventana que tú elijas.',
    objeto: 'unidad',
    canal: 'operacion',
    campos: [
      { nombre: 'documento', etiqueta: 'Papel', tipo: 'opcion', opciones: OPCIONES_DOCUMENTO },
      { nombre: 'dias', etiqueta: 'Anticipación', tipo: 'numero', sufijo: 'días' },
    ],
    ejemplos: [
      'avísame 45 días antes de que venza una póliza',
      'quiero saber con dos meses de anticipación si se vence una licencia',
      'alerta 60 días antes del vencimiento de la verificación',
    ],
    frase: (p) => `Voy a avisarte cuando una ${ROTULO_DOCUMENTO[p.documento]} esté a ${enDias(p.dias)} o menos de vencer.`,
  },

  // ── 6 ───────────────────────────────────────────────────────────────────
  factura_sin_cobrar_mas_de: {
    id: 'factura_sin_cobrar_mas_de',
    titulo: 'Factura emitida que lleva mucho sin cobrarse',
    queVigila: 'Una factura en estatus "emitida" (ni pagada ni cancelada) con fecha anterior a hoy menos N días.',
    objeto: 'factura',
    canal: 'dinero',
    campos: [{ nombre: 'dias', etiqueta: 'Días sin cobrar', tipo: 'numero', sufijo: 'días' }],
    ejemplos: [
      'avísame si una factura lleva más de 30 días sin cobrarse',
      'alerta cuando un cliente se pase de 45 días de crédito',
    ],
    frase: (p) => `Voy a avisarte cuando una factura emitida cumpla ${enDias(p.dias)} sin cobrarse.`,
  },

  // ── 7 ───────────────────────────────────────────────────────────────────
  // La estadía se calcula al leer, con los hitos del chofer (0207 decidió NO
  // persistir episodios). Sin `llegada_en` no hay reloj que correr: la regla
  // no dispara y no finge un cero.
  estadia_mayor_a: {
    id: 'estadia_mayor_a',
    titulo: 'Unidad detenida en el cliente más de N horas',
    queVigila: 'Un viaje con hito de llegada sellado que lleva más de N horas sin hito de descarga (o cuya descarga tardó más que eso).',
    objeto: 'viaje',
    canal: 'operacion',
    campos: [{ nombre: 'horas', etiqueta: 'Horas', tipo: 'numero', sufijo: 'horas' }],
    ejemplos: [
      'avísame si una unidad lleva más de 4 horas esperando en el cliente',
      'alerta de estadías arriba de 6 horas',
    ],
    frase: (p) => `Voy a avisarte cuando una unidad acumule más de ${enHoras(p.horas)} desde que llegó al cliente sin que se selle la descarga.`,
  },

  // ── 8 ───────────────────────────────────────────────────────────────────
  incidencia_abierta_mas_de: {
    id: 'incidencia_abierta_mas_de',
    titulo: 'Incidencia que nadie cierra',
    queVigila: 'Una incidencia abierta o en proceso que lleva más de N horas sin resolverse.',
    objeto: 'incidencia',
    canal: 'operacion',
    campos: [{ nombre: 'horas', etiqueta: 'Horas', tipo: 'numero', sufijo: 'horas' }],
    ejemplos: [
      'avísame si una incidencia lleva más de 12 horas abierta',
      'alerta cuando un reporte de avería pase de un día sin resolver',
    ],
    frase: (p) => `Voy a avisarte cuando una incidencia cumpla ${enHoras(p.horas)} sin resolverse.`,
  },

  // ── 9 ───────────────────────────────────────────────────────────────────
  viaje_abierto_sin_comprobantes_mas_de: {
    id: 'viaje_abierto_sin_comprobantes_mas_de',
    titulo: 'Viaje viejo y abierto sin un solo comprobante',
    queVigila: 'Un viaje en estatus abierto que arrancó hace más de N días y no tiene ningún gasto capturado.',
    objeto: 'viaje',
    canal: 'dinero',
    campos: [{ nombre: 'dias', etiqueta: 'Días', tipo: 'numero', sufijo: 'días' }],
    ejemplos: [
      'avísame si un viaje lleva 5 días abierto sin comprobantes',
      'alerta de viajes con más de una semana y cero tickets',
    ],
    frase: (p) => `Voy a avisarte cuando un viaje cumpla ${enDias(p.dias)} abierto sin un solo comprobante capturado.`,
  },

  // ── 10 ──────────────────────────────────────────────────────────────────
  // La única de la plataforma, no de la flota: el gasto de modelo es de
  // Likida. Se declara `soloAdmin` para que la pantalla del cliente ni
  // siquiera la ofrezca — enseñarle a un dueño de flota una vigilancia que no
  // puede crear es prometerle algo que no le toca.
  costo_ia_dia_mayor_a: {
    id: 'costo_ia_dia_mayor_a',
    titulo: 'Costo de IA del día por arriba de un techo (solo Likida)',
    queVigila: 'La suma de `llm_costo` del día de México para la flota supera el techo en USD.',
    objeto: 'tenant',
    canal: 'dinero',
    soloAdmin: true,
    campos: [{ nombre: 'usd', etiqueta: 'Techo del día', tipo: 'numero', sufijo: 'USD' }],
    ejemplos: [
      'avísame si el costo de IA del día pasa de 5 dólares',
      'alerta cuando el gasto de modelo de una flota rebase 2 USD en un día',
    ],
    frase: (p) => `Voy a avisarte cuando el costo de IA del día rebase ${usd(p.usd)}.`,
  },
};

/** El catálogo como lista, en el orden en que se enseña. */
export const PLANTILLAS: readonly Plantilla[] = PLANTILLAS_ID.map((id) => CATALOGO[id]);

/** Las que un rol de la flota puede declarar. `soloAdmin` no aparece. */
export function plantillasPara(rol: string): readonly Plantilla[] {
  return PLANTILLAS.filter((p) => !p.soloAdmin || rol === 'superadmin');
}

export function esPlantilla(id: unknown): id is PlantillaId {
  return typeof id === 'string' && (PLANTILLAS_ID as readonly string[]).includes(id);
}

/** Lo que devuelve validar unos parámetros crudos contra su plantilla.
 *  ERROR POR VALOR: quien valida decide qué hacer, no un throw que alguien
 *  olvide atrapar. */
export type Validacion =
  | { ok: true; params: ParamsCualquiera }
  | { ok: false; error: string };

/**
 * Valida los parámetros de una plantilla. Es la ÚNICA puerta: la usa el
 * traductor con lo que devolvió el modelo, la usa la pantalla con lo que
 * tecleó la persona, y la usa el vigilante antes de correr una regla vieja
 * (una plantilla puede cambiar de dominio y la fila guardada no se entera).
 */
export function validarParams(plantilla: PlantillaId, crudo: unknown): Validacion {
  const r = ESQUEMAS[plantilla].safeParse(crudo);
  if (r.success) return { ok: true, params: r.data as ParamsCualquiera };
  const primero = r.error.issues[0];
  const campo = primero?.path?.join('.') || 'parámetro';
  return { ok: false, error: `El parámetro «${campo}» no sirve para esta vigilancia: ${primero?.message ?? 'valor inválido'}.` };
}

/** La interpretación en español de una regla ya validada. */
export function fraseDe(plantilla: PlantillaId, params: ParamsCualquiera): string {
  const p = CATALOGO[plantilla] as Plantilla;
  return (p.frase as (x: unknown) => string)(params);
}

/**
 * La lista que se le enseña a alguien cuando su frase NO calza con nada.
 *
 * Es la mitad honesta del "no puedo vigilar eso todavía": una negativa a secas
 * deja a la persona adivinando. Aquí se dice exactamente qué sí.
 */
export function loQueSiSeVigila(rol: string): string[] {
  return plantillasPara(rol).map((p) => `${p.titulo} — p. ej. «${p.ejemplos[0]}»`);
}
