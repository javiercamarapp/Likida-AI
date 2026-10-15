// ═══════════════════════════════════════════════════════════════════════════
// DESGLOSE DE BITÁCORA — el contrato de INTERCAMBIO interno v1 (T-A1-02).
//
// Es la forma que el conector del sistema de transporte (o el plan B, CSV/JSON) tiene que producir: un encabezado
// (operador, unidad, bitácora, de–a, días) y DOS bloques de renglones (percepciones y deducciones) por descripción +
// valor, con el número de vale en los anticipos. La forma real de la API externa aún no existe (BLOQUEO EXTERNO: su
// documentación); este contrato es el INTERNO y el mapeo de la API lo hace otra tarea.
//
// Likida no recalcula la liquidación. `aLiquidacionExterna` solo convierte al contrato vigente (`esquema.ts`, que NO se
// toca) y lo hace pasar por `validarLiquidacionExterna`, que es la validación estricta que ya existe.
//
// ── EL TOTAL ────────────────────────────────────────────────────────────────
//   · Si la fuente manda `neto`, ESE es el `total` que valida el esquema: la comprobación (Σperc − Σded = neto) es
//     significativa, porque el neto viene de otro cálculo.
//   · Si NO manda `neto`, el total se calcula de los mismos renglones y se devuelve `totalOrigen: 'calculado'`. Ese
//     chequeo es TAUTOLÓGICO (compara la suma consigo misma) y no demuestra que el desglose sea correcto; por eso la UI
//     debe señalarlo en vez de presentarlo como «cuadrado».
// ═══════════════════════════════════════════════════════════════════════════

import { CampoInvalido, texto, fecha, monto } from '@/lib/http/campos_cuerpo';
import { aCentavos, validarLiquidacionExterna, type LiquidacionExternaNormalizada } from './esquema';

export const TIPOS_OPERADOR = ['foraneo', 'local', 'permisionario'] as const;
export type TipoOperadorDesglose = (typeof TIPOS_OPERADOR)[number];

export interface RenglonBitacora {
  concepto: string;
  /** Pesos, siempre > 0: el signo lo da el bloque (percepciones / deducciones). */
  monto: number;
  /** Número de vale (anticipos), sin el asterisco que el capturista antepone. */
  vale?: string;
}

export interface DesgloseBitacora {
  terminal?: string;
  bitacora: string;
  poliza: string | null;
  operador: { numeroEmpleado: string; nombre?: string };
  unidad?: string;
  tipoOperador?: TipoOperadorDesglose;
  /** AAAA-MM-DD, inclusivo. */
  desde: string;
  hasta: string;
  dias?: number;
  percepciones: RenglonBitacora[];
  deducciones: RenglonBitacora[];
  /** Neto que la fuente ya calculó. Si viene, es el total que se valida. */
  neto?: number;
  /** La fuente ya lo marcó como enviado. */
  enviadoOrigen?: boolean;
}

export interface ResultadoConversion {
  liquidacion: LiquidacionExternaNormalizada;
  /** `calculado`: el total salió de los mismos renglones, el chequeo es tautológico. */
  totalOrigen: 'origen' | 'calculado';
  /** Días del encabezado, o hasta−desde+1 (inclusivo) si no venían. */
  dias: number;
}

const MAX_RENGLONES = 100;
const LIMITE_NETO = 1_000_000_000;

function esObjeto(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function soloCampos(obj: Record<string, unknown>, permitidos: readonly string[], donde: string): void {
  const sobran = Object.keys(obj).filter((k) => !permitidos.includes(k));
  if (sobran.length > 0) {
    throw new CampoInvalido(sobran[0], `${donde} trae campos que el contrato no tiene: ${sobran.map((s) => `\`${s}\``).join(', ')}.`);
  }
}

function sinControl(valor: string, campo: string): string {
  if (/[\u0000-\u001f\u007f]/.test(valor)) {
    throw new CampoInvalido(campo, `\`${campo}\` no puede traer saltos de línea ni caracteres de control.`);
  }
  return valor;
}

