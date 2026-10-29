// ═══════════════════════════════════════════════════════════════════════════
// LAS CARGAS POR ARCHIVO DEL PANEL DE LIQUIDACIÓN POR CORREO (Ola 1 · A1): del archivo al mensaje que ve la oficina.
//
// La página (`dashboard/agentes/liquidacion/page.tsx`) solo gatea (rol y flota de la sesión) y llama aquí; esto lee el archivo con las
// MISMAS funciones que las rutas /v1 (`importarDesglosesDeArchivo` → `recibirDesglose`; `importarContactosDeArchivo` →
// `aplicarContactos`) y devuelve el aviso en lenguaje llano. Jamás pone un correo ni un importe en el mensaje.
// ═══════════════════════════════════════════════════════════════════════════

import type { Flash } from '../mensaje_flash';
import { importarDesglosesDeArchivo, type ResultadoImportacionDesgloses } from './desglose_csv';
import { importarContactosDeArchivo } from './contactos_archivo';

/** Tope del archivo subido desde el panel. */
export const MAX_ARCHIVO_CARGA_BYTES = 4_000_000;

export interface ArchivoCarga { nombre: string; bytes: Uint8Array }

/** El `File` del formulario → bytes, o el motivo en lenguaje llano. */
export async function leerArchivoCarga(fd: FormData): Promise<{ ok: true; archivo: ArchivoCarga } | { ok: false; error: string }> {
  const a = fd.get('archivo');
  if (!(a instanceof File) || a.size === 0) return { ok: false, error: 'Elige el archivo (CSV o Excel).' };
  if (a.size > MAX_ARCHIVO_CARGA_BYTES) return { ok: false, error: 'El archivo pesa demasiado (máximo 4 MB). Pártelo en varios.' };
  return { ok: true, archivo: { nombre: a.name, bytes: new Uint8Array(await a.arrayBuffer()) } };
}

const ERROR_GENERICO = 'No se pudo procesar el archivo. Vuelve a intentarlo: repetirlo es seguro.';

/**
 * A1-01: la subida de desgloses tiene DOS pasos. `previa` no escribe nada: cuenta cuántos desgloses y cuántos correos saldrían.
 * `confirmar` repite esa cuenta y solo sube si quien confirma escribió ese mismo número de correos (0 correos no necesita confirmación:
 * nada puede salir). Así una subida del histórico jamás manda decenas de nóminas viejas sin que alguien haya visto el número.
 */
export type PasoCargaDesgloses = { tipo: 'previa' } | { tipo: 'confirmar'; correos: number | null };

/** Presupuestos: la vista previa (de la que depende la confirmación) y la carga real caben juntas en `maxDuration = 60` de la página. */
export const PRESUPUESTO_PREVIA_MS = 18_000;
export const PRESUPUESTO_CARGA_CONFIRMADA_MS = 36_000;

export interface DependenciasCargaPanel {
  /** Config de la flota (activa y fecha de corte, para advertir). `null` = no se pudo leer. */
  leerConfig: (tenantId: string) => Promise<{ activa: boolean; canal: string; noEnviarAntes: string | null } | null>;
}
const depsCargaPorOmision: DependenciasCargaPanel = {
  leerConfig: async (t) => {
    const { leerConfigCorreo } = await import('./repo_correo');
    const l = await leerConfigCorreo(t);
    return l.ok ? { activa: l.valor.activa, canal: l.valor.canal, noEnviarAntes: l.valor.noEnviarAntes } : null;
  },
};

function resumenPrevio(r: ResultadoImportacionDesgloses): string {
  const partes = [`${r.recibidas} desgloses / ${r.correos} correos`];
  if (r.omitidas) partes.push(`${r.omitidas} se guardan sin enviar (anteriores a la fecha de corte o ya enviados por el origen)`);
  if (r.retenidas) partes.push(`${r.retenidas} quedan retenidos`);
  if (r.idempotentes) partes.push(`${r.idempotentes} ya estaban`);
  if (r.excepciones.length) partes.push(`${r.excepciones.length} con excepción`);
  if (r.problemas.length) partes.push(`${r.problemas.length} con problema`);
  return partes.join(' / ');
}

function detalleDe(r: ResultadoImportacionDesgloses, avisoCorte: string | null): string {
  return [
    ...(avisoCorte ? [avisoCorte] : []),
    ...r.excepciones.slice(0, 3).map((x) => `${x.clave}: ${x.motivo}`),
    ...r.problemas.slice(0, 3).map((x) => `${x.clave ?? 'archivo'}: ${x.motivo}`),
  ].join('\n');
}

