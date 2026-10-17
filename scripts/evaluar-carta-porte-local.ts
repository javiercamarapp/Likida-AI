// Medición LOCAL del agente de Carta Porte contra las muestras REALES (T-A3-36). Script MANUAL, fuera de CI.
//
//   npx tsx scripts/evaluar-carta-porte-local.ts \
//     --muestras "<carpeta con las muestras reales>" \
//     --llave-archivo "<ruta de un archivo chmod 600 con la llave del modelo>" \
//     [--ccp-timbrados "<carpeta con los CCP timbrados .xml>"] \
//     [--asignar "archivo.pdf=M3" …]   # compara contra la matriz de 08 §2 (conjunto dorado) y lista discrepancias
//     --salida "<archivo .md fuera del repo>"
//
// Corre el pipeline REAL (detección → lectura → ¿varios embarques? → perfil/modelo → validación → plantilla del TMS)
// SIN tocar la base: no hay repo, ni storage, ni presupuesto en la base (la llamada al modelo va sin `budget`).
// La matriz ✔/◐/✗ se escribe SOLO a un archivo FUERA del repo y a stdout. Si la salida cae dentro del repo, se rechaza:
// las muestras son datos reales y el repo es público.
//
// PII: ni stdout ni el archivo llevan valores leídos (RFC, nombres, placas, operador). Los motivos de `evaluar` citan
// «valor» entre comillas angulares: aquí se reducen a «…». La llave nunca se imprime.

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, realpathSync, existsSync } from 'node:fs';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAMPOS_DOC_LLM, CAMPOS_MERCANCIA_LLM, campoDoc, campoMercancia, type Extraccion } from '../src/lib/likida/carta_porte_docs/campos';
import { detectarFormato, parsearXml, prepararContenido, type ContenidoDoc } from '../src/lib/likida/carta_porte_docs/contenido';
import { extraerDocumento, type LlmExtractor } from '../src/lib/likida/carta_porte_docs/extractor';
import { derivarHijos, evaluarDivision } from '../src/lib/likida/carta_porte_docs/multiembarque';
import { elegirPerfil, type Perfil } from '../src/lib/likida/carta_porte_docs/perfiles';
import { construirPlantilla } from '../src/lib/likida/carta_porte_docs/plantilla_tms';
import { validarExtraccion } from '../src/lib/likida/carta_porte_docs/validacion';
import { extraerCartaPorteXml } from '../src/lib/likida/carta_porte_docs/xml_ccp';
import { MATRIZ_DORADA } from '../src/lib/likida/carta_porte_docs/evaluacion/esperados';
import { evaluar, MARCA_DE, resumir, tablaResumen, type CampoEsperado, type EvaluacionCampos, type Marca, type Resumen } from '../src/lib/likida/carta_porte_docs/evaluacion/evaluar';
import type { IdMuestra } from '../src/lib/likida/carta_porte_docs/evaluacion/dorado.fixture';

export const RAIZ_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_EMBARQUES_A_MEDIR = 3;

// ── Argumentos ──────────────────────────────────────────────────────────────

export interface Argumentos {
  muestras: string;
  ccpTimbrados: string | null;
  llaveArchivo: string | null;
  salida: string;
  /** nombre de archivo → muestra del conjunto dorado, para comparar contra 08 §2. */
  asignar: Record<string, IdMuestra>;
}

export function leerArgumentos(argv: string[]): Argumentos {
  const a: Argumentos = { muestras: '', ccpTimbrados: null, llaveArchivo: null, salida: '', asignar: {} };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    const necesita = (): string => { if (v === undefined || v.startsWith('--')) throw new Error(`Falta el valor de ${k}.`); i++; return v; };
    if (k === '--muestras') a.muestras = necesita();
    else if (k === '--ccp-timbrados') a.ccpTimbrados = necesita();
    else if (k === '--llave-archivo') a.llaveArchivo = necesita();
    else if (k === '--salida') a.salida = necesita();
    else if (k === '--asignar') {
      const [archivo, id] = necesita().split('=');
      if (!archivo || !/^M[1-5]$/.test(id ?? '')) throw new Error('--asignar espera «archivo=M1..M5».');
      a.asignar[archivo] = id as IdMuestra;
    } else throw new Error(`Argumento desconocido: ${k}`);
  }
  if (!a.muestras) throw new Error('Falta --muestras <carpeta>.');
  if (!a.salida) throw new Error('Falta --salida <archivo .md fuera del repo> (la matriz con datos reales nunca va al repo).');
  return a;
}

