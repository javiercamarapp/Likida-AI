// ═══════════════════════════════════════════════════════════════════════════
// EL CUARTO CANAL DE ENTRADA DE PEAJES (0843) — SFTP.
//
// `docs/operacion/conciliacion-peajes.md` lo listaba como bloqueo #6: «no
// construido, requiere una librería SFTP que hoy no está en el repo». La
// librería YA ESTABA (`ssh2`, instalada para `tabla_propia/sftp.ts`, el modo
// `csv_sftp` de la tabla propia del cliente): este módulo REUSA ese cliente
// — huella de host obligatoria, SSRF-safe (el host se re-resuelve y se
// descarta si resuelve a una dirección interna, EN CADA conexión) — por su
// segunda envoltura, `crearClienteSftpBinario`, que entrega los BYTES crudos
// en vez de decodificarlos a texto (el corte de peajes es Excel/PDF, no CSV).
// NADA de esa lógica se duplicó aquí: ver el comentario de cabecera de
// `conectores/tabla_propia/sftp.ts`.
//
// MISMO MOLDE QUE `peajes/pull.ts` (Likida consulta, la flota publica): la
// flota da host, puerto, usuario, credencial (contraseña y/o llave+frase) y
// la RUTA de un archivo FIJO que el proveedor sobrescribe cada corte decenal.
// El cron la consulta cada `sftp_intervalo_min` con un claim-con-lease
// (`peaje_sftp_reclamar`: FOR UPDATE SKIP LOCKED, igual que el pull) para que
// dos corridas no lean la misma flota a la vez.
//
// Lo que descarga se empaqueta EXACTAMENTE como el cuerpo del buzón firmado
// (`{ nombre, proveedor, contenido_base64 }`) y pasa por `leerCuerpoIngesta`:
// la extensión, el tamaño y el nombre se validan UNA SOLA VEZ, en un solo
// lugar, para los cuatro canales. Entra a la MISMA cola (`peaje_ingesta_
// archivo`, origen `sftp`) y lo procesa el MISMO importador — la huella
// sha256 del CONTENIDO vuelve inocuo que el archivo no haya cambiado entre
// dos corridas (el mismo corte dos veces es la misma fila, nunca un duplicado).
//
// ── POR QUÉ UN FALLO DE UNA FLOTA NUNCA TUMBA EL CRON ───────────────────────
// `ejecutarSftpPeajes` nunca lanza por una flota: una huella de host que no
// coincide, una credencial rechazada o un servidor que no contesta cierran
// ESE intento con su error (reintenta pronto, tope 30 min) y la siguiente
// flota de la lista se consulta igual. El cron (`/api/cron/peajes`) además
// envuelve la llamada entera en su propio try/catch, igual que ya hace con
// el pull.
// ═══════════════════════════════════════════════════════════════════════════

import { logger } from '@/lib/logger';
import { descifrar } from '../conectores/cofre';
import { crearClienteSftpBinario, type ClienteSftpBinario, type DestinoSftp } from '../conectores/tabla_propia/sftp';
import { ErrorTablaPropia } from '../conectores/tabla_propia/contrato';
import { reclamarSftpsPeajes, cerrarSftpPeajes, type SftpReclamado } from './datos';
import { leerCuerpoIngesta, recibirArchivoPeaje } from './ingesta';

export const TIMEOUT_SFTP_PEAJES_MS = 25_000;
/** Mismo techo que el archivo del buzón firmado (`MAX_ARCHIVO_INGESTA_BYTES` de ingesta.ts): 4 MB. */
export const MAX_BYTES_SFTP_PEAJES = 4 * 1024 * 1024;

export interface ResumenSftpPeajes {
  reclamadas: number;
  /** Flotas cuyo SFTP terminó bien (aunque el archivo no hubiera cambiado: duplicado por huella). */
  exitosas: number;
  fallidas: number;
  recibidos: number;
  duplicados: number;
  /** El archivo descargado no es un archivo válido (extensión, tamaño, nombre): se cuenta, no se reintenta. */
  rechazados: number;
}

export interface DepsSftpPeajes {
  cliente: ClienteSftpBinario;
  ahora: () => Date;
  descifrar: typeof descifrar;
}

const depsPorOmision: DepsSftpPeajes = { cliente: crearClienteSftpBinario(), ahora: () => new Date(), descifrar };

type ResultadoUnSftp = { ok: true; recibido: boolean; duplicado: boolean; rechazado: boolean; motivo: string | null } | { ok: false; error: string };

