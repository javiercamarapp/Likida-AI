// ═══════════════════════════════════════════════════════════════════════════
// IMPORTACIÓN POR CSV DEL CATÁLOGO POR CLIENTE (T-A3-21).
//
// El catálogo de un cliente (0792) se construye UNA vez; teclearlo fila por fila no escala. Aquí vive todo lo que no
// toca la base: leer el CSV, validarlo fila por fila (errores en español con el número de fila), compararlo contra lo
// que ya hay (nuevas / cambian / sin cambio) y partir lo que se escribe en lotes. La base entra por un PUERTO que
// recibe quien llama (la acción de servidor pone supabase; las pruebas ponen un falso).
//
// Tres plantillas descargables: producto (SKU → clave SAT), parte (remitente/destinatario) y cliente-número.
//
// Reglas:
//   · Separador `,` o `;` (se detecta del encabezado); UTF-8 con o sin BOM. Otra codificación se rechaza con un
//     mensaje llano en vez de guardar basura.
//   · Tope: 5 MB y 20 000 filas. Más que eso no es un catálogo de cliente: es un error de archivo.
//   · Bloqueo de fórmulas: una celda que empieza con `= + - @` (o tabulador / retorno) se RECHAZA, no se «arregla»:
//     el CSV que la flota edite después en Excel no debe poder ejecutar nada. Único caso permitido: un teléfono
//     con prefijo internacional (`+52 55 …`).
//   · Idempotente: se escribe por la clave natural (upsert). Reimportar el mismo archivo da «0 nuevas, 0 cambian» y
//     no reescribe nada. El archivo manda: una columna opcional vacía deja la celda vacía en el catálogo.
//   · «Confirmar» NO aplica nada si alguna fila trae error (todo o nada a nivel de validación); lo válido se
//     escribe en lotes de 500. Cada lote es una sola sentencia atómica; como la escritura es un upsert por clave,
//     si un lote fallara a medias, volver a subir el mismo archivo termina el trabajo sin duplicar.
//   · Un cliente que no es de la flota (otro tenant, id inventado) es un error de fila: la búsqueda de clientes
//     la hace el puerto ya acotada al tenant de la sesión.
// ═══════════════════════════════════════════════════════════════════════════

import { llaveTexto } from './catalogos';
import { numero } from '@/lib/formato';

export type TipoPlantilla = 'producto' | 'parte' | 'cliente_numero';
export const TIPOS_PLANTILLA: readonly TipoPlantilla[] = ['producto', 'parte', 'cliente_numero'];

export const TOPE_FILAS_IMPORTACION = 20_000;
export const TOPE_BYTES_IMPORTACION = 5 * 1024 * 1024;
export const TAMANO_LOTE = 500;
/** Cuántos errores se enseñan; el conteo total siempre es completo. */
export const TOPE_ERRORES_VISIBLES = 50;

type TipoCol = 'texto' | 'bool' | 'rfc' | 'rol' | 'correo' | 'telefono';
interface Col { clave: string; max: number; req?: boolean; tipo?: TipoCol }

const COLUMNAS: Record<TipoPlantilla, Col[]> = {
  producto: [
    { clave: 'sku', max: 80, req: true },
    { clave: 'descripcion_patron', max: 200 },
    { clave: 'bienes_transp', max: 20, req: true },
    { clave: 'clave_unidad', max: 10, req: true },
    { clave: 'embalaje', max: 10 },
    { clave: 'fraccion', max: 20 },
    { clave: 'tipo_materia', max: 10 },
    { clave: 'material_peligroso', max: 5, tipo: 'bool' },
    { clave: 'clave_material_peligroso', max: 10 },
  ],
  parte: [
    { clave: 'rol', max: 12, req: true, tipo: 'rol' },
    { clave: 'alias', max: 120, req: true },
    { clave: 'razon_social', max: 254 },
    { clave: 'rfc', max: 13, tipo: 'rfc' },
    { clave: 'id_fiscal_extranjero', max: 40 },
    { clave: 'calle', max: 100 },
    { clave: 'num_ext', max: 55 },
    { clave: 'num_int', max: 55 },
    { clave: 'colonia_clave', max: 10 },
    { clave: 'colonia', max: 120 },
    { clave: 'cp', max: 12 },
    { clave: 'localidad_clave', max: 10 },
    { clave: 'localidad', max: 120 },
    { clave: 'municipio_clave', max: 10 },
    { clave: 'municipio', max: 120 },
    { clave: 'estado', max: 60 },
    { clave: 'pais', max: 60 },
    { clave: 'contacto', max: 120 },
    { clave: 'telefono', max: 40, tipo: 'telefono' },
    { clave: 'correo', max: 254, tipo: 'correo' },
  ],
  cliente_numero: [
    { clave: 'numero_interno', max: 60, req: true },
    { clave: 'numero_pagador', max: 60 },
    { clave: 'activo', max: 5, tipo: 'bool' },
  ],
};