// ── Guardias de ubicación y de llave ────────────────────────────────────────

function real(ruta: string): string {
  let r = resolve(ruta);
  // Sube hasta lo que exista para resolver symlinks de los tramos existentes.
  const resto: string[] = [];
  while (!existsSync(r) && dirname(r) !== r) { resto.unshift(basename(r)); r = dirname(r); }
  return join(realpathSync(r), ...resto);
}

export function estaDentroDelRepo(ruta: string, raiz: string = RAIZ_REPO): boolean {
  const r = real(ruta);
  const base = real(raiz);
  return r === base || r.startsWith(base + sep);
}

/** Rechaza una salida o una carpeta de muestras dentro del repo (público): los datos reales no entran. */
export function exigirFueraDelRepo(ruta: string, que: string, raiz: string = RAIZ_REPO): void {
  if (estaDentroDelRepo(ruta, raiz)) throw new Error(`${que} está dentro del repo (público): usa una ruta fuera de él. No se ejecuta.`);
}

/** Lee la llave del modelo de un archivo local. Exige permisos 600 (sin acceso para grupo/otros). Nunca la imprime. */
export function leerLlave(ruta: string): string {
  const st = statSync(ruta);
  if (!st.isFile()) throw new Error('--llave-archivo no es un archivo.');
  if ((st.mode & 0o077) !== 0) throw new Error('El archivo de la llave debe ser chmod 600 (sin acceso para grupo ni otros).');
  const llave = readFileSync(ruta, 'utf8').trim();
  if (llave === '') throw new Error('El archivo de la llave está vacío.');
  return llave;
}

// ── Sin PII ─────────────────────────────────────────────────────────────────

/** Los motivos de `evaluar` citan lo leído entre «»: se reduce a «…». Las notas del modelo (texto libre) no se copian. */
export function sinValores(texto: string): string {
  return texto.replace(/«[^»]*»/g, '«…»').replace(/nota: [^;]*/g, 'nota: (ver el visor)');
}

// ── Medición ────────────────────────────────────────────────────────────────

export interface FilaCampo { campo: string; marca: Marca; motivo: string; fuenteEsperado: 'ccp' | 'lectura' | 'ninguna' }

export interface InformeEmbarque {
  etiqueta: string;
  extraccionOrigen: string;
  nivel: number;
  modelo: string | null;
  costoUsd: number;
  campos: FilaCampo[];
  resumen: Resumen;
  hallazgos: Record<string, number>;
  plantilla: { faltantes: number; bloqueantes: number; avisos: number };
  discrepanciasConDorado: string[];
  ccp: 'comparado' | 'sin_ccp';
}

export interface InformeMuestra {
  archivo: string;
  formato: string;
  /** Nº de embarques que el documento trae (1 = uno solo). */
  embarques: number;
  embarquesMedidos: InformeEmbarque[];
  error: string | null;
}

export interface OpcionesMedicion {
  /** Fábrica del extractor del modelo por archivo. En el CLI es el real (OpenRouter sin presupuesto en base); en pruebas, un doble. */
  llm: (archivo: string) => LlmExtractor;
  ccpPorFolio?: Map<string, Extraccion>;
  asignar?: Record<string, IdMuestra>;
  /** Perfiles del cliente (viven en la base: el CLI no los trae; la prueba sí puede pasarlos). */
  perfiles?: (archivo: string, contenido: ContenidoDoc) => Perfil[];
  ahora?: Date;
  /** Tope de niveles del modelo (por omisión 3, como el servicio; las pruebas con LLM falso de un solo nivel usan 1). */
  nivelMaximo?: 1 | 2 | 3;
}

const clavesEvaluables = (): string[] => [
  ...CAMPOS_DOC_LLM.map((c) => c.clave),
  ...CAMPOS_MERCANCIA_LLM.map((c) => `mercancias[0].${c.clave}`),
];

