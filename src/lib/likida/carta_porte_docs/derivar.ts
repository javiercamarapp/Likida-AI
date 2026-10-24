// ═══════════════════════════════════════════════════════════════════════════
// DERIVADOS — lo que se calcula de lo que el documento SÍ dice.
//
// Idempotente: se puede correr tras la extracción y tras cada corrección humana
// sin acumular efectos. Nunca pisa un valor que un humano dejó (`origen: humano`)
// y nunca inventa: solo convierte unidades y suma renglones.
// ═══════════════════════════════════════════════════════════════════════════

import { campoDoc, campoMercancia, type CampoValor, type Extraccion, type Origen } from './campos';
import { FACTOR_A_KG, claveUnidadDeTexto } from './catalogos';
import { PEDIMENTO_PARCIAL, limpiarTexto, normalizarNumero, normalizarValor, type OrdenFecha } from './normalizar';
import { tipoOperacion } from './validacion';

const num = (c: CampoValor | undefined): number | null => (c?.valor != null ? normalizarNumero(c.valor).valor : null);
/** Nota fija (y por eso idempotente) cuando solo hay peso neto o «peso por embalaje» y se usa como bruto. */
export const NOTA_NETO_COMO_BRUTO = 'El documento solo da el peso neto (o «peso por embalaje»): se usó como peso bruto por defecto. Pendiente de confirmar con el cliente.';
const redondea = (n: number): string => String(Math.round(n * 1000) / 1000);

/** Lo que el llamador sabe de FUERA del documento (T-A3-46). Sin él, los derivados de aduana no actúan. */
export interface ContextoDerivar {
  /** Nombre del archivo recibido: `CCP <transportista>-<cliente final> <IMPO|EXPO> <caja> <dd-mm-aa>`. */
  nombreArchivo?: string | null;
  /** Año (2 dígitos) y aduana (2 dígitos) del perfil, para completar un pedimento `patente-consecutivo`. */
  pedimentoPerfil?: { anio: string; aduana: string } | null;
}

/** IMPO/EXPO y caja del nombre del archivo. Solo pistas: el nombre lo pone una persona y trae versiones `(1)` y mojibake. */
export function metadatosNombreArchivo(nombre: string | null | undefined): { operacion: 'importacion' | 'exportacion' | null; caja: string | null } {
  const limpio = (nombre ?? '').replace(/[ÂÃ]/g, ' ').replace(/\.[A-Za-z0-9]{2,4}$/, '');
  const m = /(?:^|[^A-Za-z])(IMPO|EXPO)(?![A-Za-z])[\s_]+([A-Za-z0-9][A-Za-z0-9-]{0,14})?/i.exec(limpio);
  if (!m) return { operacion: null, caja: null };
  const caja = m[2] && !/^\d{1,2}-\d{1,2}-\d{2,4}$/.test(m[2]) ? m[2].toUpperCase() : null;
  return { operacion: m[1].toUpperCase() === 'IMPO' ? 'importacion' : 'exportacion', caja };
}

const REGIMEN_DE_OPERACION = { importacion: 'IMD', exportacion: 'EXD' } as const;
const NOTA_REGIMEN_DE_NOMBRE = 'Se dedujo del nombre del archivo';
/** A37-S31-06 · Nota fija (idempotente) cuando el nombre sugiere exportación pero el documento trae pedimento / RFC del importador. */
export const NOTA_CONFLICTO_NOMBRE_EXPO = 'El documento trae pedimento o RFC del importador, pero el régimen salió solo del nombre del archivo (EXPO): confirma si es importación o exportación. No se omitió ningún dato.';

/** ¿El régimen de las mercancías es solo una pista del nombre del archivo (no lo dice el documento)? */
function regimenSoloDeNombre(e: Extraccion): boolean {
  if (e.campos.regimen_aduanero?.valor) return false;
  const filas = e.mercancias.filter((f) => f.regimen_aduanero?.valor);
  return filas.length > 0 && filas.every((f) => f.regimen_aduanero.origen === 'derivado' && (f.regimen_aduanero.notas ?? []).some((n) => n.startsWith(NOTA_REGIMEN_DE_NOMBRE)));
}