/** Columnas que forman la clave natural (además de tenant y cliente). */
const CLAVE_NATURAL: Record<TipoPlantilla, string[]> = { producto: ['sku'], parte: ['rol', 'alias'], cliente_numero: [] };
export const TABLA: Record<TipoPlantilla, string> = {
  producto: 'cp_catalogo_producto', parte: 'cp_catalogo_parte', cliente_numero: 'cp_cliente_numero',
};
export const CONFLICTO: Record<TipoPlantilla, string> = {
  producto: 'tenant_id,cliente_id,sku', parte: 'tenant_id,cliente_id,rol,alias', cliente_numero: 'tenant_id,cliente_id',
};

const RFC = /^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TELEFONO_INTERNACIONAL = /^\+[0-9][0-9 ().-]*$/;
// Caracteres de control (salvo los que el CSV maneja en el parser). Una celda con uno de estos no es texto de catálogo.
export const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
export const INICIO_FORMULA = /^[=+\-@\t\r]/;

export type Valor = string | boolean | null;
export type Registro = Record<string, Valor>;

export interface ErrorFila { fila: number; mensaje: string }

export interface ResultadoImportacion {
  ok: boolean;
  /** `true` solo si se escribió en la base (confirmar sin errores). */
  aplicado: boolean;
  mensaje: string;
  nuevas: number;
  cambian: number;
  sinCambio: number;
  conError: number;
  errores: ErrorFila[];
  /** Columnas que cambian en las filas existentes (vacío si ninguna cambia). */
  camposQueCambian?: string[];
}

/** Lo único que la importación necesita de la base. Siempre acotado al tenant que se le pasa. */
export interface PuertoImportacion {
  /** Clientes de ESTA flota. */
  clientes(tenantId: string): Promise<Array<{ id: string; nombre: string }>>;
  /** Lo que ya hay para esos clientes, en la misma forma canónica que produce la validación (snake_case, sin tenant). */
  existentes(tenantId: string, tipo: TipoPlantilla, clienteIds: string[]): Promise<Registro[]>;
  /** Escribe un lote (upsert por la clave natural). Cada registro trae `cliente_id`; el puerto agrega tenant y actor. */
  aplicarLote(tenantId: string, tipo: TipoPlantilla, registros: Registro[], actorId: string): Promise<void>;
}

// ── Plantillas descargables ─────────────────────────────────────────────────

const EJEMPLO: Record<TipoPlantilla, string[]> = {
  producto: ['Cliente de ejemplo', 'SKU-0001', 'Llanta radial 205/55R16', '78101800', 'H87', '', '', '', 'no', ''],
  parte: ['Cliente de ejemplo', 'remitente', 'Planta Norte', 'Remitente Ejemplo SA de CV', 'XAXX010101000', '', 'Calle Ejemplo', '100', '', '', 'Colonia Ejemplo', '00000', '', '', '', '', 'Nuevo Leon', 'MEX', '', '', ''], // grep-limpio:ok
  cliente_numero: ['Cliente de ejemplo', '10001', '', 'si'],
};

export function columnasDePlantilla(tipo: TipoPlantilla): string[] {
  return ['cliente', ...COLUMNAS[tipo].map((c) => c.clave)];
}

/** El CSV vacío de una plantilla: encabezado + UNA fila de ejemplo sintética (el cliente de ejemplo no existe: hay que cambiarla). */
export function plantillaCsv(tipo: TipoPlantilla): string {
  const cols = columnasDePlantilla(tipo);
  return `﻿${cols.join(',')}\r\n${EJEMPLO[tipo].map(celdaCsv).join(',')}\r\n`;
}

