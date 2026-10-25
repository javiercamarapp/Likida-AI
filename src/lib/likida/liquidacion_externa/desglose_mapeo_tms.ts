// ═══════════════════════════════════════════════════════════════════════════
// MAPEO DECLARATIVO TMS → DesgloseBitacora (T-A1-25).
//
// La documentación de la API del sistema de transporte AÚN NO EXISTE (BLOQUEO EXTERNO: 3 tablas, columna `desglose`,
// campo de enviado, usuario de servicio, ambiente de prueba, límites). Este módulo no adivina nombres de campo: recibe
// un `mapeo` declarativo (rutas JSON por campo) y produce el `DesgloseBitacora` interno de `desglose_contrato.ts`.
// Cuando llegue la documentación solo cambia el objeto `mapeo`, no el código.
//
// Todo lo que es una suposición sobre la forma de la API va marcado `SUPUESTO-API` para verificarlo contra la
// documentación real. Sin HTTP, sin credenciales, sin catálogo propio: el cliente manda «la descripción del concepto».
//
// Dos formas de entrada:
//   · `nodos`: la API expone `percepciones[]` y `deducciones[]` ya separados (lo que se dijo que expondría).
//   · `plana`: una sola lista de renglones con cargo/abono: cargo>0 ⇒ percepción, abono>0 ⇒ deducción.
// ═══════════════════════════════════════════════════════════════════════════

import { CampoInvalido } from '@/lib/http/campos_cuerpo';
import { fechaLocalMX } from '../peajes/plazo_reclamo';
import { TIPOS_OPERADOR, validarDesgloseBitacora, type DesgloseBitacora, type RenglonBitacora, type TipoOperadorDesglose } from './desglose_contrato';

/** Ruta con puntos y índices: `datos.bitacora.id`, `renglones[0].monto`. */
export type RutaJson = string;

/** Dónde vive cada campo de un renglón (relativa al renglón). */
export interface MapeoRenglon {
  /** SUPUESTO-API: columna nueva `desglose` con el nombre que RH quiere ver. */
  desglose?: RutaJson;
  /** Descripción del concepto: respaldo cuando `desglose` viene vacío. */
  descripcion: RutaJson;
  /** Número de vale (anticipos). */
  vale?: RutaJson;
  /** Forma `nodos`: el monto del renglón. */
  monto?: RutaJson;
  /** Forma `plana`: cargo (percepción) y abono (deducción). */
  cargo?: RutaJson;
  abono?: RutaJson;
  /** SUPUESTO-API: tipo de `TBL Concepto Nómina`; `V`/`UV` marca viáticos. */
  tipoConcepto?: RutaJson;
  /** SUPUESTO-API: detalle de viáticos anidado en el renglón (lista de `{descripcion, monto}`). */
  detalleViaticos?: RutaJson;
}

export interface MapeoTms {
  bitacora: RutaJson;
  /** Póliza; ausente o vacía = `null` (todavía no hay póliza). */
  poliza?: RutaJson;
  terminal?: RutaJson;
  operadorNumero: RutaJson;
  operadorNombre?: RutaJson;
  unidad?: RutaJson;
  tipoOperador?: RutaJson;
  desde: RutaJson;
  hasta: RutaJson;
  dias?: RutaJson;
  neto?: RutaJson;
  /** SUPUESTO-API: campo «enviado» que el TMS ofrecerá. */
  enviado?: RutaJson;
  /** Forma `nodos`. */
  percepciones?: RutaJson;
  deducciones?: RutaJson;
  /** Forma `plana`. */
  renglones?: RutaJson;
  renglon: MapeoRenglon;
  /** Valores de `tipoConcepto` que significan viáticos. Por defecto `V` y `UV`. */
  tiposViatico?: string[];
}

export interface RenglonIgnorado {
  /** `percepciones[2]`, `renglones[0]`… */
  donde: string;
  motivo: string;
}

