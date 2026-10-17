import { coordenadasValidas, dentroDeMexico, haversineM } from './geo';
import type { SitioCsv, TipoSitio } from './sitios';

// ═══════════════════════════════════════════════════════════════════════════
// IMPORTACIÓN DEL CATÁLOGO DEPURADO DE ORÍGENES Y DESTINOS (T-SYS-25). Puro, sin I/O.
//
// El catálogo del cliente trae ≈13 440 registros con repetidos, activos e inactivos revueltos (servicio al cliente
// reactiva a mano los que otro desactivó) y coordenadas dudosas que hacen fallar la geocerca («no estoy cerca»).
//
// Este módulo NO escribe en ningún sistema y NO arregla nada solo:
//   · Un duplicado es solo un CANDIDATO: se reporta y una persona decide. Nunca se fusiona.
//   · Una coordenada dudosa pasa a «por validar»; no se corrige, no se geocodifica, no se inventa.
//   · Lo «por validar» NO entra a las filas listas para importar.
//
// «Candidato a duplicado» = mismo nombre normalizado (sin acentos, mayúsculas ni signos) O dos puntos con coordenadas
// buenas a ≤ 100 m. Se agrupan transitivamente (A~B y B~C → un grupo). Las filas inactivas también cuentan: son las que
// servicio al cliente vuelve a dar de alta.
//
// Coordenadas «por validar»: ausentes, fuera de rango, (0,0), o fuera de México SIN país extranjero declarado.
// El país se declara en la columna `pais`; cualquiera distinto de México/MX se trata como extranjero (las de EE. UU.
// van aparte, otra empresa las da de alta).
//
// La lista de validación (revisión de los sábados) se reparte por terminal con un cupo diario configurable (20–30):
// primero lo «por validar», luego los candidatos a duplicado, luego las activas sin reparo. Las inactivas sin reparo no
// se revisan (se revisan al reactivarse). Determinista: la misma entrada da la misma lista (reimportación idempotente).
// ═══════════════════════════════════════════════════════════════════════════

export const CUPO_MIN = 20;
export const CUPO_MAX = 30;
export const CUPO_DEFECTO = 20;
export const DISTANCIA_DUPLICADO_M = 100;
export const RADIO_DEFECTO_M = 150;
export const TERMINAL_SIN_ASIGNAR = '(sin terminal)';
export const TERMINAL_EXTRANJERO = 'Extranjero (EE. UU. y otros)';
/** Tope de filas por llamada a la base: el importador de la 0385 acepta 2000 por lote (MAX_FILAS_SITIOS). */
export const TAMANO_LOTE = 2000;

export interface FilaCatalogo {
  linea: number;
  nombre: string;
  codigo: string | null;
  lat: number | null;
  lng: number | null;
  radio_m: number | null;
  activo: boolean;
  terminal: string | null;
  /** Texto libre del país; vacío = México. */
  pais: string | null;
  direccion: string | null;
  tipo: TipoSitio | null;
}

export interface ErrorCatalogo { linea: number; mensaje: string }

export interface ResultadoLectura { filas: FilaCatalogo[]; errores: ErrorCatalogo[] }

const sinAcentos = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '');
const clave = (t: string): string => sinAcentos(t).toLowerCase().trim().replace(/[\s-]+/g, '_');

