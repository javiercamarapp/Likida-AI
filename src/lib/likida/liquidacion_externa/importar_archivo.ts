import { logger } from '@/lib/logger';
import { CampoInvalido } from '@/lib/http/campos_cuerpo';
import { cuerposDeLiquidacionesCsv } from './liquidacion_csv';
import { matrizDeArchivoCatalogo } from '../peajes/archivo';
import { validarLiquidacionExterna, huellaContenido, type LiquidacionExternaNormalizada } from './esquema';
import { buscarPorClave, type LiquidacionExterna } from './repo';
import { recibirLiquidacionExterna, intentarEntrega } from './servicio';

// ═══════════════════════════════════════════════════════════════════════════
// LIQUIDACIONES EXTERNAS — LA ENTRADA DESDE EL PANEL (el archivo que la oficina ya tiene).
//
// La oficina hoy copia y pega desde su sistema: aquí sube el CSV o el Excel (una fila por renglón de la liquidación,
// agrupadas por `clave_externa`) y entran por el MISMO camino que POST /v1/liquidaciones-externas: validación estricta
// del contrato, llave natural `claveExterna`, recibir + intentar entregar. Mismo criterio de idempotencia que el POST:
//   · misma clave + mismo contenido → «repetida» (no se entrega otra vez);
//   · misma clave + OTRO contenido  → problema (no se sobrescribe: el chofer pudo haberla visto);
//   · lo que no valida se reporta con su clave, y NO frena a las demás (cada liquidación es independiente).
// ═══════════════════════════════════════════════════════════════════════════

export const MAX_LIQUIDACIONES_POR_ARCHIVO = 300;

export interface ResultadoImportacion {
  recibidas: number;
  repetidas: number;
  problemas: Array<{ clave: string | null; motivo: string }>;
  /** El archivo no se pudo leer en absoluto (formato, vacío, demasiado grande). */
  error?: string;
}

export interface DependenciasImportacion {
  buscar: (tenantId: string, clave: string) => Promise<LiquidacionExterna | null>;
  recibir: (tenantId: string, datos: LiquidacionExternaNormalizada, huella: string) => Promise<{ liquidacion: LiquidacionExterna }>;
  entregar: (liq: LiquidacionExterna) => Promise<unknown>;
}

const porOmision: DependenciasImportacion = {
  buscar: buscarPorClave,
  recibir: (t, d, h) => recibirLiquidacionExterna(t, d, h),
  entregar: (l) => intentarEntrega(l),
};

const celdaCsv = (v: unknown): string => {
  const s = v == null ? '' : String(v);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV tal cual; Excel/ODS → su primera hoja serializada como CSV (el convertidor lee texto). */
export function textoDeArchivoLiquidaciones(nombre: string, bytes: Uint8Array): { ok: true; texto: string } | { ok: false; motivo: string } {
  const ext = (/\.([a-z0-9]+)$/i.exec(nombre.trim())?.[1] ?? '').toLowerCase();
  if (ext === 'csv' || ext === 'txt' || ext === '') {
    if (bytes.length === 0) return { ok: false, motivo: 'El archivo está vacío.' };
    return { ok: true, texto: new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '') };
  }
  const m = matrizDeArchivoCatalogo(nombre, bytes);
  if (!m.ok) return m;
  return { ok: true, texto: m.matriz.map((f) => f.map(celdaCsv).join(',')).join('\n') };
}

export async function importarLiquidacionesDeArchivo(
  tenantId: string, nombre: string, bytes: Uint8Array, deps: DependenciasImportacion = porOmision,
): Promise<ResultadoImportacion> {
  const vacio: ResultadoImportacion = { recibidas: 0, repetidas: 0, problemas: [] };
  const t = textoDeArchivoLiquidaciones(nombre, bytes);
  if (!t.ok) return { ...vacio, error: t.motivo };
  const lectura = cuerposDeLiquidacionesCsv(t.texto, 'Archivo de la flota');
  const problemas: ResultadoImportacion['problemas'] = lectura.problemas.map((p) => ({ clave: p.clave, motivo: `${p.fila ? `fila ${p.fila}: ` : ''}${p.motivo}` }));
  if (lectura.cuerpos.length > MAX_LIQUIDACIONES_POR_ARCHIVO) {
    return { ...vacio, problemas, error: `El archivo trae ${lectura.cuerpos.length} liquidaciones; el máximo por carga es ${MAX_LIQUIDACIONES_POR_ARCHIVO}. Pártelo en varios.` };
  }
  let recibidas = 0; let repetidas = 0;
  for (const cuerpo of lectura.cuerpos) {
    const clave = cuerpo.claveExterna;
    try {
      const datos = validarLiquidacionExterna(cuerpo as unknown as Record<string, unknown>);
      const huella = huellaContenido(datos);
      const previa = await deps.buscar(tenantId, datos.claveExterna);
      if (previa) {
        if (previa.huella === huella) repetidas++;
        else problemas.push({ clave, motivo: 'ya existe una liquidación con esa clave y OTRO contenido: no se sobrescribe (el operador pudo haberla visto). Si es una corrección, usa una clave nueva (p. ej. con sufijo -R1).' });
        continue;
      }
      const { liquidacion } = await deps.recibir(tenantId, datos, huella);
      // La entrega no es parte de la promesa de recibir: `intentarEntrega` no lanza y el cron levanta lo pendiente.
      await deps.entregar(liquidacion);
      recibidas++;
    } catch (e) {
      if (e instanceof CampoInvalido) { problemas.push({ clave, motivo: e.message }); continue; }
      logger.error('liqext.importar_archivo', { tenant: tenantId, clave, err: e instanceof Error ? e.message : String(e) });
      problemas.push({ clave, motivo: e instanceof Error && e.message ? e.message : 'no se pudo guardar; vuelve a subir el archivo (es seguro repetirlo).' });
    }
  }
  return { recibidas, repetidas, problemas };
}