/** Régimen, pedimento y caja a partir del contexto. Nunca pisa lo que un humano dejó ni inventa un pedimento. */
function derivarAduana(e: Extraccion, ctx: ContextoDerivar): void {
  const meta = metadatosNombreArchivo(ctx.nombreArchivo);
  // Régimen: si el documento lo trae en algún renglón, vale para todos; si no, la pista del nombre del archivo.
  const dado = e.campos.regimen_aduanero ?? e.mercancias.map((f) => f.regimen_aduanero).find((c) => c?.valor);
  if (e.mercancias.length > 0) {
    const base: CampoValor | null = dado?.valor
      ? dado
      : meta.operacion
        ? { valor: REGIMEN_DE_OPERACION[meta.operacion], confianza: 0.6, evidencia: meta.operacion === 'importacion' ? 'IMPO' : 'EXPO', origen: 'derivado', notas: [`${NOTA_REGIMEN_DE_NOMBRE} (${meta.operacion === 'importacion' ? 'IMPO' : 'EXPO'}): confirma el régimen.`] }
        : null;
    if (base) for (const fila of e.mercancias) if (!fila.regimen_aduanero?.valor) fila.regimen_aduanero = { ...base };
  }
  // Caja: solo como pista del nombre del archivo cuando el documento no la trae.
  if (!e.campos.caja_numero?.valor && meta.caja) {
    e.campos.caja_numero = { valor: meta.caja, confianza: 0.6, evidencia: null, origen: 'derivado', notas: ['La caja salió del nombre del archivo: confírmala contra el documento.'] };
  }
  const op = tipoOperacion(e);
  const deNombre = regimenSoloDeNombre(e);
  const perfil = ctx.pedimentoPerfil && /^\d{2}$/.test(ctx.pedimentoPerfil.anio) && /^\d{2}$/.test(ctx.pedimentoPerfil.aduana) ? ctx.pedimentoPerfil : null;
  for (const fila of e.mercancias) {
    if (op === 'exportacion' && deNombre) {
      // A37-S31-06: el «EXPO» del nombre es una pista (0.6), no un hecho: NO se borran los valores que SÍ leyó el documento;
      // se avisa del conflicto y la persona decide.
      for (const k of ['pedimento', 'rfc_importador']) {
        const c = fila[k];
        if (c?.valor && c.origen !== 'humano' && !(c.notas ?? []).includes(NOTA_CONFLICTO_NOMBRE_EXPO)) fila[k] = { ...c, notas: [...(c.notas ?? []), NOTA_CONFLICTO_NOMBRE_EXPO] };
      }
      continue;
    }
    if (op === 'exportacion') {
      // En exportación no hay pedimento ni RFC del importador (Guía de llenado): se vacían aunque el texto los mencione,
      // con o sin pedimento en la fila (un RFC solo también se omite).
      for (const k of ['pedimento', 'rfc_importador']) if (fila[k]?.valor && fila[k].origen !== 'humano') fila[k] = { ...fila[k], valor: null, notas: [...(fila[k].notas ?? []), 'Se omitió: en una exportación no lleva pedimento ni RFC del importador.'] };
      continue;
    }
    const ped = fila.pedimento;
    if (!ped?.valor || ped.origen === 'humano') continue;
    if (perfil && PEDIMENTO_PARCIAL.test(ped.valor)) {
      const [patente, consecutivo] = ped.valor.split('-');
      fila.pedimento = {
        ...ped, valor: `${perfil.anio} ${perfil.aduana} ${patente} ${consecutivo}`, confianza: Math.min(ped.confianza, 0.7), origen: 'derivado',
        notas: [...(ped.notas ?? []), `Se completó el año (${perfil.anio}) y la aduana (${perfil.aduana}) con los del perfil: confírmalos.`],
      };
    }
  }
}