/** Nombre comparable: sin acentos, minúsculas, sin signos, espacios colapsados. */
export function normalizarNombre(t: string): string {
  return sinAcentos(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const ALIAS_COLUMNA: Record<string, string> = {
  nombre: 'nombre', name: 'nombre', sitio: 'nombre', origen_destino: 'nombre', descripcion: 'nombre',
  codigo: 'codigo', code: 'codigo', clave: 'codigo', id: 'codigo',
  lat: 'lat', latitud: 'lat', latitude: 'lat',
  lng: 'lng', lon: 'lng', long: 'lng', longitud: 'lng', longitude: 'lng',
  radio_m: 'radio_m', radio: 'radio_m', radio_metros: 'radio_m',
  activo: 'activo', activa: 'activo', estatus: 'activo', estado: 'activo', status: 'activo',
  terminal: 'terminal', patio: 'terminal', plaza: 'terminal',
  pais: 'pais', country: 'pais',
  direccion: 'direccion', domicilio: 'direccion',
  tipo: 'tipo',
};

const TIPOS: Record<string, TipoSitio> = {
  cliente: 'cliente', planta: 'planta', anden: 'anden', patio: 'patio', punto_interes: 'punto_interes', punto_de_interes: 'punto_interes',
};

const VALORES_INACTIVO = new Set(['0', 'no', 'n', 'false', 'falso', 'inactivo', 'inactiva', 'baja', 'i']);
const VALORES_ACTIVO = new Set(['1', 'si', 's', 'true', 'verdadero', 'activo', 'activa', 'alta', 'a', 'yes', 'y']);

/** Parte texto delimitado en registros y campos respetando comillas (`""` = comilla). */
function partirDelimitado(texto: string, sep: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else comillas = false; } else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo); campo = '';
      if (fila.some((x) => x.trim() !== '')) filas.push(fila);
      fila = [];
    } else campo += c;
  }
  fila.push(campo);
  if (fila.some((x) => x.trim() !== '')) filas.push(fila);
  return filas;
}

function detectarSeparador(primeraLinea: string): string {
  const cuenta = (s: string) => primeraLinea.split(s).length - 1;
  const c = [[',', cuenta(',')], [';', cuenta(';')], ['\t', cuenta('\t')]] as const;
  return [...c].sort((a, b) => b[1] - a[1])[0]![0];
}

function aNumero(v: unknown): number | null | 'invalido' {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 'invalido';
  const t = String(v).trim();
  if (t === '') return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : 'invalido';
}

function aActivo(v: unknown): boolean | 'invalido' {
  if (v === null || v === undefined || String(v).trim() === '') return true;
  if (typeof v === 'boolean') return v;
  const t = clave(String(v));
  if (VALORES_INACTIVO.has(t)) return false;
  if (VALORES_ACTIVO.has(t)) return true;
  return 'invalido';
}

function texto(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
}

function construirFila(linea: number, r: Record<string, unknown>, errores: ErrorCatalogo[]): FilaCatalogo | null {
  const nombre = texto(r.nombre);
  if (!nombre) { errores.push({ linea, mensaje: 'Falta el nombre.' }); return null; }
  const lat = aNumero(r.lat);
  const lng = aNumero(r.lng);
  const radio = aNumero(r.radio_m);
  const activo = aActivo(r.activo);
  if (lat === 'invalido' || lng === 'invalido') { errores.push({ linea, mensaje: 'La latitud o la longitud no es un número.' }); return null; }
  if (radio === 'invalido') { errores.push({ linea, mensaje: 'El radio no es un número.' }); return null; }
  if (activo === 'invalido') { errores.push({ linea, mensaje: `No entiendo el estatus «${String(r.activo)}»: usa activo o inactivo.` }); return null; }
  const tipoTxt = texto(r.tipo);
  let tipo: TipoSitio | null = null;
  if (tipoTxt) {
    tipo = TIPOS[clave(tipoTxt)] ?? null;
    if (!tipo) { errores.push({ linea, mensaje: `No reconozco el tipo «${tipoTxt}».` }); return null; }
  }
  return { linea, nombre, codigo: texto(r.codigo), lat, lng, radio_m: radio, activo, terminal: texto(r.terminal), pais: texto(r.pais), direccion: texto(r.direccion), tipo };
}

/**
 * Lee el catálogo desde JSON (arreglo de objetos o `{ sitios|filas|catalogo: [...] }`) o CSV. Sin tope de filas.
 * Un registro ilegible se rechaza con «fila N: …» y no frena a los demás.
 */
