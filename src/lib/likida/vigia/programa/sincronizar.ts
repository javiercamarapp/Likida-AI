// ═══════════════════════════════════════════════════════════════════════════
// SINCRONIZAR EL PROGRAMA DE DESPACHO (T-A4-06).
//
// El programa de cada terminal es un Excel que se llena a mano y que CAMBIA
// después de avisar («todavía me los pueden cambiar», levantamiento 747a3730
// ~02:40). Esta pieza guarda cada carga sin duplicar nada y deja escrito QUÉ
// campo cambió en QUÉ fila, que es lo que permite avisar de nuevo solo cuando
// de verdad hay algo distinto.
//
//   · Misma subida (mismo sha256, misma terminal) → «ya estaba cargado», cero
//     escrituras, SOLO si fue la última carga de la terminal (A37-A4-01: A → B → A
//     revierte el programa y debe aplicarse; se reabre la carga vieja, no se crea otra). Dos cargas simultáneas del mismo archivo: la base deja pasar
//     a una (llave única) y la otra recibe lo mismo.
//   · Identidad de fila = `clave_natural` = fecha|tipo|bloque|número («#»), así
//     que reordenar filas dentro de una sección no genera cambios.
//   · Solo se registran cambios en caja, unidad, ccp, tránsito, cita,
//     consignatario y cliente (más la reaparición de una fila oculta).
//   · Una fila que ya no viene se oculta (`visible = false`), nunca se borra.
//     «Ya no viene» solo se juzga dentro del rango de fechas que el archivo
//     cubre: los días que el archivo ya no trae por antigüedad no se tocan.
//   · Si la sincronización falla a medias, se deshace el reclamo de la carga
//     para que el reintento no quede bloqueado por un «ya estaba cargado» falso.
//     Los cambios se escriben ANTES que las filas: un fallo puede
//     repetir una línea de cambio en el reintento, pero nunca perder un cambio.
//
// No hace lógica de negocio (qué está «listo», a quién se avisa): eso es de
// quien lea `programa_despacho_cambio`.
// ═══════════════════════════════════════════════════════════════════════════
import { createHash } from 'node:crypto';
import type { ResultadoLector } from './lector';
import type { FilaPrograma, ProgramaNormalizado } from './normalizar';
import type {
  CambioParaGuardar, FilaGuardada, FilaParaGuardar, OrigenCarga, RepoPrograma,
} from './repo';

/** Una fila normalizada más el bloque (subtítulo/ruta de la sección) que el normalizador no conserva. */
export type FilaConBloque = FilaPrograma & { bloque: string | null };

export interface LecturaPrograma {
  /** sha256 hex del archivo tal como se subió. */
  sha256: string;
  origen: OrigenCarga;
  /** Filas crudas que entregó el lector. */
  filasLeidas: number;
  filas: FilaConBloque[];
  /** Resumen acotado de calidad (códigos de aviso y cuántas veces), sin valores del archivo. */
  avisos?: Array<{ codigo: string; cuantas: number }>;
  creadoPor?: string | null;
}

export interface DepsSincronizar {
  repo: RepoPrograma;
  /** Reloj inyectable (pruebas). */
  ahora?: () => Date;
}

export interface ResultadoSincronizacion {
  /** true: el archivo ya estaba cargado y no se tocó nada. */
  yaCargado: boolean;
  nuevas: number;
  cambiadas: number;
  sinCambio: number;
  desaparecidas: number;
  /** Filas sin fecha de sección: no se pueden guardar (la fecha es parte de su identidad). */
  sinFecha: number;
  /** Filas cuya clave se repetía dentro del archivo (se les agregó un sufijo para no pisarse). */
  clavesRepetidas: number;
  /** Cuántos campos cambiados se registraron en la historia. */
  camposCambiados: number;
}

const VACIO: ResultadoSincronizacion = {
  yaCargado: false, nuevas: 0, cambiadas: 0, sinCambio: 0, desaparecidas: 0, sinFecha: 0, clavesRepetidas: 0, camposCambiados: 0,
};

export function sha256Hex(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}

/**
 * Une lo que entregan el lector y el normalizador en lo que `sincronizarPrograma` necesita.
 * El bloque es la ruta del título de la sección (Doméstico y Mov. vacío); null en el resto.
 */
