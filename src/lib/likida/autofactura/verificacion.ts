import { createHash } from 'node:crypto';
import type { GuionPortal, VerificacionDeGuion } from '../facturacion/adaptadores/guion';

// ═══════════════════════════════════════════════════════════════════════════
// EL ESTADO «VERIFICADO» DE UN PORTAL SE CALCULA, NO SE ESCRIBE A MANO.
//
// Antes `verificado` era un campo que alguien pegaba en `portales.ts` después de leer un
// reporte (y 21 de 21 siguen en `null`). Ahora hay DOS fuentes de verdad, independientes, y la
// pantalla las muestra por separado:
//
//   1. CONTRATO (lo calculan las pruebas, en cada push): el motor de verdad (AdaptadorDeclarativo
//      + Chromium) corre contra el HTML fixture del guion — llenar, parar en ensayo, leer el UUID,
//      leer el rechazo. Prueba que la TABLA de selectores es válida y que el motor la usa bien.
//      NO prueba que el portal real siga siendo así: los fixtures son `sintetico_desde_guion`
//      (derivados de la propia tabla) hasta que una corrida supervisada graba el DOM real.
//   2. REAL (lo calcula la corrida supervisada): `scripts/verificar-portal.mjs` visita el portal
//      REAL solo lectura y SOLO con confirmación humana explícita, deja evidencia (reporte,
//      captura, DOM saneado) y escribe una entrada en `verificaciones.json` con la huella del
//      guion que midió. Si alguien cambia un selector después, la huella ya no coincide y el
//      portal vuelve a «obsoleto»: lo medido era OTRA tabla.
//
// Un portal sin entrada vigente en el registro NO emite (`motivoSinVerificar`): ninguna prueba
// de contrato lo gradúa. «Verificado» solo lo dice una visita real.
// ═══════════════════════════════════════════════════════════════════════════

export type NivelVerificacion =
  /** Visita de solo lectura: los selectores del formulario EN BLANCO resolvieron. UUID/botón de emitir no se vieron. */
  | 'prevuelo';

export interface EvidenciaVerificacion {
  /** Ruta relativa a la raíz del repo del reporte de la corrida. */
  reporte: string;
  /** SHA-256 del archivo del reporte: cualquier edición posterior lo invalida. */
  sha256: string;
  /** Ruta de la captura, si hubo. */
  captura?: string;
}

export interface EntradaVerificacion {
  /** AAAA-MM-DD de la visita real. */
  fecha: string;
  nivel: NivelVerificacion;
  /** Huella de la tabla de selectores que se midió. Si el guion cambia, deja de valer. */
  huellaGuion: string;
  /** Qué arnés/comando lo midió. */
  arnes: string;
  /** Los chequeos (`que`) que resolvieron ese día. */
  resueltos: readonly string[];
  /** Quién confirmó la visita real (nombre o correo): sin él no hay entrada válida. */
  confirmadoPor: string;
  evidencia: EvidenciaVerificacion;
}

export type RegistroVerificaciones = Readonly<Record<string, EntradaVerificacion>>;

export type EstadoVerificacion =
  | { estado: 'no_verificado' }
  | { estado: 'verificado'; entrada: EntradaVerificacion }
  /** Hay entrada, pero es de OTRA versión de la tabla de selectores. */
  | { estado: 'obsoleto'; entrada: EntradaVerificacion };

/**
 * La huella de la TABLA de un guion: lo que decide qué se escribe, dónde se aprieta y qué se lee.
 * No incluye `verificado` ni `lecturaDeCampo` (metadatos), para que anotar la verificación no
 * cambie la huella que se verifica. Canónica: llaves ordenadas.
 */
export function huellaDeGuion(g: GuionPortal): string {
  const { verificado: _v, lecturaDeCampo: _l, ...tabla } = g;
  return createHash('sha256').update(canonico(tabla)).digest('hex');
}

function canonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

export function estadoVerificacion(g: GuionPortal, registro: RegistroVerificaciones): EstadoVerificacion {
  const e = registro[g.comercio];
  if (!e) return { estado: 'no_verificado' };
  return e.huellaGuion === huellaDeGuion(g) ? { estado: 'verificado', entrada: e } : { estado: 'obsoleto', entrada: e };
}

/**
 * El guion con su `verificado` DERIVADO del registro. Lo que el motor lee. Si el guion trae un
 * `verificado` escrito a mano en `portales.ts` NO cuenta: solo el registro (con evidencia) gradúa.
 */
export function guionConVerificacion(g: GuionPortal, registro: RegistroVerificaciones): GuionPortal {
  const v = estadoVerificacion(g, registro);
  const verificado: VerificacionDeGuion | null = v.estado === 'verificado'
    ? { fecha: v.entrada.fecha, arnes: v.entrada.arnes, resueltos: v.entrada.resueltos }
    : null;
  return { ...g, verificado };
}

/** Validación estructural del registro: lo que impide que alguien pegue una entrada sin visita. */
export function validarRegistro(
  registro: RegistroVerificaciones,
  guiones: readonly GuionPortal[],
  leerSha256: (rutaRelativa: string) => string | null,
): string[] {
  const problemas: string[] = [];
  for (const [comercio, e] of Object.entries(registro)) {
    const g = guiones.find((x) => x.comercio === comercio);
    if (!g) { problemas.push(`${comercio}: no existe un guion con esa clave`); continue; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.fecha)) problemas.push(`${comercio}: fecha inválida (${e.fecha})`);
    if (e.nivel !== 'prevuelo') problemas.push(`${comercio}: nivel desconocido (${String(e.nivel)})`);
    if (!/^[0-9a-f]{64}$/.test(e.huellaGuion)) problemas.push(`${comercio}: huellaGuion inválida`);
    if (!e.confirmadoPor || e.confirmadoPor.trim().length < 3) problemas.push(`${comercio}: falta quién confirmó la visita real (confirmadoPor)`);
    if (!Array.isArray(e.resueltos) || e.resueltos.length === 0) problemas.push(`${comercio}: no lista ningún chequeo resuelto`);
    if (!e.evidencia?.reporte) { problemas.push(`${comercio}: sin evidencia (reporte)`); continue; }
    const real = leerSha256(e.evidencia.reporte);
    if (real === null) problemas.push(`${comercio}: la evidencia ${e.evidencia.reporte} no existe en el repo`);
    else if (real !== e.evidencia.sha256) problemas.push(`${comercio}: la evidencia ${e.evidencia.reporte} cambió después de la corrida (sha256 no coincide)`);
  }
  return problemas;
}

export function sha256Texto(t: string): string {
  return createHash('sha256').update(t).digest('hex');
}

/** El texto nuevo de `verificaciones.json` con la entrada de un comercio puesta (o reemplazada). Pura: el script escribe el archivo. */
export function aplicarEntrada(jsonActual: string, comercio: string, entrada: EntradaVerificacion): string {
  const doc = JSON.parse(jsonActual) as { _formato?: string; verificaciones: Record<string, EntradaVerificacion> };
  const verificaciones = { ...doc.verificaciones, [comercio]: entrada };
  const ordenado = Object.fromEntries(Object.entries(verificaciones).sort(([a], [b]) => a.localeCompare(b)));
  return `${JSON.stringify({ ...doc, verificaciones: ordenado }, null, 2)}\n`;
}
