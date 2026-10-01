// ═══════════════════════════════════════════════════════════════════════════
// LA CARGA MASIVA DEL PANEL: revisar el archivo, y recién entonces confirmar
// (W2 «producto», 1-oct-2026).
//
// Las dos pantallas (`/dashboard/operadores` y `/dashboard/unidades`) llaman
// aquí desde su server action. Es el MISMO motor que `POST /v1/{operadores,
// unidades}` —`interpretarFilas*`, `planificar*`, `importar*`—; esto solo suma
// el flujo de dos pasos:
//
//   1. PREVISUALIZAR: lee el archivo, resuelve los patios, clasifica cada fila
//      contra lo que ya hay (nuevas / ya estaban / con problema) y NO escribe.
//   2. CONFIRMAR: vuelve a leer y a validar TODO desde el archivo (la vista
//      previa que llegó del navegador no es de fiar) y escribe. Comprueba la
//      huella: si el archivo no es el que se revisó, no escribe.
//
// IDEMPOTENTE (heredado del motor): el mismo archivo dos veces no duplica.
// NO MANDA WHATSAPP por sí mismo: la invitación es una decisión aparte
// (`invitacion_operador.ts`) y solo ocurre si la flota la pide al confirmar.
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';
import type { AlcancePatio } from '@/lib/auth/patio';
import { getTerminales } from '../terminales';
import { invitarOperadores, LIMITE_POR_LLAMADA } from '../invitacion_operador';
import { MAX_ARCHIVO_BYTES, matrizDeArchivo, TOPE_FILAS_IMPORTACION } from './archivo';
import { asignarPatios } from './patios';
import { interpretarFilasOperadores, planificarOperadores, importarOperadores, type OperadorImportado } from './operadores';
import { interpretarFilasUnidades, planificarUnidades, importarUnidades, type UnidadImportada } from './unidades';
import {
  type PasoImportacion, type ResultadoImportacionUI, type ProblemaFilaUI, type MuestraFilaUI,
  TOPE_PROBLEMAS_UI, TOPE_MUESTRA_UI,
} from './resultado_ui';

export interface EntradaImportacion {
  tenantId: string;
  alcance: AlcancePatio;
  actor: { id?: string; email?: string };
  /** El `FormData` del formulario: `archivo`, `paso`, `huella`, `invitar`. */
  datos: FormData;
}

const EXTENSION = /\.(csv|xlsx|xls)$/i;

/** SHA-256 truncado a 16 hex: identifica «este archivo» sin guardarlo. */
export function huellaDe(bytes: ArrayBuffer): string {
  return createHash('sha256').update(new Uint8Array(bytes)).digest('hex').slice(0, 16);
}

type Leido = { ok: true; matriz: unknown[][]; huella: string; nombre: string } | { ok: false; error: string };

async function leerArchivo(datos: FormData): Promise<Leido> {
  const archivo = datos.get('archivo');
  if (!(archivo instanceof File) || archivo.size === 0) return { ok: false, error: 'Elige el archivo (CSV o Excel) que quieres cargar.' };
  if (archivo.size > MAX_ARCHIVO_BYTES) return { ok: false, error: 'Máximo 4 MB por archivo. Divide el archivo en partes más pequeñas.' };
  if (!EXTENSION.test(archivo.name)) return { ok: false, error: 'El archivo tiene que ser .csv, .xlsx o .xls.' };
  const bytes = await archivo.arrayBuffer();
  try {
    const matriz = matrizDeArchivo(bytes);
    return { ok: true, matriz, huella: huellaDe(bytes), nombre: archivo.name.replace(/[^\p{L}\p{N}._ -]/gu, '').slice(0, 80) || 'archivo' };
  } catch {
    return { ok: false, error: 'No pude leer el archivo — asegúrate de que sea CSV o Excel y no esté protegido con contraseña.' };
  }
}

function pasoDe(datos: FormData): PasoImportacion {
  return datos.get('paso') === 'confirmar' ? 'confirmar' : 'previsualizar';
}

