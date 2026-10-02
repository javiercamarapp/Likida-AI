import { celdaTexto, detectarColumnas, esFilaDeEjemplo, filaVacia, normalizarEncabezado, TOPE_FILAS_IMPORTACION } from '../importacion/archivo';
import {
  ETIQUETA_CATEGORIA, MAX_INSTRUCCIONES_POR_CONVENIO, MAX_TEXTO_INSTRUCCION, MODOS_TARIFA,
  esCategoria, esLugar, esMomento, type Categoria, type Instruccion, type Lugar, type ModoTarifa, type Momento,
} from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// EL IMPORTADOR Y LA EXPORTACIÓN DE CONVENIOS — puro: de la matriz de un CSV/Excel a convenios validados.
//
// UNA FILA POR INSTRUCCIÓN. Las filas con el mismo (cliente, convenio) forman un solo convenio; los datos del
// convenio (A, B, vigencia, tarifa) pueden ir en la primera fila o repetirse (si se repiten, deben coincidir).
// Una fila sin categoría ni instrucción solo define el convenio. Re-subir el mismo archivo no duplica nada: la
// llave es (cliente, nombre del convenio), y la lista de instrucciones del archivo REEMPLAZA la del convenio.
//
// TODO O NADA: un solo problema en el archivo y no se escribe nada (como el catálogo de sitios).
// La tarifa y los requisitos de cobro son DINERO: solo los lee quien ve finanzas, y la exportación para el sistema
// de la flota (la «calle de instrucciones») NO los lleva.
// ═══════════════════════════════════════════════════════════════════════════

export const COLUMNAS_CONVENIO = {
  cliente: ['cliente', 'razon social', 'nombre del cliente'],
  convenio: ['convenio', 'nombre del convenio', 'perfil', 'nombre convenio'],
  origen: ['origen', 'punto a', 'a', 'cargar en', 'carga'],
  destino: ['destino', 'punto b', 'b', 'descargar en', 'descarga'],
  sitio_origen: ['sitio origen', 'sitio de origen', 'codigo sitio origen', 'planta origen'],
  sitio_destino: ['sitio destino', 'sitio de destino', 'codigo sitio destino', 'planta destino'],
  vigente_desde: ['vigente desde', 'inicio', 'desde', 'vigencia inicio'],
  vigente_hasta: ['vigente hasta', 'fin', 'hasta', 'vigencia fin'],
  notas: ['notas', 'comentarios', 'observaciones'],
  tarifa_modo: ['tarifa modo', 'modo de tarifa', 'tarifa por', 'modo tarifa'],
  tarifa_precio: ['tarifa precio', 'tarifa', 'precio', 'precio de tarifa'],
  moneda: ['moneda', 'tarifa moneda'],
  requisitos_cobro: ['requisitos de cobro', 'requisitos cobro', 'requisitos para cobrar', 'cobro'],
  categoria: ['categoria', 'tipo de instruccion', 'tipo'],
  instruccion: ['instruccion', 'texto', 'indicacion', 'instrucciones'],
  momento: ['momento', 'cuando', 'cuando se manda'],
  lugar: ['lugar', 'planta', 'aplica a', 'en'],
  orden: ['orden'],
} as const satisfies Record<string, readonly string[]>;

type Col = keyof typeof COLUMNAS_CONVENIO;

export const ENCABEZADOS_PLANTILLA_CONVENIOS: readonly string[] = [
  'cliente', 'convenio', 'origen', 'destino', 'sitio_origen', 'sitio_destino', 'vigente_desde', 'vigente_hasta', 'notas',
  'categoria', 'instruccion', 'momento', 'lugar', 'orden',
];
export const ENCABEZADOS_PLANTILLA_CONVENIOS_FINANZAS: readonly string[] = [
  ...ENCABEZADOS_PLANTILLA_CONVENIOS, 'tarifa_modo', 'tarifa_precio', 'moneda', 'requisitos_cobro',
];

export interface ComercialImportado {
  modo: ModoTarifa | null;
  precio: number | null;
  moneda: 'MXN' | 'USD';
  requisitos: string[];
}

export interface ConvenioImportado {
  /** Primera fila del archivo en que aparece (1 = encabezado). */
  linea: number;
  cliente: string;
  nombre: string;
  origen: string | null;
  destino: string | null;
  sitioOrigen: string | null;
  sitioDestino: string | null;
  vigenteDesde: string | null;
  vigenteHasta: string | null;
  notas: string | null;
  /** `null` = el archivo no trae nada de dinero para este convenio (no se toca lo que ya hubiera). */
  comercial: ComercialImportado | null;
  instrucciones: Instruccion[];
}