export function leerCatalogo(textoEntrada: string): ResultadoLectura {
  const errores: ErrorCatalogo[] = [];
  const filas: FilaCatalogo[] = [];
  const t = textoEntrada.replace(/^﻿/, '').trim();
  if (t === '') return { filas, errores: [{ linea: 0, mensaje: 'El archivo está vacío.' }] };

  if (t.startsWith('[') || t.startsWith('{')) {
    let json: unknown;
    try { json = JSON.parse(t); } catch { return { filas, errores: [{ linea: 0, mensaje: 'El JSON no se puede leer.' }] }; }
    const lista = Array.isArray(json) ? json
      : (json && typeof json === 'object' ? ((json as Record<string, unknown>).sitios ?? (json as Record<string, unknown>).filas ?? (json as Record<string, unknown>).catalogo) : null);
    if (!Array.isArray(lista)) return { filas, errores: [{ linea: 0, mensaje: 'El JSON debe ser un arreglo de sitios.' }] };
    lista.forEach((el, i) => {
      const linea = i + 1;
      if (!el || typeof el !== 'object' || Array.isArray(el)) { errores.push({ linea, mensaje: 'El registro no es un objeto.' }); return; }
      const r: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(el as Record<string, unknown>)) { const a = ALIAS_COLUMNA[clave(k)]; if (a) r[a] = v; }
      const f = construirFila(linea, r, errores);
      if (f) filas.push(f);
    });
    return { filas, errores };
  }

  const primera = t.split(/\r?\n/, 1)[0] ?? '';
  const registros = partirDelimitado(t, detectarSeparador(primera));
  const cabecera = (registros[0] ?? []).map((c) => ALIAS_COLUMNA[clave(c)] ?? null);
  if (!cabecera.includes('nombre')) return { filas, errores: [{ linea: 1, mensaje: 'Falta la columna «nombre».' }] };
  for (let i = 1; i < registros.length; i++) {
    const linea = i + 1;
    const r: Record<string, unknown> = {};
    (registros[i] ?? []).forEach((v, j) => { const col = cabecera[j]; if (col && !(col in r)) r[col] = v; });
    const f = construirFila(linea, r, errores);
    if (f) filas.push(f);
  }
  return { filas, errores };
}

const esMexico = (pais: string | null): boolean => {
  if (!pais) return true;
  const p = normalizarNombre(pais);
  return p === '' || p === 'mx' || p === 'mexico' || p === 'mex';
};

/** Motivos por los que las coordenadas NO se pueden usar para validar una llegada. Vacío = coordenadas confiables. */
export function motivosCoordenadas(f: Pick<FilaCatalogo, 'lat' | 'lng' | 'pais'>): string[] {
  const { lat, lng } = f;
  if (lat === null || lng === null) return ['sin coordenadas'];
  if (!coordenadasValidas(lat, lng)) return ['coordenadas fuera de rango'];
  if (lat === 0 && lng === 0) return ['coordenadas (0, 0)'];
  if (esMexico(f.pais) && !dentroDeMexico(lat, lng)) return ['fuera de México sin país extranjero declarado'];
  return [];
}

export interface GrupoDuplicado {
  /** Líneas del archivo, ascendentes. */
  lineas: number[];
  motivos: Array<'mismo_nombre' | 'cerca_100m'>;
}

export interface ItemValidacion {
  linea: number;
  nombre: string;
  /** Por qué se revisa: «por validar», «posible duplicado» o «revisión de rutina». */
  razon: 'por_validar' | 'posible_duplicado' | 'rutina';
  detalle: string | null;
}

export interface DiaValidacion { dia: number; items: ItemValidacion[] }
export interface ListaTerminal { terminal: string; total: number; dias: DiaValidacion[] }

export interface ResumenCatalogo {
  total: number;
  activas: number;
  inactivas: number;
  listas: number;
  porValidar: number;
  filasEnDuplicados: number;
  gruposDuplicados: number;
  extranjeras: number;
}

export interface AnalisisCatalogo {
  resumen: ResumenCatalogo;
  /** Filas con coordenadas confiables, ACTIVAS y sin candidato a duplicado dudoso de coordenadas, listas para importar. */
  listas: SitioCsv[];
  porValidar: Array<{ linea: number; nombre: string; motivos: string[] }>;
  duplicados: GrupoDuplicado[];
  validacion: ListaTerminal[];
  cupoDiario: number;
  radioPorDefectoM: number;
}

export interface OpcionesAnalisis {
  cupoDiario?: number;
  radioPorDefectoM?: number;
}

export function cupoValido(n: number | undefined): number {
  if (n === undefined || !Number.isFinite(n)) return CUPO_DEFECTO;
  return Math.min(CUPO_MAX, Math.max(CUPO_MIN, Math.round(n)));
}

