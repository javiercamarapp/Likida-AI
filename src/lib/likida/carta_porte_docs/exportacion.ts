// ═══════════════════════════════════════════════════════════════════════════
// EXPORTACIÓN AL FORMATO DESTINO — configurable por mapeo.
//
// El formato real que Innovativos espera NO se conoce (es un bloqueo declarado):
// por eso no hay columnas escritas en código. Cada flota declara su mapeo —qué
// columna sale con qué nombre y de qué campo— en `cp_export_config`, y este módulo
// lo aplica a los documentos APROBADOS para producir CSV o JSON. Cuando llegue el
// formato real, se carga como configuración; no hace falta una versión nueva.
//
// SEGURIDAD DEL ARCHIVO: lo que se exporta lo abre Excel. Todo texto que viene del
// documento de un tercero y empiece con `=`, `+`, `-`, `@`, tabulador o retorno de
// carro se neutraliza anteponiendo `'` (inyección de fórmulas). Los NÚMEROS no se
// tocan: un peso negativo legítimo sigue siendo número.
//
// Nada de esto timbra ni emite: exporta datos que un humano ya aprobó.
// ═══════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { CLAVES_DOC, CLAVES_MERCANCIA, campoDoc, campoMercancia, type CampoValor } from './campos';
import { llaveTexto } from './catalogos';
import { normalizarNumero } from './normalizar';
import type { DocumentoFila } from './repo';

/** Campos «de sistema» que se pueden exportar además de los del complemento. */
export const CAMPOS_SISTEMA = ['documento.id', 'documento.archivo', 'documento.canal', 'documento.formato', 'documento.aprobado_en', 'documento.viaje_folio', 'documento.renglon'] as const;

const TRANSFORMACIONES = ['mayusculas', 'minusculas', 'sin_acentos'] as const;

const ColumnaSchema = z.object({
  encabezado: z.string().trim().min(1).max(60),
  /** `origen_cp`, `mercancia.peso_kg`, `documento.archivo`… o vacío si es una constante. */
  campo: z.string().trim().max(60).optional(),
  constante: z.string().max(100).optional(),
  transformacion: z.enum(TRANSFORMACIONES).optional(),
}).refine((c) => (c.campo ? 1 : 0) + (c.constante !== undefined ? 1 : 0) === 1, { message: 'Cada columna lleva «campo» o «constante», no ambos ni ninguno.' });

export const ExportConfigSchema = z.object({
  /** Una fila por renglón de mercancía (true) o una por documento (false, solo campos del documento). */
  porMercancia: z.boolean().default(true),
  delimitador: z.enum([',', ';', '\t', '|']).default(','),
  encabezados: z.boolean().default(true),
  decimales: z.number().int().min(0).max(6).default(3),
  fecha: z.enum(['iso', 'dd/mm/yyyy']).default('iso'),
  columnas: z.array(ColumnaSchema).min(1).max(80),
});
export type ExportConfig = z.infer<typeof ExportConfigSchema>;
export type ColumnaExport = z.infer<typeof ColumnaSchema>;

export type RutaValida = { tipo: 'doc' | 'mercancia' | 'sistema'; clave: string };

/** ¿Es una ruta de campo exportable? Rechaza todo lo que no esté en la lista cerrada. */
export function resolverRuta(ruta: string): RutaValida | null {
  if (CLAVES_DOC.includes(ruta)) return { tipo: 'doc', clave: ruta };
  if (ruta.startsWith('mercancia.') && CLAVES_MERCANCIA.includes(ruta.slice(10))) return { tipo: 'mercancia', clave: ruta.slice(10) };
  if ((CAMPOS_SISTEMA as readonly string[]).includes(ruta)) return { tipo: 'sistema', clave: ruta };
  return null;
}

export type ResultadoConfig = { ok: true; config: ExportConfig } | { ok: false; errores: string[] };

export function validarConfigExport(crudo: unknown): ResultadoConfig {
  const p = ExportConfigSchema.safeParse(crudo);
  if (!p.success) return { ok: false, errores: p.error.issues.map((i) => `${i.path.join('.') || 'config'}: ${i.message}`) };
  const errores: string[] = [];
  p.data.columnas.forEach((c, i) => {
    if (!c.campo) return;
    const r = resolverRuta(c.campo);
    if (!r) errores.push(`columnas.${i}: «${c.campo}» no es un campo exportable.`);
    else if (!p.data.porMercancia && (r.tipo === 'mercancia' || c.campo === 'documento.renglon')) {
      errores.push(`columnas.${i}: «${c.campo}» es de la mercancía y la exportación es una fila por documento.`);
    }
  });
  const vistos = new Set<string>();
  for (const c of p.data.columnas) {
    if (vistos.has(c.encabezado)) errores.push(`El encabezado «${c.encabezado}» está repetido.`);
    vistos.add(c.encabezado);
  }
  return errores.length > 0 ? { ok: false, errores } : { ok: true, config: p.data };
}