export interface ErrorFila { fila: number; motivo: string }

export interface ResultadoImportacionConvenios {
  convenios: ConvenioImportado[];
  errores: ErrorFila[];
}

const llave = (t: string): string => normalizarEncabezado(t);

const ALIAS_CATEGORIA: Record<string, Categoria> = {
  puerta: 'puerta', acceso: 'puerta', entrada: 'puerta', 'por donde entrar': 'puerta', 'por donde entra': 'puerta',
  reportarse: 'reportarse', reporte: 'reportarse', 'con quien reportarse': 'reportarse', 'con quien se reporta': 'reportarse', contacto: 'reportarse',
  peculiaridad: 'peculiaridad', peculiaridades: 'peculiaridad', 'ten en cuenta': 'peculiaridad', particularidad: 'peculiaridad',
  documentos: 'documentos', documento: 'documentos', papeles: 'documentos',
  horario: 'horario', horarios: 'horario',
  seguridad: 'seguridad', epp: 'seguridad',
  otro: 'otro', otros: 'otro',
};
const ETIQUETA_A_CATEGORIA = new Map<string, Categoria>(
  (Object.entries(ETIQUETA_CATEGORIA) as Array<[Categoria, string]>).map(([c, e]) => [llave(e), c] as const),
);

const ALIAS_LUGAR: Record<string, Lugar> = {
  origen: 'origen', carga: 'origen', cargar: 'origen', 'punto a': 'origen', a: 'origen',
  destino: 'destino', descarga: 'destino', descargar: 'destino', 'punto b': 'destino', b: 'destino',
  ambos: 'ambos', ambas: 'ambos', todos: 'ambos', todas: 'ambos',
};
const ALIAS_MOMENTO: Record<string, Momento> = {
  despacho: 'despacho', 'al despachar': 'despacho',
  acercamiento: 'acercamiento', 'al acercarse': 'acercamiento', 'al llegar': 'acercamiento',
  ambos: 'ambos', ambas: 'ambos',
};
const ALIAS_MODO: Record<string, ModoTarifa> = {
  por_viaje: 'por_viaje', 'por viaje': 'por_viaje', viaje: 'por_viaje',
  por_km: 'por_km', 'por km': 'por_km', km: 'por_km', kilometro: 'por_km',
  por_tonelada: 'por_tonelada', 'por tonelada': 'por_tonelada', tonelada: 'por_tonelada',
};