export interface ResultadoMapeoTms {
  desglose: DesgloseBitacora;
  ignorados: RenglonIgnorado[];
}

const TIPOS_VIATICO_DEFECTO = ['V', 'UV'];

/** Lee una ruta `a.b[0].c`. `undefined` si algo del camino falta. */
export function leerRuta(raiz: unknown, ruta: RutaJson): unknown {
  const pasos = ruta.split('.').flatMap((p) => {
    // eslint-disable-next-line security/detect-unsafe-regex -- patrón anclado de formato fijo, sin cuantificadores anidados ni retroceso exponencial; la entrada es un valor corto de una celda o campo
    const m = /^([^[\]]*)((?:\[\d+\])*)$/.exec(p);
    if (!m) return [p];
    const idx = [...m[2].matchAll(/\[(\d+)\]/g)].map((x) => Number(x[1]));
    return [...(m[1] === '' ? [] : [m[1]]), ...idx];
  });
  let actual: unknown = raiz;
  for (const p of pasos) {
    if (actual === null || actual === undefined || typeof actual !== 'object') return undefined;
    actual = (actual as Record<string | number, unknown>)[p];
  }
  return actual;
}

function textoOpt(v: unknown, campo: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string' && typeof v !== 'number') throw new CampoInvalido(campo, `\`${campo}\` tiene que ser texto.`);
  const t = String(v).trim();
  return t === '' ? undefined : t;
}

/**
 * Monto del TMS: número, o texto numérico con PUNTO decimal. Una coma decimal o texto no numérico es error con el
 * nombre del campo (no se adivina: «1,5» puede ser 1.50 o 1500). Vacío/ausente/0 = sin valor (0).
 */
function montoTms(v: unknown, campo: string): number {
  if (v === undefined || v === null) return 0;
  let n: number;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return 0;
    // eslint-disable-next-line security/detect-unsafe-regex -- patrón anclado de formato fijo, sin cuantificadores anidados ni retroceso exponencial; la entrada es un valor corto de una celda o campo
    if (!/^-?\d+(\.\d+)?$/.test(t)) throw new CampoInvalido(campo, `\`${campo}\` no es un número válido (se espera punto decimal, sin separador de millares).`);
    n = Number(t);
  } else throw new CampoInvalido(campo, `\`${campo}\` tiene que ser un número.`);
  if (!Number.isFinite(n)) throw new CampoInvalido(campo, `\`${campo}\` tiene que ser un número.`);
  if (n < 0) throw new CampoInvalido(campo, `\`${campo}\` no puede ser negativo (cargo/abono ya dan el signo).`);
  // A37-A1-liquidaciones-14: más de 2 decimales no se redondean en silencio (el neto sería la suma de redondeos por renglón):
  // se rechaza con el campo y la bitácora queda en `mapeo_invalido`, visible. La tolerancia absorbe el ruido de coma flotante.
  const cent = n * 100;
  if (Math.abs(cent - Math.round(cent)) > 1e-6 * Math.max(1, Math.abs(cent))) {
    throw new CampoInvalido(campo, `\`${campo}\` trae más de 2 decimales; no se redondea en silencio: corrígelo en el origen.`);
  }
  return n;
}

/** La unidad sin ceros a la izquierda (`0526` → `526`); solo si es numérica. */
export function normalizarUnidad(crudo: string): string {
  return /^\d+$/.test(crudo) ? String(Number(crudo)) : crudo;
}

function fechaIso(v: unknown, campo: string): string | undefined {
  const t = textoOpt(v, campo);
  if (t === undefined) return undefined;
  // SUPUESTO-API: la fecha puede venir como AAAA-MM-DD o con hora. A37-A1-liquidaciones-16: un instante CON zona (`Z`/`±hh:mm`)
  // se pasa al día local de México (15T05:59Z es el 14 en CDMX); sin zona o solo fecha, el día tal como viene.
  // eslint-disable-next-line security/detect-unsafe-regex -- patrón anclado de formato fijo, sin cuantificadores anidados ni retroceso exponencial; la entrada es un valor corto de una celda o campo
  if (!/^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/.test(t)) throw new CampoInvalido(campo, `\`${campo}\` tiene que ser una fecha AAAA-MM-DD.`);
  try {
    return fechaLocalMX(t);
  } catch {
    // Hora ilegible tras la fecha (p. ej. «T25:99»): se conserva el día escrito, como antes.
    return t.slice(0, 10);
  }
}