function vacio(paso: PasoImportacion, error: string): ResultadoImportacionUI {
  return {
    error, paso, huella: '', archivo: '', leidas: 0, nuevas: 0, yaEstaban: 0, conProblema: 0,
    muestra: [], problemas: [], patiosDesconocidos: [], avisos: [], excedeTope: false,
  };
}

/** Une los problemas de las distintas etapas, ordenados por fila y acotados. */
function juntarProblemas(...listas: Array<ReadonlyArray<ProblemaFilaUI>>): { problemas: ProblemaFilaUI[]; total: number } {
  const todas = listas.flat().sort((a, b) => a.fila - b.fila);
  return { problemas: todas.slice(0, TOPE_PROBLEMAS_UI), total: todas.length };
}

/** El motivo del tope: el archivo se lee a medias y no se puede confirmar. */
function excede(matriz: unknown[][]): boolean {
  return matriz.length - 1 > TOPE_FILAS_IMPORTACION;
}

// ── Operadores ─────────────────────────────────────────────────────────────

export async function cargarOperadoresDesdeArchivo(e: EntradaImportacion): Promise<ResultadoImportacionUI> {
  const paso = pasoDe(e.datos);
  const leido = await leerArchivo(e.datos);
  if (!leido.ok) return vacio(paso, leido.error);

  const lectura = interpretarFilasOperadores(leido.matriz);
  if (lectura.error && lectura.filas.length === 0) return vacio(paso, lectura.error);

  let patios;
  try {
    patios = await getTerminales(e.tenantId);
  } catch {
    return vacio(paso, 'No pude leer los patios de tu flota — no revisé nada. Vuelve a intentar.');
  }
  const conPatio = asignarPatios(lectura.filas, patios, e.alcance);
  const plan = await planificarOperadores(e.tenantId, conPatio.filas);
  if (plan.error) return vacio(paso, plan.error);

  const archivoDescartadas = lectura.descartadas.filter((d) => !d.motivo.startsWith('El archivo trae'));
  const { problemas, total } = juntarProblemas(archivoDescartadas, conPatio.descartadas, plan.errores);
  const excedeTope = excede(leido.matriz);
  const base: ResultadoImportacionUI = {
    paso, huella: leido.huella, archivo: leido.nombre,
    leidas: lectura.filas.length + archivoDescartadas.length,
    nuevas: plan.nuevas.length, yaEstaban: plan.duplicados.length, conProblema: total,
    muestra: plan.nuevas.slice(0, TOPE_MUESTRA_UI).map((f: OperadorImportado): MuestraFilaUI => ({
      fila: f.fila, titulo: f.nombre,
      detalle: [f.telefono, f.patio ? `patio ${f.patio}` : null, f.numeroEmpleado ? `empleado ${f.numeroEmpleado}` : null].filter(Boolean).join(' · '),
    })),
    problemas, patiosDesconocidos: conPatio.patiosDesconocidos, avisos: [], excedeTope,
  };
  if (excedeTope && lectura.error) base.avisos.push(lectura.error);

  if (paso === 'previsualizar') return base;

  // ── Confirmar ──
  if (excedeTope) return { ...base, error: 'El archivo rebasa el tope de filas: parte el archivo y vuelve a subirlo. No importé nada.' };
  const huellaRevisada = String(e.datos.get('huella') ?? '');
  if (huellaRevisada !== '' && huellaRevisada !== leido.huella) {
    return { ...base, error: 'El archivo cambió desde la vista previa. Revísalo otra vez antes de confirmar. No importé nada.' };
  }
  if (plan.nuevas.length === 0) return { ...base, error: 'No hay nada nuevo que importar.', confirmado: false };

  const r = await importarOperadores(e.tenantId, conPatio.filas, { actor: e.actor, origen: 'panel' });
  if (r.error) return { ...base, error: r.error, confirmado: false };

  const problemasFinales = juntarProblemas(
    archivoDescartadas, conPatio.descartadas, r.errores.map((x) => ({ fila: x.fila, motivo: x.motivo })),
  );
  const resultado: ResultadoImportacionUI = {
    ...base, confirmado: true,
    nuevas: r.creados.length, yaEstaban: r.duplicados.length,
    conProblema: problemasFinales.total, problemas: problemasFinales.problemas,
  };

  if (e.datos.get('invitar') === 'on' && r.creados.length > 0) {
    const inv = await invitarOperadores(e.tenantId, {
      ids: r.creados.slice(0, LIMITE_POR_LLAMADA).map((c) => c.id), alcance: e.alcance, actor: e.actor,
    });
    resultado.invitacion = {
      enviadas: inv.enviadas,
      fallidas: inv.fallidas.map((f) => ({ nombre: f.nombre, motivo: f.motivo })),
      pendientesRestantes: inv.pendientesRestantes,
      ...(inv.error ? { error: inv.error } : {}),
    };
  } else {
    resultado.invitacion = null;
  }
  return resultado;
}