function celdaCsv(v: string): string {
  return /[",;\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// ── Lector de CSV ───────────────────────────────────────────────────────────

export type LecturaCsv = { ok: true; filas: string[][] } | { ok: false; mensaje: string };

/** CSV (RFC 4180) a filas de celdas. Entiende comillas, comillas dobles escapadas y saltos de línea dentro de comillas. */
export function leerCsv(bytes: Uint8Array): LecturaCsv {
  if (bytes.byteLength === 0) return { ok: false, mensaje: 'El archivo está vacío.' };
  if (bytes.byteLength > TOPE_BYTES_IMPORTACION) {
    return { ok: false, mensaje: `El archivo pesa más de ${TOPE_BYTES_IMPORTACION / 1024 / 1024} MB. Pártelo en varios.` };
  }
  let texto: string;
  try {
    texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, mensaje: 'El archivo no está en UTF-8. En Excel: Guardar como → «CSV UTF-8 (delimitado por comas)».' };
  }
  if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1);
  if (texto.includes('\u0000')) return { ok: false, mensaje: 'El archivo no parece un CSV de texto.' };

  const delim = detectarSeparador(texto);
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = '';
  let entreComillas = false;
  let hayContenido = false;
  const cerrarFila = (): void => {
    fila.push(celda);
    // Una línea completamente vacía no es una fila.
    if (hayContenido || fila.some((c) => c !== '')) filas.push(fila);
    fila = []; celda = ''; hayContenido = false;
  };
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { celda += '"'; i++; } else entreComillas = false;
      } else celda += c;
      continue;
    }
    if (c === '"' && celda === '') { entreComillas = true; hayContenido = true; }
    else if (c === delim) { fila.push(celda); celda = ''; }
    else if (c === '\r') { if (texto[i + 1] === '\n') i++; cerrarFila(); }
    else if (c === '\n') cerrarFila();
    else celda += c;
    if (filas.length > TOPE_FILAS_IMPORTACION + 1) {
      return { ok: false, mensaje: `El archivo trae más de ${numero(TOPE_FILAS_IMPORTACION)} filas. Pártelo en varios.` };
    }
  }
  if (entreComillas) return { ok: false, mensaje: 'Hay unas comillas sin cerrar: revisa el archivo.' };
  if (celda !== '' || fila.length > 0) cerrarFila();
  if (filas.length > TOPE_FILAS_IMPORTACION + 1) {
    return { ok: false, mensaje: `El archivo trae más de ${numero(TOPE_FILAS_IMPORTACION)} filas. Pártelo en varios.` };
  }
  return { ok: true, filas };
}

/** `;` o `,` según cuál aparece más en la primera línea (fuera de comillas). Empate → coma. */
function detectarSeparador(texto: string): ',' | ';' {
  let comas = 0; let puntos = 0; let q = false;
  for (const c of texto) {
    if (c === '"') q = !q;
    else if (!q) {
      if (c === '\n' || c === '\r') break;
      if (c === ',') comas++;
      else if (c === ';') puntos++;
    }
  }
  return puntos > comas ? ';' : ',';
}

// ── Validación fila por fila ────────────────────────────────────────────────

export const normEncabezado = (h: string): string => llaveTexto(h).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

export type Validacion =
  | { ok: false; mensaje: string }
  | { ok: true; validas: Array<{ fila: number; registro: Registro }>; errores: ErrorFila[]; total: number };

function valorBool(v: string): boolean | null {
  const t = llaveTexto(v);
  if (['si', 's', '1', 'true', 'verdadero', 'x'].includes(t)) return true;
  if (['no', 'n', '0', 'false', 'falso', ''].includes(t)) return false;
  return null;
}