function listaEn(raw: unknown, ruta: RutaJson | undefined, campo: string): unknown[] {
  if (ruta === undefined) return [];
  const v = leerRuta(raw, ruta);
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new CampoInvalido(campo, `\`${campo}\` (${ruta}) tiene que ser una lista.`);
  return v;
}

function conceptoDe(nodo: unknown, m: MapeoRenglon, donde: string): string {
  const d = m.desglose ? textoOpt(leerRuta(nodo, m.desglose), `${donde}.desglose`) : undefined;
  const base = d ?? textoOpt(leerRuta(nodo, m.descripcion), `${donde}.descripcion`);
  if (base === undefined) throw new CampoInvalido(`${donde}.descripcion`, `\`${donde}\` no trae ni \`desglose\` ni descripción del concepto.`);
  return base;
}

const esViatico = (s: string) => /vi[aá]tic/i.test(s);

interface Candidato { tipo: 'percepcion' | 'deduccion'; renglon: RenglonBitacora }

/** Un renglón crudo ya con su monto y lado resueltos; viáticos se expanden a su descripción específica. */
function procesarRenglon(
  nodo: unknown, m: MapeoRenglon, donde: string, lado: 'percepcion' | 'deduccion' | 'segunCargoAbono',
  tiposViatico: string[], ignorados: RenglonIgnorado[],
): Candidato[] {
  let tipo: 'percepcion' | 'deduccion';
  let montoNum: number;
  if (lado === 'segunCargoAbono') {
    const cargo = m.cargo ? montoTms(leerRuta(nodo, m.cargo), `${donde}.cargo`) : 0;
    const abono = m.abono ? montoTms(leerRuta(nodo, m.abono), `${donde}.abono`) : 0;
    if (cargo > 0 && abono > 0) throw new CampoInvalido(donde, `\`${donde}\` trae cargo y abono a la vez; no se sabe si es percepción o deducción.`);
    if (cargo === 0 && abono === 0) { ignorados.push({ donde, motivo: 'cargo y abono en cero' }); return []; }
    tipo = cargo > 0 ? 'percepcion' : 'deduccion';
    montoNum = cargo > 0 ? cargo : abono;
  } else {
    tipo = lado;
    montoNum = m.monto ? montoTms(leerRuta(nodo, m.monto), `${donde}.monto`) : 0;
    if (montoNum === 0) { ignorados.push({ donde, motivo: 'monto en cero o vacío' }); return []; }
  }

  const concepto = conceptoDe(nodo, m, donde);
  const vale = m.vale ? textoOpt(leerRuta(nodo, m.vale), `${donde}.vale`) : undefined;
  const tipoC = m.tipoConcepto ? textoOpt(leerRuta(nodo, m.tipoConcepto), `${donde}.tipoConcepto`) : undefined;

  // Viáticos: nunca la palabra «viático»; el cliente quiere la descripción específica (taxi, talacha, lavada…).
  if (tipo === 'percepcion' && m.detalleViaticos && (esViatico(concepto) || (tipoC !== undefined && tiposViatico.includes(tipoC.toUpperCase())))) {
    const det = listaEn(nodo, m.detalleViaticos, `${donde}.detalleViaticos`);
    if (det.length > 0) {
      const sub: Candidato[] = [];
      let sumaDetalleCentavos = 0;
      det.forEach((d, i) => {
        const dd = `${donde}.detalleViaticos[${i}]`;
        const mm = montoTms(leerRuta(d, m.monto ?? 'monto'), `${dd}.monto`);
        sumaDetalleCentavos += Math.round(mm * 100);
        if (mm === 0) { ignorados.push({ donde: dd, motivo: 'monto en cero o vacío' }); return; }
        const desc = textoOpt(leerRuta(d, m.descripcion), `${dd}.descripcion`);
        if (desc === undefined) throw new CampoInvalido(`${dd}.descripcion`, `\`${dd}\` no trae descripción del concepto.`);
        sub.push({ tipo: 'percepcion', renglon: { concepto: desc, monto: Math.round(mm * 100) / 100 } });
      });
      // A37-S48-07: el detalle SUSTITUYE al renglón padre solo si lo concilia al centavo. Si no suma lo mismo (falta un
      // renglón, uno en cero se ignora), se conserva el monto del padre —lo que el TMS dijo que pagó— y la diferencia
      // queda anotada: perder dinero del operador en silencio es peor que perder el desglose fino.
      if (sumaDetalleCentavos === Math.round(montoNum * 100)) return sub;
      ignorados.push({
        donde: `${donde}.detalleViaticos`,
        motivo: `el detalle suma ${(sumaDetalleCentavos / 100).toFixed(2)} y el renglón ${montoNum.toFixed(2)}: no concilia, se conservó el monto del renglón`,
      });
    }
  }
  // Renglón tipo V/UV: su descripción específica manda sobre `desglose` si este solo dice «viáticos».
  let conceptoFinal = concepto;
  if (tipoC !== undefined && tiposViatico.includes(tipoC.toUpperCase()) && esViatico(concepto)) {
    const especifica = textoOpt(leerRuta(nodo, m.descripcion), `${donde}.descripcion`);
    if (especifica !== undefined && !esViatico(especifica)) conceptoFinal = especifica;
  }
  return [{ tipo, renglon: { concepto: conceptoFinal, monto: Math.round(montoNum * 100) / 100, ...(vale !== undefined ? { vale } : {}) } }];
}