/** El mapeo de arranque (formato «estándar Likida»): una fila por mercancía con los campos del complemento. */
export function configEstandar(): ExportConfig {
  const doc = (campo: string, encabezado: string): ColumnaExport => ({ encabezado, campo });
  return {
    porMercancia: true, delimitador: ',', encabezados: true, decimales: 3, fecha: 'iso',
    columnas: [
      doc('folio_cliente', 'Folio'), doc('fecha_salida', 'FechaSalida'), doc('origen_rfc', 'RFCRemitente'), doc('origen_nombre', 'Remitente'),
      doc('origen_cp', 'CPOrigen'), doc('origen_estado', 'EstadoOrigen'), doc('destino_rfc', 'RFCDestinatario'), doc('destino_nombre', 'Destinatario'),
      doc('destino_cp', 'CPDestino'), doc('destino_estado', 'EstadoDestino'), doc('distancia_km', 'DistanciaKm'),
      doc('mercancia.descripcion', 'Descripcion'), doc('mercancia.bienes_transp', 'ClaveProdServCP'), doc('mercancia.fraccion_arancelaria', 'FraccionArancelaria'),
      doc('mercancia.cantidad', 'Cantidad'), doc('mercancia.clave_unidad', 'ClaveUnidad'), doc('mercancia.peso_kg', 'PesoKg'),
      doc('mercancia.embalaje', 'Embalaje'), doc('mercancia.valor_mercancia', 'ValorMercancia'), doc('mercancia.moneda', 'Moneda'),
      doc('mercancia.material_peligroso', 'MaterialPeligroso'),
      doc('operador_nombre', 'Operador'), doc('operador_licencia', 'Licencia'), doc('unidad_placas', 'Placas'), doc('remolque_placas', 'PlacasRemolque'),
    ],
  };
}

// ── Valores ─────────────────────────────────────────────────────────────────

export type Celda = string | number | boolean | null;

function formatearFecha(iso: string, modo: ExportConfig['fecha']): string {
  if (modo === 'iso') return iso;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const h = /T(\d{2}:\d{2})/.exec(iso);
  return `${m[3]}/${m[2]}/${m[1]}${h ? ` ${h[1]}` : ''}`;
}

function transformar(v: string, t: ColumnaExport['transformacion']): string {
  if (t === 'mayusculas') return v.toUpperCase();
  if (t === 'minusculas') return v.toLowerCase();
  if (t === 'sin_acentos') return v.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return v;
}

function celdaDeCampo(c: CampoValor | undefined, tipo: string, cfg: ExportConfig): Celda {
  if (!c || c.valor === null || c.valor === '') return null;
  if (tipo === 'numero') {
    const n = normalizarNumero(c.valor).valor;
    return n === null ? c.valor : Number(n.toFixed(cfg.decimales));
  }
  if (tipo === 'booleano') return c.valor === 'true' ? 'Sí' : c.valor === 'false' ? 'No' : c.valor;
  if (tipo === 'fecha') return formatearFecha(c.valor, cfg.fecha);
  return c.valor;
}

export interface DocumentoExportable {
  id: string; nombreArchivo: string; canal: string; formato: string; aprobadoEn: string | null; viajeFolio: string | null;
  campos: Record<string, CampoValor>; mercancias: Array<Record<string, CampoValor>>;
}

export function aExportable(d: DocumentoFila, viajeFolio: string | null): DocumentoExportable {
  return {
    id: d.id, nombreArchivo: d.nombreArchivo, canal: d.canal, formato: d.formato, aprobadoEn: d.aprobadoEn, viajeFolio,
    campos: d.extraccion?.campos ?? {}, mercancias: d.extraccion?.mercancias ?? [],
  };
}