/** Valida y normaliza las filas de datos. `clientes` = los de la flota (id + nombre). */
export function validarFilas(
  tipo: TipoPlantilla,
  filas: string[][],
  clientes: ReadonlyArray<{ id: string; nombre: string }>,
): Validacion {
  if (filas.length === 0) return { ok: false, mensaje: 'El archivo está vacío.' };
  const esperadas = columnasDePlantilla(tipo);
  const cab = filas[0].map(normEncabezado);
  const desconocidas = cab.filter((h) => !esperadas.includes(h));
  if (desconocidas.length > 0) {
    return { ok: false, mensaje: `Columna no reconocida: ${desconocidas.map((h) => `«${h || '(sin nombre)'}»`).join(', ')}. Descarga la plantilla y usa sus columnas.` };
  }
  const repetidas = cab.filter((h, i) => cab.indexOf(h) !== i);
  if (repetidas.length > 0) return { ok: false, mensaje: `La columna «${repetidas[0]}» está repetida.` };
  const faltan = ['cliente', ...COLUMNAS[tipo].filter((c) => c.req).map((c) => c.clave)].filter((h) => !cab.includes(h));
  if (faltan.length > 0) return { ok: false, mensaje: `Falta la columna obligatoria ${faltan.map((h) => `«${h}»`).join(', ')}.` };

  const datos = filas.slice(1);
  if (datos.length === 0) return { ok: false, mensaje: 'El archivo solo trae el encabezado: no hay filas que importar.' };
  if (datos.length > TOPE_FILAS_IMPORTACION) {
    return { ok: false, mensaje: `El archivo trae más de ${numero(TOPE_FILAS_IMPORTACION)} filas. Pártelo en varios.` };
  }

  const porId = new Map(clientes.map((c) => [c.id.toLowerCase(), c.id]));
  const porNombre = new Map<string, string[]>();
  for (const c of clientes) {
    const k = llaveTexto(c.nombre);
    porNombre.set(k, [...(porNombre.get(k) ?? []), c.id]);
  }

  const validas: Array<{ fila: number; registro: Registro }> = [];
  const errores: ErrorFila[] = [];
  const vistas = new Map<string, number>();
  const idx = (clave: string): number => cab.indexOf(clave);

  datos.forEach((celdas, i) => {
    const fila = i + 2; // la fila 1 es el encabezado, como en la hoja de cálculo
    const problemas: string[] = [];
    const leer = (clave: string): string => (celdas[idx(clave)] ?? '').trim();

    // Fórmulas y caracteres de control, en TODA celda de la fila.
    for (let k = 0; k < cab.length; k++) {
      const cruda = celdas[k] ?? '';
      const v = cruda.trim();
      if (v === '') continue;
      const telefonoOk = cab[k] === 'telefono' && TELEFONO_INTERNACIONAL.test(v);
      if ((INICIO_FORMULA.test(cruda) || INICIO_FORMULA.test(v)) && !telefonoOk) {
        const primero = /^[\t\r]/.test(cruda) ? 'un tabulador' : `«${v[0]}»`;
        problemas.push(`«${cab[k]}» empieza con ${primero}, que una hoja de cálculo toma como fórmula. Quita ese carácter.`);
      } else if (CONTROL.test(v)) {
        problemas.push(`«${cab[k]}» trae caracteres que no son texto.`);
      }
    }

    // Cliente: por id o por nombre, solo entre los de ESTA flota.
    let clienteId: string | null = null;
    const refCliente = leer('cliente');
    if (refCliente === '') problemas.push('Falta el cliente.');
    else if (UUID.test(refCliente)) {
      clienteId = porId.get(refCliente.toLowerCase()) ?? null;
      if (!clienteId) problemas.push('Ese cliente no es de tu flota.');
    } else {
      const ids = porNombre.get(llaveTexto(refCliente)) ?? [];
      if (ids.length === 1) clienteId = ids[0];
      else if (ids.length > 1) problemas.push(`Hay ${ids.length} clientes llamados «${refCliente}»: usa su id en lugar del nombre.`);
      else problemas.push(`No hay un cliente llamado «${refCliente}» en tu flota.`);
    }

    const registro: Registro = { cliente_id: clienteId };
    for (const col of COLUMNAS[tipo]) {
      // A37-S31-02: una columna que el CSV no trae NO se escribe (antes quedaba en false/null y el upsert pisaba lo guardado
      // —p. ej. material_peligroso—). Los altas toman el valor por omisión de la base.
      if (!cab.includes(col.clave)) continue;
      const crudo = leer(col.clave);
      if (col.req && crudo === '') { problemas.push(`Falta «${col.clave}».`); continue; }
      if (col.tipo === 'bool') {
        const b = valorBool(crudo);
        if (b === null) problemas.push(`«${col.clave}» debe ser sí o no (dice «${crudo}»).`);
        else registro[col.clave] = col.clave === 'activo' && crudo === '' ? true : b;
        continue;
      }
      if (crudo === '') { registro[col.clave] = null; continue; }
      let valor = crudo;
      if (col.tipo === 'rfc') {
        valor = crudo.toUpperCase();
        if (!RFC.test(valor)) { problemas.push(`El RFC «${crudo}» no tiene forma válida (12 o 13 caracteres: letras, fecha de 6 dígitos y homoclave).`); continue; }
      } else if (col.tipo === 'rol') {
        const r = llaveTexto(crudo);
        if (r !== 'remitente' && r !== 'destinatario') { problemas.push(`«rol» debe ser remitente o destinatario (dice «${crudo}»).`); continue; }
        valor = r;
      } else if (col.tipo === 'correo' && !CORREO.test(crudo)) {
        problemas.push(`El correo «${crudo}» no es válido.`); continue;
      }
      if (valor.length > col.max) { problemas.push(`«${col.clave}» pasa de ${col.max} caracteres.`); continue; }
      registro[col.clave] = valor;
    }
    if (tipo === 'producto' && 'material_peligroso' in registro && registro.material_peligroso !== true && registro.clave_material_peligroso) {
      problemas.push('Hay una clave de material peligroso, pero el producto no está marcado como peligroso.');
    }

    if (problemas.length === 0 && clienteId) {
      const clave = [clienteId, ...CLAVE_NATURAL[tipo].map((c) => llaveClave(c, String(registro[c])))].join('|');
      const previa = vistas.get(clave);
      if (previa !== undefined) problemas.push(`Repite la clave de la fila ${previa}.`);
      else vistas.set(clave, fila);
    }

    if (problemas.length > 0) errores.push({ fila, mensaje: problemas.join(' ') });
    else validas.push({ fila, registro });
  });

  return { ok: true, validas, errores, total: datos.length };
}