// ── Unidades ───────────────────────────────────────────────────────────────

export async function cargarUnidadesDesdeArchivo(e: EntradaImportacion): Promise<ResultadoImportacionUI> {
  const paso = pasoDe(e.datos);
  const leido = await leerArchivo(e.datos);
  if (!leido.ok) return vacio(paso, leido.error);

  const lectura = interpretarFilasUnidades(leido.matriz);
  if (lectura.error && lectura.filas.length === 0) return vacio(paso, lectura.error);

  let patios;
  try {
    patios = await getTerminales(e.tenantId);
  } catch {
    return vacio(paso, 'No pude leer los patios de tu flota — no revisé nada. Vuelve a intentar.');
  }
  const conPatio = asignarPatios(lectura.filas, patios, e.alcance);
  const plan = await planificarUnidades(e.tenantId, conPatio.filas);
  if (plan.error) return vacio(paso, plan.error);

  const archivoDescartadas = lectura.descartadas.filter((d) => !d.motivo.startsWith('El archivo trae'));
  const { problemas, total } = juntarProblemas(archivoDescartadas, conPatio.descartadas, plan.errores);
  const excedeTope = excede(leido.matriz);
  const base: ResultadoImportacionUI = {
    paso, huella: leido.huella, archivo: leido.nombre,
    leidas: lectura.filas.length + archivoDescartadas.length,
    nuevas: plan.nuevas.length, yaEstaban: plan.duplicadas.length, conProblema: total,
    muestra: plan.nuevas.slice(0, TOPE_MUESTRA_UI).map((f: UnidadImportada): MuestraFilaUI => ({
      fila: f.fila, titulo: f.numeroEconomico,
      detalle: [f.placas, [f.marca, f.modelo].filter(Boolean).join(' ') || null, f.patio ? `patio ${f.patio}` : null].filter(Boolean).join(' · '),
    })),
    problemas, patiosDesconocidos: conPatio.patiosDesconocidos,
    avisos: lectura.economicoDesdePlaca ? ['El archivo no trae columna de número económico: se usó la placa como número económico.'] : [],
    excedeTope,
  };
  if (excedeTope && lectura.error) base.avisos.push(lectura.error);

  if (paso === 'previsualizar') return base;

  if (excedeTope) return { ...base, error: 'El archivo rebasa el tope de filas: parte el archivo y vuelve a subirlo. No importé nada.' };
  const huellaRevisada = String(e.datos.get('huella') ?? '');
  if (huellaRevisada !== '' && huellaRevisada !== leido.huella) {
    return { ...base, error: 'El archivo cambió desde la vista previa. Revísalo otra vez antes de confirmar. No importé nada.' };
  }
  if (plan.nuevas.length === 0) return { ...base, error: 'No hay nada nuevo que importar.', confirmado: false };

  const r = await importarUnidades(e.tenantId, conPatio.filas, { actor: e.actor, origen: 'panel' });
  if (r.error) return { ...base, error: r.error, confirmado: false };
  const problemasFinales = juntarProblemas(archivoDescartadas, conPatio.descartadas, r.errores.map((x) => ({ fila: x.fila, motivo: x.motivo })));
  return {
    ...base, confirmado: true,
    nuevas: r.creadas.length, yaEstaban: r.duplicadas.length,
    conProblema: problemasFinales.total, problemas: problemasFinales.problemas,
  };
}