export function armarLectura(
  lector: Pick<ResultadoLector, 'filas' | 'secciones' | 'avisos'>,
  normalizado: ProgramaNormalizado,
  datos: { sha256: string; origen: OrigenCarga; creadoPor?: string | null },
): LecturaPrograma {
  const bloquePorLinea = new Map<number, string | null>();
  for (const f of lector.filas) bloquePorLinea.set(f.lineaCsv, lector.secciones[f.seccion]?.ruta ?? null);
  const cuentas = new Map<string, number>();
  const sumar = (codigo: string) => cuentas.set(codigo, (cuentas.get(codigo) ?? 0) + 1);
  for (const a of lector.avisos) sumar(`lector:${a.codigo}`);
  for (const f of normalizado.filas) for (const a of f.avisos) sumar(`fila:${a.codigo}`);
  if (normalizado.calidad.descartadas.length > 0) cuentas.set('fila:descartada', normalizado.calidad.descartadas.length);
  return {
    sha256: datos.sha256, origen: datos.origen, creadoPor: datos.creadoPor ?? null,
    filasLeidas: normalizado.calidad.leidas,
    filas: normalizado.filas.map((f) => ({ ...f, bloque: bloquePorLinea.get(f.lineaCsv) ?? null })),
    avisos: [...cuentas.entries()].map(([codigo, cuantas]) => ({ codigo, cuantas })),
  };
}

// ── Clave natural y huella ──────────────────────────────────────────────────

/**
 * fecha|tipo|bloque|número; sin «#» cae a la caja (c:), luego a la unidad (u:), y como último recurso a la línea del archivo (l:).
 * Las repetidas dentro del mismo archivo llevan «~2», «~3»… (la primera conserva la clave limpia).
 */
export function clavesNaturales(filas: FilaConBloque[]): { claves: string[]; repetidas: number } {
  const vistas = new Map<string, number>();
  let repetidas = 0;
  const claves = filas.map((f) => {
    const id = f.num !== null ? String(f.num)
      : f.caja !== null ? `c:${f.caja}`
        : f.unidad !== null ? `u:${f.unidad}`
          : `l:${f.lineaCsv}`;
    const base = `${f.fecha}|${f.tipo}|${f.bloque ?? ''}|${id}`;
    const n = (vistas.get(base) ?? 0) + 1;
    vistas.set(base, n);
    if (n === 1) return base;
    repetidas++;
    return `${base}~${n}`;
  });
  return { claves, repetidas };
}

/** Un instante comparable sin importar el desfase con el que venga («...-06:00» o «...+00:00» de la base). */
function instante(iso: string | null): string | null {
  if (iso === null) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : new Date(t).toISOString();
}

/** Los campos que se vigilan, tal como se comparan y se registran. */
type ValoresVigilados = {
  caja: string | null; unidad: string | null; ccp: string; transito: string;
  cita_en: string | null; cita_texto: string | null; consignatario: string | null; cliente: string | null;
};

const CAMPOS_VIGILADOS: ReadonlyArray<keyof ValoresVigilados> = [
  'caja', 'unidad', 'ccp', 'transito', 'cita_en', 'cita_texto', 'consignatario', 'cliente',
];

function vigiladosDeFila(f: FilaPrograma): ValoresVigilados {
  return {
    caja: f.caja, unidad: f.unidad, ccp: f.ccp, transito: f.transito, cita_en: instante(f.citaEn),
    cita_texto: f.citaTexto, consignatario: f.consignatario, cliente: f.cliente,
  };
}

function vigiladosDeGuardada(g: FilaGuardada): ValoresVigilados {
  return {
    caja: g.caja, unidad: g.unidad, ccp: g.ccp, transito: g.transito, cita_en: instante(g.citaEn),
    cita_texto: g.citaTexto, consignatario: g.consignatario, cliente: g.cliente,
  };
}

export function huellaDe(v: ValoresVigilados): string {
  return createHash('sha256').update(JSON.stringify(CAMPOS_VIGILADOS.map((c) => v[c]))).digest('hex').slice(0, 32);
}

// ── Sincronización ──────────────────────────────────────────────────────────