function valorDe(e: Extraccion, campo: string): string | null {
  const m = /^mercancias\[0\]\.(.+)$/.exec(campo);
  const v = m ? e.mercancias[0]?.[m[1]] : e.campos[campo];
  return v && v.valor !== null && v.valor !== '' ? v.valor : null;
}

const esCritico = (campo: string): boolean => {
  const m = /^mercancias\[0\]\.(.+)$/.exec(campo);
  return (m ? campoMercancia(m[1]) : campoDoc(campo))?.critico === true;
};

/** Arma lo esperado: del CCP timbrado si lo hay; si no, lo leído (se mide confianza/hallazgos/conversión, no exactitud). */
export function armarEsperado(e: Extraccion, ccp: Extraccion | null): CampoEsperado[] {
  const out: CampoEsperado[] = [];
  for (const campo of clavesEvaluables()) {
    const delCcp = ccp ? valorDe(ccp, campo) : null;
    const leido = valorDe(e, campo);
    if (ccp && delCcp !== null) out.push({ campo, valor: delCcp, estado: 'ok' });
    else if (leido !== null) out.push({ campo, valor: leido, estado: 'ok' });
    else if (esCritico(campo)) out.push({ campo, valor: null, estado: 'falta' });
  }
  if (ccp) out.push({ campo: 'n_mercancias', valor: String(ccp.mercancias.length), estado: 'ok' });
  return out;
}

function discrepancias(ev: EvaluacionCampos, id: IdMuestra): string[] {
  return MATRIZ_DORADA[id]
    .filter((c) => c.campo !== 'n_mercancias' && ev[c.campo] !== undefined)
    .filter((c) => ev[c.campo].estado !== MARCA_DE[c.estado])
    .map((c) => `${c.campo}: 08 §2 esperaba ${MARCA_DE[c.estado]}, salió ${ev[c.campo].estado}`);
}

async function medirEmbarque(
  etiqueta: string, archivo: string, bytes: Uint8Array, clase: Parameters<typeof prepararContenido>[1], op: OpcionesMedicion,
  esHijo: boolean,
): Promise<{ informes: InformeEmbarque[]; embarques: number; error?: string }> {
  const contenido = await prepararContenido(bytes, clase);
  const perfiles = op.perfiles?.(archivo, contenido) ?? [];
  const div = esHijo ? { plan: null, mismoEmbarque: null } : evaluarDivision(contenido, elegirPerfil(perfiles, contenido, null, null).perfil);
  if (div.plan && !esHijo) {
    // Varios embarques: se miden los primeros N como lo haría el servicio (cada hijo es un CSV de un embarque).
    const hijos = derivarHijos(div.plan, archivo).slice(0, MAX_EMBARQUES_A_MEDIR);
    const informes: InformeEmbarque[] = [];
    for (const h of hijos) {
      const r = await medirEmbarque(`embarque ${h.indice}`, archivo, h.bytes, 'csv', op, true);
      if (r.error) return { embarques: div.plan.embarques.length, informes: [], error: r.error };
      informes.push(...r.informes);
    }
    return { embarques: div.plan.embarques.length, informes };
  }
  if (div.mismoEmbarque) contenido.hojasMismoEmbarque = div.mismoEmbarque.hojas;
  const extraido = await extraerDocumento(contenido, { llm: op.llm(archivo), perfiles, nivelMaximo: op.nivelMaximo ?? 3 });
  const ext = extraido.extraccion;
  const folio = ext.campos.folio_cliente?.valor ?? null;
  const ccp = folio !== null ? op.ccpPorFolio?.get(folio) ?? null : null;
  const esperado = armarEsperado(ext, ccp);
  const ev = evaluar(ext, esperado, op.ahora ? { ahora: op.ahora } : {});
  const hs = validarExtraccion(ext, { ahora: op.ahora ?? new Date(), riesgoInyeccion: extraido.riesgoInyeccion }).hallazgos;
  const hallazgos: Record<string, number> = {};
  for (const h of hs) hallazgos[`${h.severidad}:${h.codigo}`] = (hallazgos[`${h.severidad}:${h.codigo}`] ?? 0) + 1;
  const plantilla = construirPlantilla(ext, { clienteInterno: null, plantilla: 'normal', uso: 'descarga' });
  const id = op.asignar?.[archivo];
  return {
    embarques: 1,
    informes: [{
      etiqueta,
      extraccionOrigen: extraido.origen,
      nivel: extraido.nivel,
      modelo: extraido.modelo,
      costoUsd: extraido.costoUsd,
      campos: esperado.filter((x) => x.campo !== 'n_mercancias').map((x) => ({
        campo: x.campo, marca: ev[x.campo].estado, motivo: sinValores(ev[x.campo].motivo),
        fuenteEsperado: ccp && valorDe(ccp, x.campo) !== null ? 'ccp' : x.valor === null ? 'ninguna' : 'lectura',
      })),
      resumen: resumir(ev, esperado),
      hallazgos,
      plantilla: { faltantes: plantilla.faltantes.length, bloqueantes: plantilla.faltantes.filter((f) => f.bloqueante).length, avisos: plantilla.avisos.length },
      discrepanciasConDorado: id ? discrepancias(ev, id) : [],
      ccp: ccp ? 'comparado' : 'sin_ccp',
    }],
  };
}