export function completarDerivados(e: Extraccion, ctx: ContextoDerivar = {}): Extraccion {
  derivarAduana(e, ctx);
  for (const fila of e.mercancias) {
    // 1. El peso llegó en OTRA unidad (ton, lb, g): se convierte a kg y se anota.
    const unidadPeso = fila.peso_unidad?.valor ? claveUnidadDeTexto(fila.peso_unidad.valor) : null;
    const peso = fila.peso_kg;
    if (peso && peso.origen !== 'humano' && unidadPeso && unidadPeso !== 'KGM' && FACTOR_A_KG[unidadPeso] !== undefined) {
      const n = num(peso);
      if (n !== null) {
        fila.peso_kg = {
          ...peso,
          valor: redondea(n * FACTOR_A_KG[unidadPeso]),
          notas: [...(peso.notas ?? []), `${unidadPeso === 'LBR' ? 'Convertido de libras' : `El documento da el peso en ${unidadPeso}`}: se convirtió a kilogramos (×${FACTOR_A_KG[unidadPeso]}).`],
        };
        fila.peso_unidad = { ...fila.peso_unidad!, valor: 'KGM' };
      }
    }
    // 1a. El documento solo da el peso NETO (o el «peso por embalaje»): el complemento pide el BRUTO. Por defecto se usa
    //     ese número como bruto y se deja la nota (decisión pendiente del cliente, pregunta 10); nunca se descarta en silencio.
    const tipoPeso = (fila.peso_tipo?.valor ?? '').trim().toLowerCase();
    if (fila.peso_kg?.valor && fila.peso_kg.origen !== 'humano' && /^(neto|peso neto|por embalaje|peso por embalaje|embalaje)$/.test(tipoPeso) && !(fila.peso_kg.notas ?? []).includes(NOTA_NETO_COMO_BRUTO)) {
      fila.peso_kg = { ...fila.peso_kg, notas: [...(fila.peso_kg.notas ?? []), NOTA_NETO_COMO_BRUTO] };
    }
    // 1b. Una «clave» numérica de 1 o 2 dígitos («20», «1») no es del SAT: el valor se conserva como texto de la unidad
    //     (sin pisar uno existente) y la validación pide confirmar la clave.
    const claveCruda = fila.clave_unidad?.valor;
    if (claveCruda && /^\d{1,2}$/.test(claveCruda) && fila.clave_unidad.origen !== 'humano' && !fila.unidad_texto?.valor) {
      fila.unidad_texto = { ...fila.clave_unidad, notas: [...(fila.clave_unidad.notas ?? []), `«${claveCruda}» venía como clave de unidad pero no es una clave SAT; se conserva como texto.`] };
    }
    // 2. La clave de unidad sale del texto de la unidad cuando es inequívoco.
    if (!fila.clave_unidad?.valor && fila.unidad_texto?.valor) {
      const k = claveUnidadDeTexto(fila.unidad_texto.valor);
      if (k) fila.clave_unidad = { valor: k, confianza: Math.min(0.9, fila.unidad_texto.confianza), evidencia: fila.unidad_texto.evidencia, origen: 'derivado', notas: [`«${fila.unidad_texto.valor}» se tradujo a ${k}.`] };
    }
    // 3. Cantidad en kg o toneladas y sin peso aparte: el peso ES la cantidad.
    const clave = fila.clave_unidad?.valor;
    if (!fila.peso_kg?.valor && fila.cantidad?.valor && (clave === 'KGM' || clave === 'TNE')) {
      const q = num(fila.cantidad);
      if (q !== null) {
        fila.peso_kg = {
          valor: redondea(q * FACTOR_A_KG[clave]),
          confianza: Math.min(0.9, fila.cantidad.confianza),
          evidencia: fila.cantidad.evidencia,
          origen: 'derivado',
          notas: [`La cantidad está en ${clave}: el peso en kg se derivó de ella.`],
        };
      }
    }
  }
  // 4. El peso bruto total, de la suma de renglones, si el documento no lo da.
  const actual = e.campos.peso_bruto_total;
  if ((!actual || actual.origen === 'derivado') && e.mercancias.length > 0) {
    const pesos = e.mercancias.map((f) => num(f.peso_kg));
    if (pesos.every((p): p is number => p !== null)) {
      const confs = e.mercancias.map((f) => f.peso_kg.confianza);
      e.campos.peso_bruto_total = {
        valor: redondea(pesos.reduce((s, p) => s + p, 0)),
        confianza: Math.min(...confs),
        evidencia: null,
        origen: 'derivado',
        notas: ['Suma de los pesos de las mercancías.'],
      };
    } else if (actual?.origen === 'derivado') {
      delete e.campos.peso_bruto_total;
    }
  }
  return e;
}

// ═══════════════════════════════════════════════════════════════════════════
// Piezas comunes de los lectores de formato C, D y E (T-A3-60).
//
// Un lector deja en la extracción SOLO lo que el documento escribe, con su evidencia y su confianza. Lo que el documento
// no trae (régimen, cliente interno, distancia, claves SAT, tramo mexicano) queda vacío a propósito: lo llena T-A3-62
// con catálogos y lo marca «inferido». Nada de aquí inventa un valor.
// ═══════════════════════════════════════════════════════════════════════════