/** Días inclusivos entre dos fechas AAAA-MM-DD (9 → 14 = 6). */
export function diasDelPeriodo(desde: string, hasta: string): number {
  return (Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000 + 1;
}

/** El vale sin asteriscos ni espacios (`*257008` → `257008`). Vacío tras limpiar = sin vale. */
function limpiarVale(crudo: string, campo: string): string | undefined {
  const v = crudo.replace(/[*\s]/g, '');
  if (v === '') return undefined;
  if (v.length > 40) throw new CampoInvalido(campo, `\`${campo}\` no puede pasar de 40 caracteres.`);
  return v;
}

function validarRenglon(crudo: unknown, bloque: 'percepciones' | 'deducciones', i: number): RenglonBitacora {
  const ruta = `${bloque}[${i}]`;
  if (!esObjeto(crudo)) throw new CampoInvalido(ruta, `\`${ruta}\` tiene que ser un objeto.`);
  soloCampos(crudo, ['concepto', 'monto', 'vale'], `\`${ruta}\``);
  const concepto = texto(crudo, 'concepto', { obligatorio: true, max: 120 });
  if (!concepto) throw new CampoInvalido(`${ruta}.concepto`, `\`${ruta}.concepto\` es obligatorio.`);
  sinControl(concepto, `${ruta}.concepto`);
  // VACÍO ≠ CERO: un renglón sin monto no es un renglón de $0, y un renglón de $0 tampoco es un cargo/abono.
  let m: number | null;
  try {
    m = monto(crudo, 'monto', { min: -LIMITE_NETO, max: LIMITE_NETO });
  } catch (e) {
    if (e instanceof CampoInvalido) throw new CampoInvalido(`${ruta}.monto`, `\`${ruta}.monto\`: ${e.message}`);
    throw e;
  }
  if (m === null) throw new CampoInvalido(`${ruta}.monto`, `\`${ruta}.monto\` es obligatorio.`);
  if (!(m > 0)) {
    throw new CampoInvalido(`${ruta}.monto`, `\`${ruta}.monto\` tiene que ser mayor que cero (la fuente solo manda renglones con valor; el signo lo da el bloque).`);
  }
  const valeCrudo = texto(crudo, 'vale', { max: 60 });
  const vale = valeCrudo === null ? undefined : limpiarVale(sinControl(valeCrudo, `${ruta}.vale`), `${ruta}.vale`);
  return { concepto, monto: Math.round(m * 100) / 100, ...(vale !== undefined ? { vale } : {}) };
}

function validarBloque(crudo: unknown, bloque: 'percepciones' | 'deducciones'): RenglonBitacora[] {
  if (crudo === undefined || crudo === null) return [];
  if (!Array.isArray(crudo)) throw new CampoInvalido(bloque, `\`${bloque}\` tiene que ser una lista de renglones.`);
  if (crudo.length > MAX_RENGLONES) throw new CampoInvalido(bloque, `\`${bloque}\` no puede traer más de ${MAX_RENGLONES} renglones.`);
  return crudo.map((r, i) => validarRenglon(r, bloque, i));
}

const CAMPOS = ['terminal', 'bitacora', 'poliza', 'operador', 'unidad', 'tipoOperador', 'desde', 'hasta', 'dias', 'percepciones', 'deducciones', 'neto', 'enviadoOrigen'] as const;

/** Validador estricto del desglose: campo desconocido, montos ≤ 0, texto con control o fechas mal formadas son error. */
export function validarDesgloseBitacora(crudo: unknown): DesgloseBitacora {
  if (!esObjeto(crudo)) throw new CampoInvalido('desglose', 'El desglose tiene que ser un objeto.');
  soloCampos(crudo, CAMPOS, 'El desglose');

  const terminalT = texto(crudo, 'terminal', { max: 40 });
  const bitacora = texto(crudo, 'bitacora', { obligatorio: true, max: 40 });
  if (!bitacora) throw new CampoInvalido('bitacora', '`bitacora` es obligatoria.');
  sinControl(bitacora, 'bitacora');
  if (terminalT !== null) sinControl(terminalT, 'terminal');
  const polizaT = texto(crudo, 'poliza', { max: 40 });
  if (polizaT !== null) sinControl(polizaT, 'poliza');

  if (!esObjeto(crudo.operador)) throw new CampoInvalido('operador', '`operador` es obligatorio: `{ numeroEmpleado, nombre? }`.');
  soloCampos(crudo.operador, ['numeroEmpleado', 'nombre'], '`operador`');
  const numeroEmpleado = texto(crudo.operador, 'numeroEmpleado', { obligatorio: true, max: 40 });
  if (!numeroEmpleado) throw new CampoInvalido('operador.numeroEmpleado', '`operador.numeroEmpleado` es obligatorio.');
  sinControl(numeroEmpleado, 'operador.numeroEmpleado');
  const nombre = texto(crudo.operador, 'nombre', { max: 120 });
  if (nombre !== null) sinControl(nombre, 'operador.nombre');

  const unidad = texto(crudo, 'unidad', { max: 40 });
  if (unidad !== null) sinControl(unidad, 'unidad');

  let tipoOperador: TipoOperadorDesglose | undefined;
  if (crudo.tipoOperador !== undefined && crudo.tipoOperador !== null) {
    if (typeof crudo.tipoOperador !== 'string' || !(TIPOS_OPERADOR as readonly string[]).includes(crudo.tipoOperador)) {
      throw new CampoInvalido('tipoOperador', `\`tipoOperador\` tiene que ser ${TIPOS_OPERADOR.map((t) => `\`${t}\``).join(', ')}.`);
    }
    tipoOperador = crudo.tipoOperador as TipoOperadorDesglose;
  }

  const desde = fecha(crudo, 'desde');
  const hasta = fecha(crudo, 'hasta');
  if (!desde || !hasta) throw new CampoInvalido('desde', '`desde` y `hasta` son obligatorios (`AAAA-MM-DD`).');

  let dias: number | undefined;
  if (crudo.dias !== undefined && crudo.dias !== null) {
    if (typeof crudo.dias !== 'number' || !Number.isSafeInteger(crudo.dias) || crudo.dias < 1 || crudo.dias > 366) {
      throw new CampoInvalido('dias', '`dias` tiene que ser un entero entre 1 y 366.');
    }
    dias = crudo.dias;
  }

  const percepciones = validarBloque(crudo.percepciones, 'percepciones');
  const deducciones = validarBloque(crudo.deducciones, 'deducciones');
  if (percepciones.length + deducciones.length === 0) {
    throw new CampoInvalido('percepciones', 'El desglose no trae ningún renglón (ni percepciones ni deducciones).');
  }

  let neto: number | undefined;
  if (crudo.neto !== undefined && crudo.neto !== null && !(typeof crudo.neto === 'string' && crudo.neto.trim() === '')) {
    const n = monto(crudo, 'neto', { min: -LIMITE_NETO, max: LIMITE_NETO });
    if (n !== null) neto = n;
  }

  let enviadoOrigen: boolean | undefined;
  if (crudo.enviadoOrigen !== undefined && crudo.enviadoOrigen !== null) {
    if (typeof crudo.enviadoOrigen !== 'boolean') throw new CampoInvalido('enviadoOrigen', '`enviadoOrigen` tiene que ser verdadero o falso.');
    enviadoOrigen = crudo.enviadoOrigen;
  }

  return {
    ...(terminalT !== null ? { terminal: terminalT } : {}),
    bitacora,
    poliza: polizaT,
    operador: { numeroEmpleado, ...(nombre !== null ? { nombre } : {}) },
    ...(unidad !== null ? { unidad } : {}),
    ...(tipoOperador ? { tipoOperador } : {}),
    desde,
    hasta,
    ...(dias !== undefined ? { dias } : {}),
    percepciones,
    deducciones,
    ...(neto !== undefined ? { neto } : {}),
    ...(enviadoOrigen !== undefined ? { enviadoOrigen } : {}),
  };
}

/**
 * La clave de idempotencia `BIT-<terminal>-<bitacora>`, saneada al alfabeto de `claveExterna`. Es DETERMINISTA: la
 * misma entrada da siempre la misma clave (la idempotencia por `claveExterna` depende de eso). Dos entradas que solo
 * difieren en caracteres no válidos pueden colapsar a la misma clave; el esquema las trataría como la misma operación
 * (200) o como contenido distinto (409) según la huella, así que no se corrompe nada en silencio.
 */
export function claveDeBitacora(terminal: string | undefined, bitacora: string): string {
  const base = ['BIT', terminal, bitacora].filter((p): p is string => p !== undefined && p !== '').join('-');
  return base.replace(/[^A-Za-z0-9._:/#-]/g, '_');
}

/** Convierte un desglose al contrato vigente y lo valida con `validarLiquidacionExterna`. */
export function aLiquidacionExterna(d: DesgloseBitacora, opciones: { sistemaOrigen: string }): ResultadoConversion {
  const v = validarDesgloseBitacora(d);
  const concepto = (tipo: 'percepcion' | 'deduccion') => (r: RenglonBitacora) => ({
    ...(r.vale ? { clave: r.vale } : {}),
    descripcion: r.concepto,
    tipo,
    monto: r.monto,
  });
  const sumaCentavos =
    v.percepciones.reduce((a, r) => a + aCentavos(r.monto), 0) - v.deducciones.reduce((a, r) => a + aCentavos(r.monto), 0);
  const totalOrigen = v.neto !== undefined ? 'origen' : 'calculado';
  const total = v.neto !== undefined ? v.neto : sumaCentavos / 100;

  const liquidacion = validarLiquidacionExterna({
    claveExterna: claveDeBitacora(v.terminal, v.bitacora),
    sistemaOrigen: opciones.sistemaOrigen,
    operador: { numeroEmpleado: v.operador.numeroEmpleado },
    viajes: [v.bitacora],
    periodo: { desde: v.desde, hasta: v.hasta },
    conceptos: [...v.percepciones.map(concepto('percepcion')), ...v.deducciones.map(concepto('deduccion'))],
    total,
    moneda: 'MXN',
  });
  return { liquidacion, totalOrigen, dias: v.dias ?? diasDelPeriodo(v.desde, v.hasta) };
}