/** Fecha de la celda: ISO, dd/mm/aaaa o número de serie de Excel. `undefined` = no es fecha válida. */
function aFecha(crudo: unknown): string | null | undefined {
  if (crudo === null || crudo === undefined || String(crudo).trim() === '') return null;
  if (typeof crudo === 'number') {
    if (!Number.isFinite(crudo) || crudo < 1 || crudo > 80_000) return undefined;
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(crudo) * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  if (crudo instanceof Date) return Number.isNaN(crudo.getTime()) ? undefined : crudo.toISOString().slice(0, 10);
  const t = String(crudo).trim();
  let y: number; let m: number; let d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  const mx = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (iso) { y = Number(iso[1]); m = Number(iso[2]); d = Number(iso[3]); }
  else if (mx) { d = Number(mx[1]); m = Number(mx[2]); y = Number(mx[3]); }
  else return undefined;
  const f = new Date(Date.UTC(y, m - 1, d));
  if (f.getUTCFullYear() !== y || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return undefined;
  return f.toISOString().slice(0, 10);
}

function aPrecio(crudo: unknown): number | null | undefined {
  if (crudo === null || crudo === undefined || String(crudo).trim() === '') return null;
  if (typeof crudo === 'number') return Number.isFinite(crudo) && crudo > 0 ? Math.round(crudo * 100) / 100 : undefined;
  const t = String(crudo).replace(/[$\s]/g, '').replace(/,(?=\d{3}(\D|$))/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return undefined;
  const n = Number(t);
  return n > 0 ? n : undefined;
}

export function parsearMatrizConvenios(matriz: unknown[][], opciones: { puedeVerFinanzas: boolean }): ResultadoImportacionConvenios {
  const errores: ErrorFila[] = [];
  if (matriz.length === 0 || filaVacia(matriz[0])) return { convenios: [], errores: [{ fila: 0, motivo: 'El archivo está vacío.' }] };
  const idx = detectarColumnas(matriz[0] ?? [], COLUMNAS_CONVENIO);
  for (const c of ['cliente', 'convenio'] as const) {
    if (idx[c] === undefined) errores.push({ fila: 1, motivo: `Falta la columna «${c}» en el encabezado.` });
  }
  if (errores.length > 0) return { convenios: [], errores };
  const traeDinero = (['tarifa_modo', 'tarifa_precio', 'moneda', 'requisitos_cobro'] as Col[]).some((c) => idx[c] !== undefined);
  if (traeDinero && !opciones.puedeVerFinanzas) {
    return { convenios: [], errores: [{ fila: 1, motivo: 'El archivo trae tarifa o requisitos de cobro y solo quien ve finanzas puede importarlos. Quita esas columnas o pídele al dueño que lo suba.' }] };
  }
  if (matriz.length - 1 > TOPE_FILAS_IMPORTACION) {
    return { convenios: [], errores: [{ fila: TOPE_FILAS_IMPORTACION + 2, motivo: `El archivo trae más de ${TOPE_FILAS_IMPORTACION} filas: pártelo y sube el resto aparte.` }] };
  }

  const crudo = (fila: unknown[], c: Col): unknown => (idx[c] === undefined ? undefined : fila[idx[c] as number]);
  const texto = (fila: unknown[], c: Col, max: number): string => celdaTexto(crudo(fila, c), max);

  const porLlave = new Map<string, ConvenioImportado>();
  const vistasInstruccion = new Set<string>();

  for (let i = 1; i < matriz.length; i++) {
    const fila = matriz[i];
    if (filaVacia(fila) || esFilaDeEjemplo(fila)) continue;
    const n = i + 1;
    const cliente = texto(fila, 'cliente', 160);
    const nombre = texto(fila, 'convenio', 120);
    if (cliente === '') { errores.push({ fila: n, motivo: 'Falta el cliente.' }); continue; }
    if (nombre === '') { errores.push({ fila: n, motivo: 'Falta el nombre del convenio.' }); continue; }
    const k = `${llave(cliente)}|${llave(nombre)}`;

    // ── Los datos del convenio ──
    const desde = aFecha(crudo(fila, 'vigente_desde'));
    const hasta = aFecha(crudo(fila, 'vigente_hasta'));
    if (desde === undefined) { errores.push({ fila: n, motivo: 'La fecha «vigente desde» no se entiende (usa AAAA-MM-DD o DD/MM/AAAA).' }); continue; }
    if (hasta === undefined) { errores.push({ fila: n, motivo: 'La fecha «vigente hasta» no se entiende (usa AAAA-MM-DD o DD/MM/AAAA).' }); continue; }
    if (desde && hasta && hasta < desde) { errores.push({ fila: n, motivo: 'La vigencia termina antes de empezar.' }); continue; }

    let comercial: ComercialImportado | null = null;
    if (traeDinero) {
      const modoCrudo = llave(texto(fila, 'tarifa_modo', 30));
      const modo = modoCrudo === '' ? null : (ALIAS_MODO[modoCrudo] ?? null);
      if (modoCrudo !== '' && !modo) { errores.push({ fila: n, motivo: `El modo de tarifa «${modoCrudo}» no existe. Usa: ${MODOS_TARIFA.join(', ')}.` }); continue; }
      const precio = aPrecio(crudo(fila, 'tarifa_precio'));
      if (precio === undefined) { errores.push({ fila: n, motivo: 'La tarifa debe ser un número mayor a cero.' }); continue; }
      if ((modo === null) !== (precio === null)) { errores.push({ fila: n, motivo: 'La tarifa lleva modo y precio juntos: un precio sin unidad no se puede cotizar.' }); continue; }
      const monedaCruda = texto(fila, 'moneda', 5).toUpperCase();
      if (monedaCruda !== '' && monedaCruda !== 'MXN' && monedaCruda !== 'USD') { errores.push({ fila: n, motivo: 'La moneda es MXN o USD.' }); continue; }
      const requisitos = texto(fila, 'requisitos_cobro', 1000).split(/[|;]/).map((x) => x.trim()).filter((x) => x !== '').slice(0, 30);
      if (modo || requisitos.length > 0 || monedaCruda !== '') comercial = { modo, precio, moneda: monedaCruda === 'USD' ? 'USD' : 'MXN', requisitos };
    }

    const datos = {
      origen: texto(fila, 'origen', 160) || null,
      destino: texto(fila, 'destino', 160) || null,
      sitioOrigen: texto(fila, 'sitio_origen', 80) || null,
      sitioDestino: texto(fila, 'sitio_destino', 80) || null,
      vigenteDesde: desde, vigenteHasta: hasta,
      notas: texto(fila, 'notas', 1000) || null,
    };

    let conv = porLlave.get(k);
    if (!conv) {
      conv = { linea: n, cliente, nombre, ...datos, comercial, instrucciones: [] };
      porLlave.set(k, conv);
    } else {
      // Repetir los datos del convenio está bien; contradecirlos no.
      const choques = (Object.keys(datos) as Array<keyof typeof datos>).filter((c) => datos[c] !== null && conv![c] !== null && datos[c] !== conv![c]);
      if (choques.length > 0) {
        errores.push({ fila: n, motivo: `Dice algo distinto de la fila ${conv.linea} para el mismo convenio (${choques.join(', ')}).` });
        continue;
      }
      for (const c of Object.keys(datos) as Array<keyof typeof datos>) if (conv[c] === null && datos[c] !== null) (conv as unknown as Record<string, unknown>)[c] = datos[c];
      if (!conv.comercial && comercial) conv.comercial = comercial;
    }

    // ── La instrucción de la fila (opcional) ──
    const catCrudo = llave(texto(fila, 'categoria', 40));
    const textoIns = texto(fila, 'instruccion', MAX_TEXTO_INSTRUCCION + 1);
    if (catCrudo === '' && textoIns === '') continue;
    if (textoIns === '') { errores.push({ fila: n, motivo: 'Trae categoría pero no el texto de la instrucción.' }); continue; }
    if (textoIns.length > MAX_TEXTO_INSTRUCCION) { errores.push({ fila: n, motivo: `La instrucción pasa de ${MAX_TEXTO_INSTRUCCION} caracteres.` }); continue; }
    const categoria = catCrudo === '' ? 'otro' : (ALIAS_CATEGORIA[catCrudo] ?? ETIQUETA_A_CATEGORIA.get(catCrudo) ?? (esCategoria(catCrudo) ? catCrudo : null));
    if (!categoria) { errores.push({ fila: n, motivo: `La categoría «${catCrudo}» no existe. Usa: puerta, reportarse, peculiaridad, documentos, horario, seguridad u otro.` }); continue; }
    const momCrudo = llave(texto(fila, 'momento', 30));
    const momento = momCrudo === '' ? 'ambos' : (ALIAS_MOMENTO[momCrudo] ?? (esMomento(momCrudo) ? momCrudo : null));
    if (!momento) { errores.push({ fila: n, motivo: `El momento «${momCrudo}» no existe. Usa: despacho, acercamiento o ambos.` }); continue; }
    const lugCrudo = llave(texto(fila, 'lugar', 30));
    const lugar = lugCrudo === '' ? 'ambos' : (ALIAS_LUGAR[lugCrudo] ?? (esLugar(lugCrudo) ? lugCrudo : null));
    if (!lugar) { errores.push({ fila: n, motivo: `El lugar «${lugCrudo}» no existe. Usa: origen, destino o ambos.` }); continue; }
    const ordenCrudo = crudo(fila, 'orden');
    const ordenNum = ordenCrudo === undefined || String(ordenCrudo).trim() === '' ? conv.instrucciones.length : Number(ordenCrudo);
    if (!Number.isInteger(ordenNum) || ordenNum < 0 || ordenNum > 999) { errores.push({ fila: n, motivo: 'El orden es un entero de 0 a 999.' }); continue; }
    const dup = `${k}|${categoria}|${textoIns}`;
    if (vistasInstruccion.has(dup)) continue; // la misma instrucción dos veces es una (como la llave única de la base)
    vistasInstruccion.add(dup);
    if (conv.instrucciones.length >= MAX_INSTRUCCIONES_POR_CONVENIO) { errores.push({ fila: n, motivo: `Un convenio admite hasta ${MAX_INSTRUCCIONES_POR_CONVENIO} instrucciones.` }); continue; }
    conv.instrucciones.push({ categoria, texto: textoIns, momento, lugar, orden: ordenNum });
  }

  if (errores.length === 0 && porLlave.size === 0) errores.push({ fila: 0, motivo: 'El archivo no trae ningún convenio.' });
  return { convenios: errores.length > 0 ? [] : [...porLlave.values()], errores };
}

// ── LA EXPORTACIÓN ──────────────────────────────────────────────────────────

export interface ConvenioExportable {
  cliente: string;
  nombre: string;
  origen: string | null;
  destino: string | null;
  vigenteDesde: string | null;
  vigenteHasta: string | null;
  notas: string | null;
  sitioOrigen?: string | null;
  sitioDestino?: string | null;
  instrucciones: Instruccion[];
  /** Solo para quien ve finanzas. La exportación «para el sistema de la flota» NUNCA lo incluye. */
  comercial?: ComercialImportado | null;
}

function celdaCsv(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Evita la inyección de fórmulas al abrir el CSV en Excel: una celda que empieza con = + - @ se pega como texto. */
function seguraParaExcel(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

/**
 * El CSV que se vuelve a subir tal cual (misma forma que la plantilla), con BOM para Excel en español.
 * `conFinanzas` añade tarifa y requisitos de cobro; sin él el archivo es seguro para entregárselo a operación.
 */
export function csvConvenios(convenios: readonly ConvenioExportable[], opciones: { conFinanzas: boolean }): string {
  const enc = opciones.conFinanzas ? ENCABEZADOS_PLANTILLA_CONVENIOS_FINANZAS : ENCABEZADOS_PLANTILLA_CONVENIOS;
  const filas: string[][] = [];
  for (const c of convenios) {
    const base = (i: Instruccion | null, primera: boolean): string[] => {
      const fila = [
        c.cliente, c.nombre, c.origen ?? '', c.destino ?? '', c.sitioOrigen ?? '', c.sitioDestino ?? '', c.vigenteDesde ?? '', c.vigenteHasta ?? '', c.notas ?? '',
        i ? i.categoria : '', i ? i.texto : '', i ? i.momento : '', i ? i.lugar : '', i ? String(i.orden) : '',
      ];
      if (opciones.conFinanzas) {
        const m = primera ? c.comercial : null;
        fila.push(m?.modo ?? '', m?.precio === null || m?.precio === undefined ? '' : String(m.precio), m ? m.moneda : '', m ? m.requisitos.join(' | ') : '');
      }
      return fila;
    };
    if (c.instrucciones.length === 0) filas.push(base(null, true));
    else c.instrucciones.forEach((i, n) => filas.push(base(i, n === 0)));
  }
  return '﻿' + [enc.slice(), ...filas].map((f) => f.map((v) => celdaCsv(seguraParaExcel(v))).join(',')).join('\r\n') + '\r\n';
}

/** El texto de UN convenio listo para pegarse en la «calle de instrucciones» del sistema de la flota. Sin dinero. */
export function textoParaSistemaDeLaFlota(c: ConvenioExportable): string {
  const cab = `${c.cliente} — ${c.nombre}${c.origen || c.destino ? ` (${c.origen ?? '?'} → ${c.destino ?? '?'})` : ''}`;
  if (c.instrucciones.length === 0) return `${cab}\n(sin instrucciones de operación registradas)`;
  const lineas = c.instrucciones.slice().sort((a, b) => a.orden - b.orden).map((i) => {
    const donde = i.lugar === 'origen' ? ' [al cargar]' : i.lugar === 'destino' ? ' [al descargar]' : '';
    return `- ${ETIQUETA_CATEGORIA[i.categoria]}${donde}: ${i.texto}`;
  });
  return `${cab}\n${lineas.join('\n')}`;
}

/** La plantilla descargable: encabezados + UNA fila de ejemplo marcada (el importador la descarta con su nombre). */
export function plantillaCsvConvenios(opciones: { conFinanzas: boolean }): string {
  const enc = opciones.conFinanzas ? ENCABEZADOS_PLANTILLA_CONVENIOS_FINANZAS : ENCABEZADOS_PLANTILLA_CONVENIOS;
  const ejemplo = ['Cliente de ejemplo', 'EJEMPLO — bórrame', 'Planta de ejemplo', 'CEDIS de ejemplo', '', '', '', '', '', 'puerta', 'Entra por la puerta 3', 'ambos', 'destino', '0'];
  if (opciones.conFinanzas) ejemplo.push('por_viaje', '5000', 'MXN', 'Factura | Carta porte');
  return '﻿' + [enc.slice(), ejemplo].map((f) => f.map(celdaCsv).join(',')).join('\r\n') + '\r\n';
}