export type FormatoLector = 'C' | 'D' | 'E' | 'F1' | 'F2' | 'F3';

export type CodigoIncidenciaLector =
  | 'columna_cortada' | 'clave_truncada' | 'renglon_no_leido' | 'pedimento_incompleto'
  | 'peso_en_libras' | 'peso_unidad_supuesta' | 'total_miles_por_cuadre' | 'total_no_cuadra' | 'sin_vision'
  | 'captura_incompleta' | 'baja_resolucion';

/** Algo que quien revisa debe ver: va al visor junto al campo, no se pierde en un log. */
export interface IncidenciaLector {
  codigo: CodigoIncidenciaLector;
  campo: string | null;
  /** Renglón de mercancía (base 0), o null si es del documento. */
  renglon: number | null;
  detalle: string;
}

export interface ResultadoLector {
  formato: FormatoLector;
  /** ¿Se leyó al menos un renglón de mercancía? Si no, el llamador sigue el flujo genérico y nada se envía al TMS. */
  leido: boolean;
  extraccion: Extraccion;
  avisos: string[];
  incidencias: IncidenciaLector[];
  /** Lo que el documento no trae y queda vacío para T-A3-62 (catálogos). */
  vacios: string[];
  /** Datos leídos que el complemento no tiene como campo (p. ej. el sello de la caja). */
  adicionales: Record<string, string>;
  /** T-A3-61: correos y capturas — el texto termina en un rótulo sin valor (la captura llegó cortada). La validación lo vuelve bloqueo. */
  capturaIncompleta?: { ultimoRotulo: string } | null;
}

export interface OpcionesCampoLeido {
  confianza: number;
  evidencia?: string | null;
  /** `perfil` para lo que se lee por rótulo (como la plantilla del TMS); `llm` para lo que leyó un modelo de visión. */
  origen?: Origen;
  notas?: string[];
  miles?: ',' | '.';
  ordenFecha?: OrdenFecha;
}

/** Un valor leído del documento, normalizado igual que el del modelo (misma forma, mismas notas y mismas penalizaciones). */
export function campoLeido(clave: string, mercancia: boolean, crudo: unknown, o: OpcionesCampoLeido): CampoValor | null {
  const def = mercancia ? campoMercancia(clave) : campoDoc(clave);
  if (!def) return null;
  const n = normalizarValor(def, crudo, { miles: o.miles, ordenFecha: o.ordenFecha });
  if (n.valor === null) return null;
  const notas = [...(o.notas ?? []), ...n.notas];
  return {
    valor: n.valor,
    confianza: Math.max(0, Math.round((Math.min(0.99, o.confianza) - n.penalizacion) * 1000) / 1000),
    evidencia: limpiarTexto(o.evidencia ?? null, 200),
    origen: o.origen ?? 'perfil',
    ...(notas.length ? { notas } : {}),
  };
}

/**
 * ¿Qué separador de miles usa ESTE documento? Solo se afirma con evidencia inequívoca (un número con dos grupos de miles,
 * o con grupo de miles Y decimales: «6,577.50» → coma; «6.577,50» → punto). Sin evidencia, o si se contradicen: `undefined`
 * y cada cifra ambigua se queda marcada como ambigua.
 */
export function detectarSeparadorMiles(valores: ReadonlyArray<string>): ',' | '.' | undefined {
  let coma = false; let punto = false;
  for (const v of valores) {
    const t = v.trim().replace(/\s*[a-z]{1,12}\.?$/i, '').replace(/\s+/g, '');
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t) && (/\.\d/.test(t) || (t.match(/,/g) ?? []).length >= 2)) coma = true;
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) && (/,\d/.test(t) || (t.match(/\./g) ?? []).length >= 2)) punto = true;
  }
  return coma === punto ? undefined : coma ? ',' : '.';
}

/**
 * Lo que el documento NO trajo y debe llenar T-A3-62 (régimen, cliente interno, distancia, clave de producto SAT, claves SAT del
 * domicilio y tramo mexicano). Solo enumera lo que de verdad falta en la extracción.
 */