/** El último segmento de una ruta absoluta, para nombrar el archivo que entra a la cola (`/entrega/corte.xlsx` → `corte.xlsx`). */
export function nombreDeRuta(ruta: string): string {
  const partes = ruta.split('/').filter(Boolean);
  return partes.length > 0 ? partes[partes.length - 1] : 'corte';
}

export async function consultarUnSftp(f: SftpReclamado, deps: DepsSftpPeajes = depsPorOmision): Promise<ResultadoUnSftp> {
  let credencial: { clave?: string; llave?: string; frase?: string };
  try {
    const v = f.credencialCifrada ? deps.descifrar(f.credencialCifrada) : {};
    credencial = { clave: v.clave, llave: v.llave, frase: v.frase };
  } catch {
    return { ok: false, error: 'La credencial guardada no se pudo descifrar (¿cambió la llave del cofre?); vuelve a guardarla.' };
  }
  if (!credencial.clave && !credencial.llave) return { ok: false, error: 'No hay contraseña ni llave guardada para este SFTP; vuelve a configurarlo.' };

  const destino: DestinoSftp = {
    host: f.destino.host, puerto: f.destino.puerto, usuario: f.destino.usuario, ruta: f.destino.ruta,
    huellas: f.destino.huellas, clave: credencial.clave, llave: credencial.llave, frase: credencial.frase,
  };

  let bytes: Uint8Array;
  try {
    bytes = await deps.cliente.leerArchivoBinario(destino, { timeoutMs: TIMEOUT_SFTP_PEAJES_MS, maxBytes: MAX_BYTES_SFTP_PEAJES });
  } catch (e) {
    // `ErrorTablaPropia` ya trae un mensaje fijo por clase de falla (nunca el texto crudo de ssh2: puede traer la
    // credencial). Un error que no sea de esa clase tampoco se repite aquí por la misma razón.
    if (e instanceof ErrorTablaPropia) return { ok: false, error: e.message };
    return { ok: false, error: 'No se pudo leer el archivo del servidor SFTP.' };
  }

  const item = { nombre: nombreDeRuta(f.destino.ruta), proveedor: null, contenido_base64: Buffer.from(bytes).toString('base64') };
  const c = leerCuerpoIngesta(JSON.stringify(item));
  if (!c.ok) return { ok: true, recibido: false, duplicado: false, rechazado: true, motivo: c.motivo };

  const r = await recibirArchivoPeaje(f.tenantId, c.cuerpo, 'sftp');
  // `r.motivo` del código 'error' es el mensaje crudo de Postgres: no se repite hacia afuera (podría traer detalle interno).
  if (!r.ok) return { ok: false, error: r.codigo === 'cola_llena' ? r.motivo : 'No se pudo guardar el archivo (problema temporal); se reintentará.' };
  return { ok: true, recibido: !r.duplicado, duplicado: r.duplicado, rechazado: false, motivo: null };
}

/** Consulta las flotas a las que ya les toca. Nunca lanza por una flota: cada una cierra con su resultado. */
export async function ejecutarSftpPeajes(
  opciones: { limite?: number; venceEn?: number } = {}, deps: DepsSftpPeajes = depsPorOmision,
): Promise<ResumenSftpPeajes> {
  const r: ResumenSftpPeajes = { reclamadas: 0, exitosas: 0, fallidas: 0, recibidos: 0, duplicados: 0, rechazados: 0 };
  const reclamadas = await reclamarSftpsPeajes(opciones.limite ?? 3);
  r.reclamadas = reclamadas.length;
  for (const f of reclamadas) {
    if (opciones.venceEn !== undefined && deps.ahora().getTime() > opciones.venceEn) break; // conserva su lease: el siguiente cron lo retoma
    const inicio = deps.ahora();
    let res: ResultadoUnSftp;
    try {
      res = await consultarUnSftp(f, deps);
    } catch (e) {
      logger.error('peajes.sftp.excepcion', { tenant: f.tenantId, err: e instanceof Error ? e.message : String(e) });
      res = { ok: false, error: 'Falló la consulta (error interno).' };
    }
    if (res.ok) {
      r.exitosas++;
      if (res.rechazado) r.rechazados++;
      else if (res.duplicado) r.duplicados++;
      else if (res.recibido) r.recibidos++;
      await cerrarSftpPeajes(f.tenantId, { ok: true, avanzarA: inicio.toISOString(), error: res.motivo, intervaloMin: f.intervaloMin, ahora: deps.ahora() });
    } else {
      r.fallidas++;
      logger.warn('peajes.sftp.fallo', { tenant: f.tenantId, motivo: res.error });
      await cerrarSftpPeajes(f.tenantId, { ok: false, avanzarA: null, error: res.error, intervaloMin: f.intervaloMin, ahora: deps.ahora() });
    }
  }
  return r;
}