/** El SKU distingue mayúsculas (la clave de la base también); el alias y el rol no importan en mayúsculas igual. */
const llaveClave = (columna: string, v: string): string => (columna === 'sku' ? v : llaveTexto(v));

// ── Comparar con lo que ya hay ──────────────────────────────────────────────

export interface Plan {
  nuevas: Registro[]; cambian: Registro[]; sinCambio: number;
  /** A37-S31-02: columnas que de verdad cambian en alguna fila existente (las que el CSV trae y difieren). */
  camposQueCambian: string[];
}

export function claveDeRegistro(tipo: TipoPlantilla, r: Registro): string {
  return [String(r.cliente_id), ...CLAVE_NATURAL[tipo].map((c) => llaveClave(c, String(r[c] ?? '')))].join('|');
}

/** Reparte los registros válidos en nuevos / con cambios / idénticos frente a lo existente. */
export function planificar(tipo: TipoPlantilla, validos: Registro[], existentes: Registro[]): Plan {
  const previo = new Map(existentes.map((e) => [claveDeRegistro(tipo, e), e]));
  const columnas = COLUMNAS[tipo].map((c) => c.clave);
  const plan: Plan = { nuevas: [], cambian: [], sinCambio: 0, camposQueCambian: [] };
  const cambiados = new Set<string>();
  for (const r of validos) {
    const e = previo.get(claveDeRegistro(tipo, r));
    if (!e) { plan.nuevas.push(r); continue; }
    // Solo se comparan las columnas que el archivo trae: las ausentes no se escriben, así que no son «cambio».
    const distintas = columnas.filter((c) => c in r && !igual(r[c], e[c]));
    if (distintas.length === 0) plan.sinCambio++;
    else { plan.cambian.push(r); distintas.forEach((c) => cambiados.add(c)); }
  }
  plan.camposQueCambian = columnas.filter((c) => cambiados.has(c));
  return plan;
}

const igual = (a: Valor | undefined, b: Valor | undefined): boolean => (a ?? null) === (b ?? null);

export function enLotes<T>(xs: readonly T[], tamano = TAMANO_LOTE): T[][] {
  const salida: T[][] = [];
  for (let i = 0; i < xs.length; i += tamano) salida.push(xs.slice(i, i + tamano));
  return salida;
}

// ── Orquestación ────────────────────────────────────────────────────────────

export interface EntradaImportacion {
  tenantId: string;
  actorId: string;
  tipo: TipoPlantilla;
  bytes: Uint8Array;
  /** `false` = vista previa (no escribe); `true` = aplicar. */
  confirmar: boolean;
}