export function pendientesDeEnriquecimiento(e: Extraccion): string[] {
  const hay = (c: CampoValor | undefined): boolean => !!c && c.valor !== null && c.valor !== '';
  const fuera: string[] = [];
  if (!hay(e.campos.regimen_aduanero) && !e.mercancias.some((f) => hay(f.regimen_aduanero))) fuera.push('regimen_aduanero');
  if (!hay(e.campos.numero_cliente_interno)) fuera.push('numero_cliente_interno');
  if (!hay(e.campos.distancia_km)) fuera.push('distancia_km');
  if (e.mercancias.length === 0 || e.mercancias.some((f) => !hay(f.bienes_transp))) fuera.push('bienes_transp');
  if (!hay(e.campos.origen_colonia_clave) || !hay(e.campos.destino_colonia_clave)) fuera.push('claves_sat_domicilio');
  if (!hay(e.campos.origen_cp) || !hay(e.campos.destino_cp)) fuera.push('tramo_mexicano');
  return fuera;
}

// ── Tablas de texto: el PDF colapsa los espacios, así que una columna no siempre se distingue por «dos o más espacios» ──

export type ClaveColumna = 'ref' | 'cantidad' | 'tipo' | 'descripcion' | 'peso' | 'hm' | 'pedimento';

/** El orden de las columnas de una tabla según su línea de encabezado (cada columna con la expresión que la nombra). */
export function ordenDeColumnas(encabezado: string, columnas: ReadonlyArray<readonly [ClaveColumna, RegExp]>): ClaveColumna[] {
  const halladas: Array<{ clave: ClaveColumna; en: number }> = [];
  for (const [clave, re] of columnas) {
    const m = re.exec(encabezado);
    if (m && !halladas.some((h) => h.clave === clave)) halladas.push({ clave, en: m.index });
  }
  return halladas.sort((a, b) => a.en - b.en).map((h) => h.clave);
}

const FORMA_COLUMNA: Readonly<Record<ClaveColumna, { patron: string; opcional: boolean }>> = {
  ref: { patron: '\\S+', opcional: false },
  cantidad: { patron: '\\d[\\d.,]*', opcional: false },
  tipo: { patron: '\\S+', opcional: false },
  descripcion: { patron: '.+?', opcional: false },
  peso: { patron: '\\d[\\d.,]*', opcional: false },
  hm: { patron: '\\S+', opcional: true },
  pedimento: { patron: '\\d{4}-\\d{7}|\\d{2} \\d{2} \\d{4} \\d{7}|\\d{15}', opcional: true },
};

const partirCeldas = (linea: string): string[] => linea.split(/\s{2,}|\t|\|/).map((c) => c.trim()).filter((c) => c !== '');

/**
 * Un renglón de una tabla de texto → sus valores por columna. Primero por CELDAS (dos o más espacios, tabulador o barra); si el PDF
 * colapsó los espacios, por la FORMA de cada columna (una cantidad es una cifra, un pedimento es `patente-consecutivo`…), y entonces
 * la frontera entre columnas es una deducción: `modo: 'espacios'`. Si no encaja de ninguna de las dos formas: `null` (no se adivina).
 */
export function leerRenglonPorColumnas(linea: string, orden: readonly ClaveColumna[]): { valores: Partial<Record<ClaveColumna, string>>; modo: 'celdas' | 'espacios' } | null {
  if (orden.length === 0) return null;
  const celdas = partirCeldas(linea);
  if (celdas.length === orden.length) {
    return { valores: Object.fromEntries(orden.map((k, i) => [k, celdas[i]])) as Partial<Record<ClaveColumna, string>>, modo: 'celdas' };
  }
  const re = new RegExp(`^${orden.map((k, i) => {
    const { patron, opcional } = FORMA_COLUMNA[k];
    const g = `(${patron})`;
    return i === 0 ? g : opcional ? `(?:\\s+${g})?` : `\\s+${g}`;
  }).join('')}\\s*$`, 'i');
  const m = re.exec(linea.trim().replace(/\s+/g, ' '));
  if (!m) return null;
  const valores: Partial<Record<ClaveColumna, string>> = {};
  orden.forEach((k, i) => { if (m[i + 1] !== undefined && m[i + 1].trim() !== '') valores[k] = m[i + 1].trim(); });
  return { valores, modo: 'espacios' };
}