function valorColumna(col: ColumnaExport, d: DocumentoExportable, fila: Record<string, CampoValor> | null, idx: number, cfg: ExportConfig): Celda {
  let v: Celda;
  if (col.constante !== undefined) v = col.constante;
  else {
    const r = resolverRuta(col.campo as string) as RutaValida;
    if (r.tipo === 'doc') v = celdaDeCampo(d.campos[r.clave], campoDoc(r.clave)?.tipo ?? 'texto', cfg);
    else if (r.tipo === 'mercancia') v = celdaDeCampo(fila?.[r.clave], campoMercancia(r.clave)?.tipo ?? 'texto', cfg);
    else {
      switch (r.clave) {
        case 'documento.id': v = d.id; break;
        case 'documento.archivo': v = d.nombreArchivo; break;
        case 'documento.canal': v = d.canal; break;
        case 'documento.formato': v = d.formato; break;
        case 'documento.aprobado_en': v = d.aprobadoEn; break;
        case 'documento.viaje_folio': v = d.viajeFolio; break;
        case 'documento.renglon': v = idx + 1; break;
        default: v = null;
      }
    }
  }
  return typeof v === 'string' && col.transformacion ? transformar(v, col.transformacion) : v;
}

/** Las filas del archivo (un objeto por fila, con las claves = encabezados). */
export function construirFilas(docs: DocumentoExportable[], cfg: ExportConfig): Array<Record<string, Celda>> {
  const filas: Array<Record<string, Celda>> = [];
  for (const d of docs) {
    const renglones: Array<Record<string, CampoValor> | null> = cfg.porMercancia ? (d.mercancias.length > 0 ? d.mercancias : [null]) : [null];
    renglones.forEach((r, i) => {
      const fila: Record<string, Celda> = {};
      for (const col of cfg.columnas) fila[col.encabezado] = valorColumna(col, d, r, i, cfg);
      filas.push(fila);
    });
  }
  return filas;
}

// ── CSV ─────────────────────────────────────────────────────────────────────

/** Texto → celda segura: sin fórmulas, con comillas escapadas. Los números se escriben tal cual. */
export function celdaCsv(v: Celda, delimitador: string): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let t = typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return t.includes(delimitador) || /["\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export function aCsv(filas: Array<Record<string, Celda>>, cfg: ExportConfig): string {
  const enc = cfg.columnas.map((c) => c.encabezado);
  const lineas: string[] = [];
  if (cfg.encabezados) lineas.push(enc.map((e) => celdaCsv(e, cfg.delimitador)).join(cfg.delimitador));
  for (const f of filas) lineas.push(enc.map((e) => celdaCsv(f[e] ?? null, cfg.delimitador)).join(cfg.delimitador));
  // BOM: Excel en español abre UTF-8 sin acentos rotos solo con él.
  return `﻿${lineas.join('\r\n')}\r\n`;
}

export function aJson(filas: Array<Record<string, Celda>>): string {
  return `${JSON.stringify({ filas }, null, 2)}\n`;
}

export interface ArchivoExportado {
  contenido: string;
  nombreArchivo: string;
  mime: string;
  filas: number;
  documentos: number;
  omitidos: Array<{ id: string; motivo: string }>;
}

export function nombreSeguro(nombre: string): string {
  return llaveTexto(nombre).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'exportacion';
}

/** Solo los APROBADOS salen; el resto se reporta en `omitidos` (nunca se exporta algo sin revisar). */
export function exportarDocumentos(
  docs: Array<{ doc: DocumentoFila; viajeFolio: string | null }>, formato: 'csv' | 'json', cfg: ExportConfig, nombreConfig: string, ahora = new Date(),
): ArchivoExportado {
  const omitidos: ArchivoExportado['omitidos'] = [];
  const listos: DocumentoExportable[] = [];
  for (const { doc, viajeFolio } of docs) {
    if (doc.estado !== 'aprobado') omitidos.push({ id: doc.id, motivo: `Estado «${doc.estado}»: solo se exportan documentos aprobados.` });
    else if (!doc.extraccion) omitidos.push({ id: doc.id, motivo: 'Sin extracción.' });
    else listos.push(aExportable(doc, viajeFolio));
  }
  const filas = construirFilas(listos, cfg);
  const fecha = ahora.toISOString().slice(0, 10);
  return {
    contenido: formato === 'csv' ? aCsv(filas, cfg) : aJson(filas),
    nombreArchivo: `carta-porte-${nombreSeguro(nombreConfig)}-${fecha}.${formato}`,
    mime: formato === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
    filas: filas.length, documentos: listos.length, omitidos,
  };
}