const vacio = (mensaje: string): ResultadoImportacion => ({
  ok: false, aplicado: false, mensaje, nuevas: 0, cambian: 0, sinCambio: 0, conError: 0, errores: [],
});

const plural = (n: number, uno: string, varios: string): string => `${n} ${n === 1 ? uno : varios}`;

export async function importarCatalogo(e: EntradaImportacion, puerto: PuertoImportacion): Promise<ResultadoImportacion> {
  const lectura = leerCsv(e.bytes);
  if (!lectura.ok) return vacio(lectura.mensaje);

  const clientes = await puerto.clientes(e.tenantId);
  const v = validarFilas(e.tipo, lectura.filas, clientes);
  if (!v.ok) return vacio(v.mensaje);

  const ids = [...new Set(v.validas.map((x) => String(x.registro.cliente_id)))];
  const existentes = ids.length > 0 ? await puerto.existentes(e.tenantId, e.tipo, ids) : [];
  if (e.tipo === 'producto') {
    // Sin la columna material_peligroso, un SKU NUEVO nace «no peligroso» y la base rechazaría su clave de material peligroso.
    const yaHay = new Set(existentes.map((x) => claveDeRegistro(e.tipo, x)));
    for (const { fila, registro } of v.validas) {
      if (!('material_peligroso' in registro) && registro.clave_material_peligroso && !yaHay.has(claveDeRegistro(e.tipo, registro))) {
        v.errores.push({ fila, mensaje: 'Hay una clave de material peligroso, pero el archivo no trae la columna «material_peligroso» y el producto es nuevo.' });
      }
    }
  }
  const plan = planificar(e.tipo, v.validas.map((x) => x.registro), existentes);

  const base = {
    nuevas: plan.nuevas.length, cambian: plan.cambian.length, sinCambio: plan.sinCambio,
    conError: v.errores.length, errores: v.errores.slice(0, TOPE_ERRORES_VISIBLES), camposQueCambian: plan.camposQueCambian,
  };
  const quienCambia = plan.camposQueCambian.length > 0 ? ` Cambian estas columnas: ${plan.camposQueCambian.join(', ')}.` : '';
  const resumen = `${plural(base.nuevas, 'nueva', 'nuevas')}, ${base.cambian} ${base.cambian === 1 ? 'cambia' : 'cambian'}, ${plural(base.conError, 'fila con error', 'filas con error')}`;

  if (!e.confirmar) {
    return {
      ok: true, aplicado: false, ...base,
      mensaje: `Vista previa: ${resumen}${base.sinCambio > 0 ? ` (${base.sinCambio} sin cambio)` : ''}.${quienCambia} ${base.conError > 0 ? 'Corrige las filas con error y vuelve a subir el archivo para poder aplicarlo.' : 'Nada se ha guardado todavía: confirma para aplicarlo.'}`,
    };
  }
  if (base.conError > 0) {
    return { ok: false, aplicado: false, ...base, mensaje: `No se aplicó nada: ${resumen}. Corrige esas filas y vuelve a subir el archivo.` };
  }
  const aEscribir = [...plan.nuevas, ...plan.cambian];
  if (aEscribir.length === 0) {
    return { ok: true, aplicado: false, ...base, mensaje: `Nada que cambiar: el catálogo ya tiene estas ${plural(base.sinCambio, 'fila', 'filas')}.` };
  }
  const lotes = enLotes(aEscribir);
  let hechos = 0;
  for (let i = 0; i < lotes.length; i++) {
    try {
      await puerto.aplicarLote(e.tenantId, e.tipo, lotes[i], e.actorId);
      hechos += lotes[i].length;
    } catch {
      return {
        ok: false, aplicado: false, ...base,
        mensaje: `Se guardaron ${hechos} de ${aEscribir.length} filas y el lote ${i + 1} de ${lotes.length} falló. Vuelve a subir el mismo archivo: lo ya guardado no se duplica.`,
      };
    }
  }
  return { ok: true, aplicado: true, ...base, mensaje: `Listo: ${plural(base.nuevas, 'nueva', 'nuevas')} y ${base.cambian} ${base.cambian === 1 ? 'actualizada' : 'actualizadas'}.` };
}
