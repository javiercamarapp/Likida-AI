// ═══════════════════════════════════════════════════════════════════════════
// EL PULL DE DESGLOSES DE PEAJE (0563) — Likida consulta, la flota publica.
//
// No hay API pública de PASE/IAVE/TeleVía (ver docs/operacion/conciliacion-peajes.md):
// lo que sí puede hacer una flota —o su TMS, o un script suyo— es EXPONER un
// endpoint HTTPS con sus cortes. Este módulo lo consulta cada `pull_intervalo_min`.
//
// ── EL CONTRATO QUE LA FLOTA IMPLEMENTA (definido por Likida) ────────────────
//   GET <pull_url>[?desde=<instante ISO del último pull exitoso>]
//   Authorization: Bearer <token>            (si la flota configuró uno)
//   Accept: application/json
//   → 200 { "archivos": [ { "nombre": "corte-pase.xlsx", "proveedor": "PASE",
//                           "contenido_base64": "<archivo, ≤ 4 MB>" } ] }
// Cada elemento tiene la MISMA forma que el cuerpo del buzón firmado
// (`leerCuerpoIngesta`) y se encola igual: la huella sha256 vuelve inocuo que el
// endpoint devuelva el mismo archivo en cada consulta.
//
// ── SEGURIDAD ────────────────────────────────────────────────────────────────
//   · SSRF: la consulta va por `httpsPublico` (HTTPS, sin credenciales en la URL,
//     el DNS se valida CONTRA la IP real que abre el socket, sin redirects).
//   · El token se guarda CIFRADO con el cofre (AES-256-GCM); se descifra aquí y
//     nunca se loguea. El cuerpo de la respuesta NUNCA se copia a un error.
//   · La respuesta tiene techo (8 MiB), a lo más MAX_ARCHIVOS_POR_PULL elementos.
//   · Claim con lease (`peaje_pull_reclamar`): dos cron no consultan la misma flota a la vez.
// ═══════════════════════════════════════════════════════════════════════════

import { logger } from '@/lib/logger';
import { httpsPublico } from '@/lib/http/https_publico';
import { descifrar } from '../conectores/cofre';
import { reclamarPullsPeajes, cerrarPullPeajes, type PullReclamado } from './datos';
import { leerCuerpoIngesta, recibirArchivoPeaje } from './ingesta';

export const MAX_ARCHIVOS_POR_PULL = 20;
export const TIMEOUT_PULL_MS = 20_000;

export interface ResumenPulls {
  reclamadas: number;
  /** Flotas cuyo pull terminó bien (aunque no hubiera archivos nuevos). */
  exitosas: number;
  fallidas: number;
  recibidos: number;
  duplicados: number;
  /** Elementos del endpoint que no son un archivo válido (se cuentan, no se reintentan). */
  rechazados: number;
}

export interface DepsPull {
  http: typeof httpsPublico;
  ahora: () => Date;
  descifrar: typeof descifrar;
}

const depsPorOmision: DepsPull = { http: httpsPublico, ahora: () => new Date(), descifrar };

type ResultadoUnPull = { ok: true; recibidos: number; duplicados: number; rechazados: number; nota: string | null } | { ok: false; error: string };

/** La URL con `desde` (sin pisar lo que ya trajera la flota en su query). */
export function urlConDesde(url: string, desde: string | null): string {
  if (!desde) return url;
  const u = new URL(url);
  u.searchParams.set('desde', desde);
  return u.toString();
}