/** Código determinista para una fila sin código: la misma fila da siempre el mismo código (la reimportación no duplica). */
export function codigoDerivado(nombre: string, lat: number, lng: number): string {
  const base = `${normalizarNombre(nombre)}|${lat.toFixed(5)}|${lng.toFixed(5)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < base.length; i++) { h ^= base.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `CAT-${h.toString(36).toUpperCase().padStart(7, '0')}`;
}

class UnionFind {
  private p: number[];
  constructor(n: number) { this.p = Array.from({ length: n }, (_, i) => i); }
  find(x: number): number { while (this.p[x] !== x) { this.p[x] = this.p[this.p[x]!]!; x = this.p[x]!; } return x; }
  union(a: number, b: number): void { const ra = this.find(a); const rb = this.find(b); if (ra !== rb) this.p[Math.max(ra, rb)] = Math.min(ra, rb); }
}

/** Grados de latitud que miden la distancia de duplicado; la celda de la rejilla es de ese tamaño en latitud (≈111 m). */
const CELDA_GRADOS = 0.001;

/**
 * Tamaño de la celda en longitud para una banda de latitud: un grado de longitud mide menos a mayor latitud
 * (cos φ), así que se ensancha en grados para seguir midiendo ≥ la distancia de duplicado. Se usa la latitud
 * más alta de la banda (cos mínimo) para no quedarse corto. Depende solo de la banda, de modo que el vecino
 * de cualquier fila se localiza recalculando la celda con la banda vecina.
 */
function celdaLngGrados(bandaLat: number): number {
  const latMax = Math.min(89, Math.max(Math.abs(bandaLat * CELDA_GRADOS), Math.abs((bandaLat + 1) * CELDA_GRADOS)));
  return CELDA_GRADOS / Math.cos((latMax * Math.PI) / 180);
}

export function analizarCatalogo(filas: readonly FilaCatalogo[], opciones: OpcionesAnalisis = {}): AnalisisCatalogo {
  const cupoDiario = cupoValido(opciones.cupoDiario);
  const radioPorDefectoM = opciones.radioPorDefectoM && opciones.radioPorDefectoM > 0 ? Math.round(opciones.radioPorDefectoM) : RADIO_DEFECTO_M;
  const n = filas.length;
  const motivosCoord = filas.map((f) => motivosCoordenadas(f));

  // ── Candidatos a duplicado: nombre normalizado o ≤ 100 m (solo entre coordenadas confiables) ──
  const uf = new UnionFind(n);
  const aristas: Array<[number, number, 'mismo_nombre' | 'cerca_100m']> = [];

  const porNombre = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const k = normalizarNombre(filas[i]!.nombre);
    if (k === '') continue;
    const previo = porNombre.get(k);
    if (previo === undefined) porNombre.set(k, i);
    else { uf.union(previo, i); aristas.push([previo, i, 'mismo_nombre']); }
  }

  const rejilla = new Map<string, number[]>();
  const banda = (lat: number): number => Math.floor(lat / CELDA_GRADOS);
  const columna = (b: number, lng: number): number => Math.floor(lng / celdaLngGrados(b));
  for (let i = 0; i < n; i++) {
    if (motivosCoord[i]!.length > 0) continue;
    const f = filas[i]!;
    const cy = banda(f.lat!);
    for (let dy = -1; dy <= 1; dy++) {
      const cxVecina = columna(cy + dy, f.lng!);
      for (let dx = -1; dx <= 1; dx++) {
        for (const j of rejilla.get(`${cy + dy}:${cxVecina + dx}`) ?? []) {
          const g = filas[j]!;
          if (haversineM({ lat: f.lat!, lng: f.lng! }, { lat: g.lat!, lng: g.lng! }) <= DISTANCIA_DUPLICADO_M) { uf.union(j, i); aristas.push([j, i, 'cerca_100m']); }
        }
      }
    }
    const k = `${cy}:${columna(cy, f.lng!)}`;
    const lista = rejilla.get(k);
    if (lista) lista.push(i); else rejilla.set(k, [i]);
  }

  const miembros = new Map<number, { idx: Set<number>; motivos: Set<'mismo_nombre' | 'cerca_100m'> }>();
  for (const [a, b, m] of aristas) {
    const raiz = uf.find(a);
    const g = miembros.get(raiz) ?? { idx: new Set<number>(), motivos: new Set<'mismo_nombre' | 'cerca_100m'>() };
    g.idx.add(a); g.idx.add(b); g.motivos.add(m);
    miembros.set(raiz, g);
  }
  const duplicados: GrupoDuplicado[] = [];
  const enDuplicado = new Set<number>();
  for (const g of miembros.values()) {
    const idx = [...g.idx].sort((x, y) => x - y);
    idx.forEach((i) => enDuplicado.add(i));
    duplicados.push({ lineas: idx.map((i) => filas[i]!.linea), motivos: [...g.motivos].sort() });
  }
  duplicados.sort((a, b) => a.lineas[0]! - b.lineas[0]!);

  // ── Listas y por validar ──
  const listas: SitioCsv[] = [];
  const porValidar: AnalisisCatalogo['porValidar'] = [];
  let activas = 0;
  let extranjeras = 0;
  for (let i = 0; i < n; i++) {
    const f = filas[i]!;
    if (f.activo) activas++;
    if (!esMexico(f.pais)) extranjeras++;
    if (motivosCoord[i]!.length > 0) { porValidar.push({ linea: f.linea, nombre: f.nombre, motivos: motivosCoord[i]! }); continue; }
    if (!f.activo) continue;
    listas.push({
      linea: f.linea, codigo: f.codigo ?? codigoDerivado(f.nombre, f.lat!, f.lng!), nombre: f.nombre, tipo: f.tipo ?? 'punto_interes',
      lat: f.lat!, lng: f.lng!, radio_m: f.radio_m && f.radio_m > 0 ? f.radio_m : radioPorDefectoM,
      direccion: f.direccion, cliente: null, padre: null,
    });
  }

  // ── Lista de validación por terminal con cupo diario ──
  const porTerminal = new Map<string, ItemValidacion[][]>(); // [por_validar, duplicado, rutina]
  for (let i = 0; i < n; i++) {
    const f = filas[i]!;
    const mot = motivosCoord[i]!;
    const dup = enDuplicado.has(i);
    if (mot.length === 0 && !dup && !f.activo) continue;
    const terminal = !esMexico(f.pais) ? TERMINAL_EXTRANJERO : (f.terminal ?? TERMINAL_SIN_ASIGNAR);
    const cubos = porTerminal.get(terminal) ?? [[], [], []];
    const item: ItemValidacion = mot.length > 0
      ? { linea: f.linea, nombre: f.nombre, razon: 'por_validar', detalle: mot.join('; ') }
      : dup ? { linea: f.linea, nombre: f.nombre, razon: 'posible_duplicado', detalle: null }
        : { linea: f.linea, nombre: f.nombre, razon: 'rutina', detalle: null };
    cubos[mot.length > 0 ? 0 : dup ? 1 : 2]!.push(item);
    porTerminal.set(terminal, cubos);
  }
  const validacion: ListaTerminal[] = [...porTerminal.entries()]
    .sort(([a], [b]) => (a === TERMINAL_EXTRANJERO ? 1 : b === TERMINAL_EXTRANJERO ? -1 : a === TERMINAL_SIN_ASIGNAR ? 1 : b === TERMINAL_SIN_ASIGNAR ? -1 : a.localeCompare(b, 'es')))
    .map(([terminal, cubos]) => {
      const todos = cubos.flat();
      const dias: DiaValidacion[] = [];
      for (let k = 0; k < todos.length; k += cupoDiario) dias.push({ dia: dias.length + 1, items: todos.slice(k, k + cupoDiario) });
      return { terminal, total: todos.length, dias };
    });

  return {
    resumen: {
      total: n, activas, inactivas: n - activas, listas: listas.length, porValidar: porValidar.length,
      filasEnDuplicados: enDuplicado.size, gruposDuplicados: duplicados.length, extranjeras,
    },
    listas, porValidar, duplicados, validacion, cupoDiario, radioPorDefectoM,
  };
}

/** Parte las filas listas en lotes que el importador de la base acepta. */
export function enLotes<T>(filas: readonly T[], tamano: number = TAMANO_LOTE): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < filas.length; i += tamano) lotes.push(filas.slice(i, i + tamano));
  return lotes;
}