/**
 * Convierte una bitácora cruda del TMS en `DesgloseBitacora` con un `mapeo` declarativo. Lanza `CampoInvalido` (con
 * el campo) si algo no cuadra; los renglones sin valor se devuelven en `ignorados` con su motivo.
 */
export function mapearBitacoraTms(raw: unknown, mapeo: MapeoTms): ResultadoMapeoTms {
  const ignorados: RenglonIgnorado[] = [];
  const tiposViatico = (mapeo.tiposViatico ?? TIPOS_VIATICO_DEFECTO).map((t) => t.toUpperCase());

  const bitacora = textoOpt(leerRuta(raw, mapeo.bitacora), 'bitacora');
  const operadorNumero = textoOpt(leerRuta(raw, mapeo.operadorNumero), 'operador.numeroEmpleado');
  const poliza = mapeo.poliza ? textoOpt(leerRuta(raw, mapeo.poliza), 'poliza') : undefined;
  const terminal = mapeo.terminal ? textoOpt(leerRuta(raw, mapeo.terminal), 'terminal') : undefined;
  const nombre = mapeo.operadorNombre ? textoOpt(leerRuta(raw, mapeo.operadorNombre), 'operador.nombre') : undefined;
  const unidadCruda = mapeo.unidad ? textoOpt(leerRuta(raw, mapeo.unidad), 'unidad') : undefined;
  const desde = fechaIso(leerRuta(raw, mapeo.desde), 'desde');
  const hasta = fechaIso(leerRuta(raw, mapeo.hasta), 'hasta');

  let tipoOperador: TipoOperadorDesglose | undefined;
  const tipoCrudo = mapeo.tipoOperador ? textoOpt(leerRuta(raw, mapeo.tipoOperador), 'tipoOperador') : undefined;
  if (tipoCrudo !== undefined) {
    const t = tipoCrudo.toLowerCase();
    if (!(TIPOS_OPERADOR as readonly string[]).includes(t)) {
      throw new CampoInvalido('tipoOperador', `\`tipoOperador\` tiene que ser ${TIPOS_OPERADOR.map((x) => `\`${x}\``).join(', ')}.`);
    }
    tipoOperador = t as TipoOperadorDesglose;
  }

  let dias: number | undefined;
  if (mapeo.dias) {
    const d = leerRuta(raw, mapeo.dias);
    if (d !== undefined && d !== null && !(typeof d === 'string' && d.trim() === '')) {
      const n = typeof d === 'string' ? Number(d.trim()) : d;
      if (typeof n !== 'number' || !Number.isSafeInteger(n)) throw new CampoInvalido('dias', '`dias` tiene que ser un entero.');
      dias = n;
    }
  }

  let neto: number | undefined;
  if (mapeo.neto) {
    const v = leerRuta(raw, mapeo.neto);
    if (v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '')) {
      // El neto sí puede ser negativo (retenido por neto negativo): se lee aparte de los montos de renglón.
      if (typeof v === 'number') neto = v;
      // eslint-disable-next-line security/detect-unsafe-regex -- patrón anclado de formato fijo, sin cuantificadores anidados ni retroceso exponencial; la entrada es un valor corto de una celda o campo
      else if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) neto = Number(v.trim());
      else throw new CampoInvalido('neto', '`neto` no es un número válido (se espera punto decimal).');
    }
  }

  let enviadoOrigen: boolean | undefined;
  if (mapeo.enviado) {
    const v = leerRuta(raw, mapeo.enviado);
    if (v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '')) {
      if (typeof v === 'boolean') enviadoOrigen = v;
      else if (v === 1 || v === '1') enviadoOrigen = true;
      else if (v === 0 || v === '0') enviadoOrigen = false;
      else throw new CampoInvalido('enviadoOrigen', '`enviadoOrigen` tiene que ser verdadero o falso.');
    }
  }

  const candidatos: Candidato[] = [];
  if (mapeo.renglones !== undefined) {
    listaEn(raw, mapeo.renglones, 'renglones').forEach((n, i) => {
      candidatos.push(...procesarRenglon(n, mapeo.renglon, `renglones[${i}]`, 'segunCargoAbono', tiposViatico, ignorados));
    });
  } else {
    listaEn(raw, mapeo.percepciones, 'percepciones').forEach((n, i) => {
      candidatos.push(...procesarRenglon(n, mapeo.renglon, `percepciones[${i}]`, 'percepcion', tiposViatico, ignorados));
    });
    listaEn(raw, mapeo.deducciones, 'deducciones').forEach((n, i) => {
      candidatos.push(...procesarRenglon(n, mapeo.renglon, `deducciones[${i}]`, 'deduccion', tiposViatico, ignorados));
    });
  }

  const armado = {
    ...(terminal !== undefined ? { terminal } : {}),
    bitacora: bitacora ?? '',
    poliza: poliza ?? null,
    operador: { numeroEmpleado: operadorNumero ?? '', ...(nombre !== undefined ? { nombre } : {}) },
    ...(unidadCruda !== undefined ? { unidad: normalizarUnidad(unidadCruda) } : {}),
    ...(tipoOperador ? { tipoOperador } : {}),
    desde: desde ?? '',
    hasta: hasta ?? '',
    ...(dias !== undefined ? { dias } : {}),
    percepciones: candidatos.filter((c) => c.tipo === 'percepcion').map((c) => c.renglon),
    deducciones: candidatos.filter((c) => c.tipo === 'deduccion').map((c) => c.renglon),
    ...(neto !== undefined ? { neto } : {}),
    ...(enviadoOrigen !== undefined ? { enviadoOrigen } : {}),
  };
  // Validación estricta del contrato interno: lo que el mapeo no logre dejar en forma falla aquí, con su campo.
  return { desglose: validarDesgloseBitacora(armado), ignorados };
}