export async function sincronizarPrograma(
  tenantId: string, terminal: string, lectura: LecturaPrograma, deps: DepsSincronizar,
): Promise<ResultadoSincronizacion> {
  if (!tenantId) throw new Error('sincronizarPrograma: falta el tenant');
  const term = terminal.trim();
  if (term === '') throw new Error('sincronizarPrograma: falta la terminal');
  if (!/^[0-9a-f]{64}$/.test(lectura.sha256)) throw new Error('sincronizarPrograma: el sha256 del archivo no es válido');
  const { repo } = deps;
  const ahora = (deps.ahora ?? (() => new Date()))().toISOString();

  const conFecha = lectura.filas.filter((f): f is FilaConBloque & { fecha: string } => f.fecha !== null);
  const sinFecha = lectura.filas.length - conFecha.length;
  const { claves, repetidas } = clavesNaturales(conFecha);

  let carga = await repo.registrarCarga(tenantId, {
    terminal: term, origen: lectura.origen, archivoSha256: lectura.sha256,
    filasLeidas: lectura.filasLeidas, filasValidas: lectura.filas.length,
    avisos: (lectura.avisos ?? []).slice(0, 200), creadoPor: lectura.creadoPor ?? null,
  });
  let anterior: string | null = null;
  if (carga === null) {
    // A37-A4-01: «mismo sha» solo es «ya cargado» si fue la ÚLTIMA carga; A → B → A es un cambio real.
    const reabierta = await repo.reabrirCargaSiNoEsUltima(tenantId, term, lectura.sha256);
    if (reabierta === null) return { ...VACIO, yaCargado: true };
    carga = { id: reabierta.id };
    anterior = reabierta.creadaAnterior;
  }

  try {
    return await aplicar(repo, tenantId, term, carga.id, ahora, conFecha, claves, { sinFecha, repetidas });
  } catch (e) {
    // Sin esto el reintento chocaría con la llave única y se leería «ya estaba cargado» sin estarlo.
    try {
      if (anterior !== null) await repo.restaurarCarga(tenantId, carga.id, anterior);
      else await repo.descartarCarga(tenantId, carga.id);
    } catch { /* el error original es el que importa */ }
    throw e;
  }
}

async function aplicar(
  repo: RepoPrograma, tenantId: string, terminal: string, cargaId: string, ahora: string,
  filas: Array<FilaConBloque & { fecha: string }>, claves: string[],
  extra: { sinFecha: number; repetidas: number },
): Promise<ResultadoSincronizacion> {
  const res: ResultadoSincronizacion = { ...VACIO, sinFecha: extra.sinFecha, clavesRepetidas: extra.repetidas };
  if (filas.length === 0) return res;

  let desde = filas[0].fecha;
  let hasta = filas[0].fecha;
  for (const f of filas) { if (f.fecha < desde) desde = f.fecha; if (f.fecha > hasta) hasta = f.fecha; }

  const guardadas = await repo.filasEnRango(tenantId, terminal, desde, hasta);
  const porClave = new Map(guardadas.map((g) => [g.claveNatural, g]));

  const nuevas: FilaParaGuardar[] = [];
  const existentes: FilaParaGuardar[] = [];
  const cambios: CambioParaGuardar[] = [];
  const enArchivo = new Set<string>();

  filas.forEach((f, i) => {
    const claveNatural = claves[i];
    enArchivo.add(claveNatural);
    const v = vigiladosDeFila(f);
    const paraGuardar: FilaParaGuardar = {
      cargaId, terminal, fecha: f.fecha, tipo: f.tipo, bloque: f.bloque, num: f.num, claveNatural,
      cliente: f.cliente, consignatario: f.consignatario, linea: f.linea, caja: f.caja, unidad: f.unidad,
      citaEn: f.citaEn, citaTexto: f.citaTexto, transito: f.transito, ccp: f.ccp, comentarios: f.comentarios,
      huella: huellaDe(v), vistaEn: ahora,
    };
    const previa = porClave.get(claveNatural);
    if (!previa) { nuevas.push(paraGuardar); res.nuevas++; return; }

    existentes.push(paraGuardar);
    const delta: CambioParaGuardar[] = [];
    if (previa.huella !== paraGuardar.huella) {
      const antes = vigiladosDeGuardada(previa);
      for (const campo of CAMPOS_VIGILADOS) {
        if (antes[campo] !== v[campo]) {
          delta.push({ filaId: previa.id, campo, antes: antes[campo], despues: v[campo], cargaId });
        }
      }
    }
    if (!previa.visible) delta.push({ filaId: previa.id, campo: 'visible', antes: 'false', despues: 'true', cargaId });
    if (delta.length > 0) { res.cambiadas++; cambios.push(...delta); } else res.sinCambio++;
  });

  const desaparecidas = guardadas.filter((g) => g.visible && !enArchivo.has(g.claveNatural));
  for (const g of desaparecidas) cambios.push({ filaId: g.id, campo: 'visible', antes: 'true', despues: 'false', cargaId });
  res.desaparecidas = desaparecidas.length;
  res.camposCambiados = cambios.length;

  // Cambios primero (ver encabezado): un fallo repite una línea, nunca pierde un cambio.
  if (cambios.length > 0) await repo.registrarCambios(tenantId, cambios);
  if (nuevas.length > 0) await repo.insertarFilas(tenantId, nuevas);
  if (existentes.length > 0) await repo.actualizarFilas(tenantId, existentes);
  if (desaparecidas.length > 0) await repo.ocultarFilas(tenantId, desaparecidas.map((g) => g.id), cargaId);
  return res;
}