export async function medirArchivo(archivo: string, bytes: Uint8Array, op: OpcionesMedicion): Promise<InformeMuestra> {
  const d = detectarFormato(bytes);
  if (!d.ok) return { archivo, formato: 'desconocido', embarques: 0, embarquesMedidos: [], error: sinValores(d.motivo) };
  try {
    const r = await medirEmbarque('embarque 1', archivo, bytes, d.clase, op, false);
    if (r.error) return { archivo, formato: d.clase, embarques: r.embarques, embarquesMedidos: [], error: sinValores(r.error) };
    return { archivo, formato: d.clase, embarques: r.embarques, embarquesMedidos: r.informes, error: null };
  } catch (e) {
    // Solo el tipo del error: un mensaje de la librería o del proveedor podría traer contenido del documento.
    return { archivo, formato: d.clase, embarques: 0, embarquesMedidos: [], error: `falló la medición (${e instanceof Error ? e.name : 'error'})` };
  }
}

/** Lee los CCP timbrados (.xml) de una carpeta y los indexa por folio. */
export function cargarCcpTimbrados(carpeta: string): Map<string, Extraccion> {
  const m = new Map<string, Extraccion>();
  for (const f of readdirSync(carpeta).filter((x) => extname(x).toLowerCase() === '.xml').sort()) {
    const e = extraerCartaPorteXml(parsearXml(readFileSync(join(carpeta, f), 'utf8')));
    const folio = e?.campos.folio_cliente?.valor;
    if (e && folio) m.set(folio, e);
  }
  return m;
}

// ── Reporte ─────────────────────────────────────────────────────────────────

export function reporte(informes: ReadonlyArray<InformeMuestra>, ahora: Date, extra: { conCcp: boolean }): string {
  const lineas: string[] = [
    '# A3 · Medición local contra las muestras reales',
    '',
    `Generado: ${ahora.toISOString()} · fuera del repo; sin valores leídos (solo marcas, claves de campo y conteos).`,
    extra.conCcp ? 'Esperado: CCP timbrado cuando el folio coincide; si no, lo leído (se mide confianza, hallazgos y conversiones).' : 'Esperado: lo leído (sin CCP timbrado): se mide confianza, hallazgos y conversiones, NO exactitud real.',
    '',
  ];
  const filas = informes.flatMap((i) => i.embarquesMedidos.map((e, n) => ({
    id: i.embarquesMedidos.length > 1 ? `${i.archivo} #${n + 1}` : i.archivo,
    resumen: e.resumen,
  })));
  if (filas.length > 0) lineas.push('## Resumen', '', tablaResumen(filas), '');
  for (const i of informes) {
    lineas.push(`## ${i.archivo}`, '', `Formato: ${i.formato} · embarques: ${i.embarques}`);
    if (i.error) { lineas.push(`ERROR: ${i.error}`, ''); continue; }
    for (const e of i.embarquesMedidos) {
      lineas.push(
        '', `### ${e.etiqueta}`,
        `Lectura: ${e.extraccionOrigen} · nivel ${e.nivel} · modelo ${e.modelo ?? '(sin modelo)'} · costo US$ ${e.costoUsd.toFixed(4)} · CCP: ${e.ccp === 'comparado' ? 'comparado' : 'no hay'}`,
        `Plantilla del TMS: ${e.plantilla.faltantes} faltantes (${e.plantilla.bloqueantes} bloqueantes), ${e.plantilla.avisos} avisos`,
        `Hallazgos: ${Object.entries(e.hallazgos).map(([k, n]) => `${k} ×${n}`).join(', ') || 'ninguno'}`,
        '', '| Campo | Marca | Motivo |', '|---|---|---|',
        ...e.campos.map((c) => `| ${c.campo} | ${c.marca} | ${c.motivo} |`),
      );
      if (e.discrepanciasConDorado.length > 0) lineas.push('', 'Discrepancias contra 08 §2:', ...e.discrepanciasConDorado.map((d) => `- ${d}`));
    }
    lineas.push('');
  }
  return `${lineas.join('\n')}\n`;
}