export async function cargarDesglosesDePanel(
  tenantId: string, a: ArchivoCarga, paso: PasoCargaDesgloses = { tipo: 'previa' },
  importar: typeof importarDesglosesDeArchivo = importarDesglosesDeArchivo, deps: DependenciasCargaPanel = depsCargaPorOmision,
): Promise<Flash> {
  try {
    // La cuenta (sin escribir nada) va SIEMPRE primero: es lo que se enseña y contra lo que se confirma.
    const previa = await importar(tenantId, a.nombre, a.bytes, undefined, { simular: true, presupuestoMs: PRESUPUESTO_PREVIA_MS });
    if (previa.error) return { error: previa.error };
    if (previa.sinProcesar) {
      return { error: `El archivo es demasiado grande para revisarlo de una vez (faltaron ${previa.sinProcesar} por contar). Pártelo en archivos más chicos; nada se subió.` };
    }
    let avisoCorte: string | null = null;
    const cfg = await deps.leerConfig(tenantId);
    if (cfg === null) avisoCorte = 'No pude leer la configuración de envío: revisa la fecha de corte antes de confirmar.';
    else if (cfg.activa && cfg.canal !== 'whatsapp' && cfg.noEnviarAntes === null) {
      avisoCorte = 'ATENCIÓN: el envío está activo y no hay fecha de corte. TODO desglose de este archivo sale a sus destinatarios, aunque sea viejo. Pon la fecha de arranque en Configuración antes de subir histórico.';
    }

    if (paso.tipo === 'previa') {
      const instruccion = previa.correos > 0
        ? `Nada se guardó ni se envió. Para subirlos, escribe ${previa.correos} en «Correos que saldrán» y pulsa «Subir y enviar».`
        : 'Nada se guardó ni se envió. No saldría ningún correo: pulsa «Subir y enviar» para guardarlos.';
      return { aviso: `Vista previa: ${resumenPrevio(previa)}. ${instruccion}`, ...(detalleDe(previa, avisoCorte) ? { detalle: detalleDe(previa, avisoCorte) } : {}) };
    }

    // Confirmar: sin el número exacto de correos no se sube nada.
    if (previa.correos > 0 && paso.correos !== previa.correos) {
      return {
        error: `No se subió nada. Este archivo enviaría ${previa.correos} correos y ${paso.correos === null ? 'no escribiste el número' : `escribiste ${paso.correos}`}. Revisa la vista previa y escribe ${previa.correos} para confirmar.`,
        ...(detalleDe(previa, avisoCorte) ? { detalle: detalleDe(previa, avisoCorte) } : {}),
      };
    }

    const r = await importar(tenantId, a.nombre, a.bytes, undefined, { presupuestoMs: PRESUPUESTO_CARGA_CONFIRMADA_MS });
    if (r.error) return { error: r.error };
    const partes = [`${r.recibidas} recibidos`, `${r.idempotentes} ya estaban`, `${r.correos} correos programados`];
    if (r.omitidas) partes.push(`${r.omitidas} sin enviar (anteriores al corte o ya enviados por el origen)`);
    if (r.retenidas) partes.push(`${r.retenidas} retenidos`);
    if (r.correcciones) partes.push(`${r.correcciones} con corrección pendiente`);
    if (r.excepciones.length) partes.push(`${r.excepciones.length} con excepción`);
    if (r.problemas.length) partes.push(`${r.problemas.length} con problema`);
    const detalle = detalleDe(r, null);
    return {
      ...(r.sinProcesar
        ? { error: `Se acabó el tiempo de la carga: faltan ${r.sinProcesar} por procesar. Vuelve a subir el mismo archivo (lo ya recibido no se envía dos veces). ${partes.join(' / ')}.` }
        : { aviso: `Carga terminada: ${partes.join(' / ')}.` }),
      ...(detalle ? { detalle } : {}),
    };
  } catch {
    return { error: ERROR_GENERICO };
  }
}

export async function cargarContactosDePanel(
  tenantId: string, a: ArchivoCarga, importar: typeof importarContactosDeArchivo = importarContactosDeArchivo,
): Promise<Flash> {
  try {
    const r = await importar(tenantId, a.nombre, a.bytes);
    if (r.error) return { error: r.error };
    return { aviso: `Correos cargados: ${r.resumen}.`, ...(r.detalle.length ? { detalle: r.detalle.join('\n') } : {}) };
  } catch {
    return { error: ERROR_GENERICO };
  }
}