export async function consultarUnPull(p: PullReclamado, deps: DepsPull = depsPorOmision): Promise<ResultadoUnPull> {
  const encabezados: Record<string, string> = { Accept: 'application/json', 'User-Agent': 'Likida-Peajes/1' };
  if (p.credencialCifrada) {
    try {
      const token = deps.descifrar(p.credencialCifrada).token;
      if (!token) return { ok: false, error: 'El token guardado no se pudo leer; vuelve a guardarlo.' };
      encabezados.Authorization = `Bearer ${token}`;
    } catch {
      return { ok: false, error: 'El token guardado no se pudo descifrar (¿cambió la llave del cofre?); vuelve a guardarlo.' };
    }
  }

  let resp;
  try {
    resp = await deps.http({ url: urlConDesde(p.url, p.ultimoEn), metodo: 'GET', encabezados }, TIMEOUT_PULL_MS);
  } catch (e) {
    // `httpsPublico` ya sanea sus mensajes (nunca DNS/TLS/URL crudos).
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo consultar el endpoint.' };
  }
  if (resp.estado === 401 || resp.estado === 403) return { ok: false, error: `El endpoint rechazó el token (HTTP ${resp.estado}).` };
  if (resp.estado !== 200) return { ok: false, error: `El endpoint contestó HTTP ${resp.estado}.` };

  let j: unknown;
  try { j = JSON.parse(resp.cuerpo); } catch { return { ok: false, error: 'El endpoint no devolvió JSON válido.' }; }
  const archivos = j !== null && typeof j === 'object' ? (j as { archivos?: unknown }).archivos : undefined;
  if (!Array.isArray(archivos)) return { ok: false, error: 'La respuesta no trae la lista «archivos».' };

  let recibidos = 0; let duplicados = 0; let rechazados = 0;
  const motivos: string[] = [];
  let incompleto = false;
  for (const item of archivos.slice(0, MAX_ARCHIVOS_POR_PULL)) {
    const c = leerCuerpoIngesta(JSON.stringify(item));
    if (!c.ok) { rechazados++; if (motivos.length < 3) motivos.push(c.motivo); continue; }
    const r = await recibirArchivoPeaje(p.tenantId, c.cuerpo, 'pull');
    if (r.ok) { if (r.duplicado) duplicados++; else recibidos++; continue; }
    // Cola llena o base caída: el cursor NO avanza (la huella evita duplicar al reintentar).
    incompleto = true;
    motivos.push(r.codigo === 'cola_llena' ? 'la cola de la flota está llena' : 'no se pudo guardar un archivo');
    break;
  }
  if (incompleto) return { ok: false, error: `Pull incompleto: ${motivos.join('; ')}.` };
  const extra = archivos.length > MAX_ARCHIVOS_POR_PULL ? ` El endpoint devolvió ${archivos.length} archivos; se toman ${MAX_ARCHIVOS_POR_PULL} por consulta.` : '';
  const nota = rechazados > 0 || extra ? `${rechazados > 0 ? `${rechazados} elemento(s) no son un archivo válido (${motivos.join('; ')}).` : ''}${extra}`.trim() : null;
  return { ok: true, recibidos, duplicados, rechazados, nota };
}

/** Consulta las flotas a las que ya les toca. Nunca lanza por una flota: cada una cierra con su resultado. */
export async function ejecutarPulls(
  opciones: { limite?: number; venceEn?: number } = {}, deps: DepsPull = depsPorOmision,
): Promise<ResumenPulls> {
  const r: ResumenPulls = { reclamadas: 0, exitosas: 0, fallidas: 0, recibidos: 0, duplicados: 0, rechazados: 0 };
  const reclamadas = await reclamarPullsPeajes(opciones.limite ?? 3);
  r.reclamadas = reclamadas.length;
  for (const p of reclamadas) {
    if (opciones.venceEn !== undefined && deps.ahora().getTime() > opciones.venceEn) break; // conserva su lease: el siguiente cron lo retoma
    const inicio = deps.ahora();
    let res: ResultadoUnPull;
    try {
      res = await consultarUnPull(p, deps);
    } catch (e) {
      logger.error('peajes.pull.excepcion', { tenant: p.tenantId, err: e instanceof Error ? e.message : String(e) });
      res = { ok: false, error: 'Falló la consulta (error interno).' };
    }
    if (res.ok) {
      r.exitosas++; r.recibidos += res.recibidos; r.duplicados += res.duplicados; r.rechazados += res.rechazados;
      await cerrarPullPeajes(p.tenantId, { ok: true, avanzarA: inicio.toISOString(), error: res.nota, intervaloMin: p.intervaloMin, ahora: deps.ahora() });
    } else {
      r.fallidas++;
      logger.warn('peajes.pull.fallo', { tenant: p.tenantId, motivo: res.error });
      await cerrarPullPeajes(p.tenantId, { ok: false, avanzarA: null, error: res.error, intervaloMin: p.intervaloMin, ahora: deps.ahora() });
    }
  }
  return r;
}