// ── Orquestación (la usan el CLI y la prueba) ───────────────────────────────

export interface OpcionesCarpeta extends OpcionesMedicion {
  muestras: string;
  ccpTimbrados?: string | null;
  salida: string;
  raizRepo?: string;
}

export async function evaluarCarpeta(op: OpcionesCarpeta): Promise<{ informes: InformeMuestra[]; texto: string }> {
  const raiz = op.raizRepo ?? RAIZ_REPO;
  exigirFueraDelRepo(op.salida, 'La salida', raiz);
  exigirFueraDelRepo(op.muestras, 'La carpeta de muestras', raiz);
  if (op.ccpTimbrados) exigirFueraDelRepo(op.ccpTimbrados, 'La carpeta de CCP timbrados', raiz);
  const ccpPorFolio = op.ccpTimbrados ? cargarCcpTimbrados(op.ccpTimbrados) : undefined;
  const archivos = readdirSync(op.muestras).filter((f) => !f.startsWith('.') && statSync(join(op.muestras, f)).isFile()).sort();
  const informes: InformeMuestra[] = [];
  for (const f of archivos) {
    informes.push(await medirArchivo(f, new Uint8Array(readFileSync(join(op.muestras, f))), { ...op, ccpPorFolio }));
  }
  const texto = reporte(informes, op.ahora ?? new Date(), { conCcp: !!ccpPorFolio });
  mkdirSync(dirname(resolve(op.salida)), { recursive: true });
  writeFileSync(op.salida, texto);
  return { informes, texto };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

async function principal(): Promise<void> {
  const a = leerArgumentos(process.argv.slice(2));
  // Falla ANTES de leer nada si la ruta de salida cae en el repo.
  exigirFueraDelRepo(a.salida, 'La salida');
  if (!a.llaveArchivo) throw new Error('Falta --llave-archivo <ruta> (la llave del modelo, en un archivo chmod 600).');
  process.env.OPENROUTER_API_KEY = leerLlave(a.llaveArchivo);
  // Import tardío: cargar el cliente del modelo solo si hay llave. Sin `budget`: no toca la base.
  const { generateStructured } = await import('../src/lib/llm/openrouter');
  const { ROL_POR_NIVEL } = await import('../src/lib/likida/carta_porte_docs/extractor_openrouter');
  const { SalidaLlmSchema, construirSistema, construirUsuario } = await import('../src/lib/likida/carta_porte_docs/extractor');
  const llm = (): LlmExtractor => async (entrada, signal) => {
    const r = await generateStructured({
      role: ROL_POR_NIVEL[entrada.nivel],
      system: construirSistema(),
      messages: [{ role: 'user', content: construirUsuario(entrada) }],
      schema: SalidaLlmSchema,
      schemaName: 'carta_porte_extraccion',
      images: entrada.imagenes.length > 0 ? entrada.imagenes : undefined,
      maxTokens: 8000,
      signal,
    });
    return { ...r.data, modelo: r.model, tokensIn: r.tokensIn, tokensOut: r.tokensOut, costoUsd: r.cost };
  };
  const { informes, texto } = await evaluarCarpeta({ muestras: a.muestras, ccpTimbrados: a.ccpTimbrados, salida: a.salida, llm, asignar: a.asignar });
  process.stdout.write(texto);
  const errores = informes.filter((i) => i.error).length;
  process.stdout.write(`\nEscrito en ${a.salida}\n`);
  process.exitCode = errores > 0 ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal().catch((e) => { console.error(e instanceof Error ? e.message : 'falló'); process.exit(1); });
}
