import { createHash } from 'node:crypto';
import { logger } from '@/lib/logger';
import { parseRepXml, ingerirRep } from '../intake/rep';
import { guardarFacturaProveedor, estadoSatDeCfdi } from '../proveedores';
import { leerZipSeguro, pareceZip } from './zip_seguro';
import { leerCfdiSeguro } from './xml_seguro';
import {
  leerPdfFactura, esPdf, uuidsEnTexto, requiereRevision, MAX_PDF_BYTES, type PuertosPdf,
} from './pdf_factura';
import { aBuffer } from './bytes';
import * as repoBuzon from './repo';
import type { EstadoRecepcion, TipoRecepcion } from './repo';

// ═══════════════════════════════════════════════════════════════════════════
// LA INGESTA DE UN CORREO DEL BUZÓN (Agente 9) — de los adjuntos descargados a la
// bandeja, archivo por archivo y con rastro de cada uno.
//
// Qué entra ahora (auditoría §3): XML (como siempre), PDF SOLO (se lee y, si la
// lectura es de baja confianza, queda marcado para revisión humana), ZIP (con los
// límites de zip_seguro.ts), y la PAREJA XML+PDF (el PDF se cuelga de su CFDI). La
// factura se deduplica por UUID: el mismo CFDI llegando por XML y por PDF, o dos
// veces, es UNA fila; si el PDF llegó primero y el XML después, el XML COMPLETA la
// fila (dato duro) y quita la marca de revisión.
//
// Cada archivo deja una fila en `buzon_recepcion` (procesada, duplicada, revisión,
// ignorada, RECHAZADA por seguridad, error). Lo transitorio (base caída, visión
// caída, sin presupuesto de tiempo) NO es un descarte: se cuenta como `caidas` y el
// correo se reintenta con todo lo ya hecho idempotente.
//
// Todo lo externo entra por `DepsBuzon`: en producción son los adaptadores reales
// (`depsBuzonReales`), en pruebas dobles de proveedor.
// ═══════════════════════════════════════════════════════════════════════════

export interface AdjuntoBuzon { nombre: string; bytes: Uint8Array }

export interface ContextoCorreo {
  tenantId: string;
  emailId: string;
  rfcFlota: string | null;
  /** Epoch ms hasta el que hay presupuesto de tiempo (la función de Vercel). */
  finPresupuesto: number;
}

/** Un archivo ya abierto (hoja del correo o de un zip). */
interface Hoja { nombre: string; zipOrigen: string | null; bytes: Uint8Array }

export interface DepsBuzon {
  repo: Pick<typeof repoBuzon,
    'registrarRecepcion' | 'recepcionPrevia' | 'subirPdf' | 'facturaPorUuid' | 'adjuntarPdfAFactura' | 'completarFacturaConXml' | 'guardarFacturaDePdf'>;
  pdf: PuertosPdf;
  estadoSat: typeof estadoSatDeCfdi;
  guardarFactura: typeof guardarFacturaProveedor;
  parseRep: typeof parseRepXml;
  ingerirRep: typeof ingerirRep;
  ahoraMs: () => number;
}

export interface ResultadoDoc {
  nombre: string;
  estado: EstadoRecepcion;
  motivo: string | null;
  cfdiUuid: string | null;
}

export interface ResumenCorreo {
  /** Entraron a la bandeja (factura nueva, REP o completada con su XML). */
  guardadas: number;
  duplicadas: number;
  /** Esperan a una persona (PDF sin datos legibles o de baja confianza). */
  revision: number;
  /** Rechazadas por seguridad o por no ser lo que dicen. */
  rechazadas: number;
  ignoradas: number;
  /** Fallos TRANSITORIOS: el correo debe reintentarse (503). */
  caidas: number;
  documentos: ResultadoDoc[];
}

/** Tope de archivos que se abren por correo (zips incluidos): un correo no es una carga masiva. */
export const MAX_HOJAS_POR_CORREO = 60;
/** Margen mínimo de tiempo para empezar a leer un PDF por visión. */
const MIN_MS_VISION = 8_000;
const MAX_MS_VISION = 45_000;

const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

function tipoDe(bytes: Uint8Array): TipoRecepcion {
  if (pareceZip(bytes)) return 'zip';
  if (esPdf(bytes)) return 'pdf';
  const cabeza = aBuffer(bytes.subarray(0, 64)).toString('latin1').replace(/^﻿/, '').trimStart();
  return cabeza.startsWith('<') ? 'xml' : 'otro';
}

const sinExtension = (n: string): string => n.replace(/\.[^.]+$/, '').toLowerCase();

export async function procesarCorreoBuzon(
  ctx: ContextoCorreo, adjuntos: readonly AdjuntoBuzon[], deps: DepsBuzon,
): Promise<ResumenCorreo> {
  const resumen: ResumenCorreo = { guardadas: 0, duplicadas: 0, revision: 0, rechazadas: 0, ignoradas: 0, caidas: 0, documentos: [] };
  const { tenantId, emailId } = ctx;

  const anotar = async (h: { nombre: string; zipOrigen?: string | null; bytes: Uint8Array; sha: string }, tipo: TipoRecepcion, estado: EstadoRecepcion, extra: {
    motivo?: string | null; cfdiUuid?: string | null; facturaId?: string | null; confianza?: number | null; storageRuta?: string | null;
  } = {}) => {
    await deps.repo.registrarRecepcion(tenantId, {
      emailId, nombre: h.nombre, zipOrigen: h.zipOrigen ?? null, tipo, bytes: h.bytes.length, sha256: h.sha, estado, ...extra,
    });
    resumen.documentos.push({ nombre: h.nombre, estado, motivo: extra.motivo ?? null, cfdiUuid: extra.cfdiUuid ?? null });
    if (estado === 'procesada') resumen.guardadas++;
    else if (estado === 'duplicada') resumen.duplicadas++;
    else if (estado === 'revision') resumen.revision++;
    else if (estado === 'rechazada') resumen.rechazadas++;
    else if (estado === 'ignorada') resumen.ignoradas++;
  };
  const caida = (nombre: string, e: unknown) => {
    // Un entorno sin la 0530 NO puede guardar este archivo (PDF/bucket): es permanente, no se reintenta el correo
    // (reintentarlo daría 503 para siempre sobre los XML buenos del mismo correo). Se cuenta como ignorado.
    if (e instanceof repoBuzon.BuzonSinMigrar) {
      resumen.ignoradas++;
      resumen.documentos.push({ nombre, estado: 'ignorada', motivo: 'el buzón de PDF aún no está disponible en este entorno (falta la 0530)', cfdiUuid: null });
      logger.warn('buzon.documento_sin_migrar', { emailId, tenantId, archivo: repoBuzon.nombreVisible(nombre) });
      return;
    }
    resumen.caidas++;
    logger.warn('buzon.documento_caido', { emailId, tenantId, archivo: repoBuzon.nombreVisible(nombre), err: e instanceof Error ? e.message : String(e) });
  };

  // ── 1. Abrir: zips a sus hojas, con límites; lo demás tal cual ──────────────
  const hojas: Hoja[] = [];
  for (const adj of adjuntos) {
    const sha = sha256(adj.bytes);
    const tipo = tipoDe(adj.bytes);
    try {
      if (tipo !== 'zip') { hojas.push({ nombre: adj.nombre, zipOrigen: null, bytes: adj.bytes }); continue; }
      const z = leerZipSeguro(adj.bytes);
      if (z.rechazado) {
        await anotar({ nombre: adj.nombre, bytes: adj.bytes, sha }, 'zip', 'rechazada', { motivo: `zip rechazado por seguridad: ${z.rechazado}` });
        continue;
      }
      const omitidas = z.omitidas.filter((o) => o.motivo !== 'tipo_ignorado');
      const resumenOmitidas = omitidas.length > 0
        ? ` · ${omitidas.length} omitida(s): ${[...new Set(omitidas.map((o) => o.motivo))].join(', ')}`
        : '';
      await anotar({ nombre: adj.nombre, bytes: adj.bytes, sha }, 'zip', z.entradas.length > 0 ? 'procesada' : 'ignorada', {
        motivo: `${z.entradas.length} archivo(s) XML/PDF leído(s)${resumenOmitidas}`.slice(0, 300),
      });
      // En `procesada` el zip contó como guardada: no es una factura. Se corrige el conteo (el zip es el contenedor).
      if (z.entradas.length > 0) resumen.guardadas--;
      for (const e of z.entradas) hojas.push({ nombre: e.nombre, zipOrigen: adj.nombre, bytes: e.bytes });
    } catch (e) {
      caida(adj.nombre, e);
    }
  }

  // Tope y dedup por contenido dentro del correo.
  const vistos = new Set<string>();
  const unicas: Array<Hoja & { sha: string; tipo: TipoRecepcion }> = [];
  for (const h of hojas) {
    if (unicas.length >= MAX_HOJAS_POR_CORREO) {
      logger.warn('buzon.correo_con_demasiadas_hojas', { emailId, tenantId, tope: MAX_HOJAS_POR_CORREO });
      break;
    }
    const sha = sha256(h.bytes);
    if (vistos.has(sha)) continue;
    vistos.add(sha);
    unicas.push({ ...h, sha, tipo: tipoDe(h.bytes) });
  }

  // CFDI de este correo, para emparejar PDFs: uuid → factura y nombre sin extensión → uuid.
  const delCorreo = new Map<string, { facturaId: string | null }>();
  const porNombre = new Map<string, string>();

  // ── 2. Los XML primero ─────────────────────────────────────────────────────
  for (const h of unicas.filter((x) => x.tipo === 'xml')) {
    try {
      const previa = await deps.repo.recepcionPrevia(tenantId, h.sha);
      if (previa) {
        await anotar(h, 'xml', 'duplicada', { motivo: 'archivo ya recibido antes', cfdiUuid: previa.cfdiUuid, facturaId: previa.facturaId });
        if (previa.cfdiUuid) { delCorreo.set(previa.cfdiUuid, { facturaId: previa.facturaId }); porNombre.set(sinExtension(h.nombre), previa.cfdiUuid); }
        continue;
      }
      const leido = leerCfdiSeguro(h.bytes);
      if (!leido.ok) {
        if (leido.motivo === 'no_es_cfdi') await anotar(h, 'xml', 'ignorada', { motivo: 'es un XML pero no un CFDI' });
        else await anotar(h, 'xml', 'rechazada', { motivo: `xml rechazado: ${leido.motivo}` });
        continue;
      }
      const { texto, cfdi } = leido;

      // Un REP adjunto (tipo P) no es una factura: libera el IVA de un gasto ya capturado (fase 7, 0199).
      if (cfdi.tipoComprobante === 'P') {
        const rep = deps.parseRep(texto);
        if (!rep) { await anotar(h, 'xml', 'ignorada', { motivo: 'REP ilegible' }); continue; }
        const r = await deps.ingerirRep(tenantId, rep, texto, ctx.finPresupuesto);
        // Pendientes = el reloj cortó a media lista: el correo se reintenta y retoma (ingerir es idempotente).
        if (r.pendientes > 0) { resumen.caidas++; continue; }
        await anotar(h, 'xml', 'procesada', { motivo: 'REP registrado', cfdiUuid: rep.uuid ?? null });
        continue;
      }

      // El estatus SAT se consulta con el adjunto en la mano; `consultarCFDI` no lanza (timeout → 'pendiente').
      const estadoSat = await deps.estadoSat(cfdi);
      const g = await deps.guardarFactura(tenantId, cfdi, texto, ctx.rfcFlota, 'correo', estadoSat);
      const uuid = cfdi.uuid ? cfdi.uuid.toLowerCase() : null;
      if (g.ok) {
        await anotar(h, 'xml', 'procesada', { cfdiUuid: uuid, facturaId: g.facturaId });
        if (uuid) { delCorreo.set(uuid, { facturaId: g.facturaId }); porNombre.set(sinExtension(h.nombre), uuid); }
      } else if (g.motivo === 'duplicada' && uuid) {
        // ¿La fila existente se leyó de un PDF? Entonces este XML la COMPLETA con el dato duro.
        const completada = await deps.repo.completarFacturaConXml(tenantId, uuid, cfdi, texto, ctx.rfcFlota, estadoSat);
        const existente = await deps.repo.facturaPorUuid(tenantId, uuid);
        if (completada) await anotar(h, 'xml', 'procesada', { cfdiUuid: uuid, facturaId: existente?.id ?? null, motivo: 'completó con el XML una factura leída de un PDF' });
        else await anotar(h, 'xml', 'duplicada', { cfdiUuid: uuid, facturaId: existente?.id ?? null, motivo: 'CFDI ya recibido (mismo folio fiscal)' });
        if (existente) { delCorreo.set(uuid, { facturaId: existente.id }); porNombre.set(sinExtension(h.nombre), uuid); }
      } else if (g.motivo === 'error' && cfdi.uuid && typeof cfdi.total === 'number') {
        // Con UUID y total es la base la que falló: transitorio.
        resumen.caidas++;
      } else {
        await anotar(h, 'xml', 'ignorada', { motivo: 'CFDI sin folio fiscal o sin total' });
      }
    } catch (e) {
      caida(h.nombre, e);
    }
  }

  // ── 3. Los PDF: pareja de un CFDI, o factura de PDF solo ───────────────────
  for (const h of unicas.filter((x) => x.tipo === 'pdf')) {
    try {
      const previa = await deps.repo.recepcionPrevia(tenantId, h.sha);
      if (previa) {
        await anotar(h, 'pdf', 'duplicada', { motivo: 'archivo ya recibido antes', cfdiUuid: previa.cfdiUuid, facturaId: previa.facturaId });
        continue;
      }
      if (h.bytes.length > MAX_PDF_BYTES) { await anotar(h, 'pdf', 'rechazada', { motivo: 'pdf demasiado grande' }); continue; }
      const t = await deps.pdf.leerTexto(h.bytes);
      if (!t.ok) {
        await anotar(h, 'pdf', 'rechazada', { motivo: t.motivo === 'protegido' ? 'pdf protegido con contraseña' : 'pdf corrupto o ilegible' });
        continue;
      }

      // (a) ¿Es la pareja de un CFDI? Por folio fiscal en su texto (de este correo o ya guardado) o por nombre.
      const uuidsPdf = uuidsEnTexto(t.texto);
      let pareja: { uuid: string; facturaId: string | null } | null = null;
      for (const u of uuidsPdf) {
        const aqui = delCorreo.get(u);
        if (aqui) { pareja = { uuid: u, facturaId: aqui.facturaId }; break; }
      }
      if (!pareja) {
        const porNom = porNombre.get(sinExtension(h.nombre));
        if (porNom) pareja = { uuid: porNom, facturaId: delCorreo.get(porNom)?.facturaId ?? null };
      }
      if (!pareja && uuidsPdf.length === 1) {
        const ex = await deps.repo.facturaPorUuid(tenantId, uuidsPdf[0]);
        if (ex) pareja = { uuid: uuidsPdf[0], facturaId: ex.id };
      }
      if (pareja?.facturaId) {
        const ruta = await deps.repo.subirPdf(tenantId, h.sha, h.bytes);
        const colgado = await deps.repo.adjuntarPdfAFactura(tenantId, pareja.facturaId, { ruta, sha256: h.sha, nombre: h.nombre });
        await anotar(h, 'pdf', colgado ? 'procesada' : 'duplicada', {
          cfdiUuid: pareja.uuid, facturaId: pareja.facturaId, storageRuta: ruta,
          motivo: colgado ? 'PDF emparejado con su CFDI' : 'esa factura ya tenía su PDF',
        });
        // El PDF emparejado no es una factura nueva: no suma a «guardadas».
        if (colgado) resumen.guardadas--;
        continue;
      }

      // (b) PDF SOLO: se lee. Sin tiempo para la visión no se empieza: el correo se reintenta.
      const restante = ctx.finPresupuesto - deps.ahoraMs();
      const r = await leerPdfFactura(h.bytes, deps.pdf, {
        textoYaLeido: t.texto, signal: AbortSignal.timeout(Math.max(1, Math.min(MAX_MS_VISION, restante))),
      });
      if (!r.ok && r.motivo === 'transitorio') { resumen.caidas++; continue; }
      if (!r.ok && restante < MIN_MS_VISION && (r.motivo === 'sin_imagenes' || r.motivo === 'ilegible')) { resumen.caidas++; continue; }

      const ruta = await deps.repo.subirPdf(tenantId, h.sha, h.bytes);
      if (!r.ok) {
        // Sin datos legibles: queda en revisión CON el PDF guardado para que una persona lo mire o suba el XML.
        const motivo: Record<string, string> = {
          ilegible: 'no se pudo leer el PDF', sin_uuid: 'el PDF no trae un folio fiscal legible', sin_total: 'el PDF no trae un total legible',
          sin_imagenes: 'el PDF no se pudo convertir a imagen', corrupto: 'pdf corrupto', protegido: 'pdf protegido con contraseña',
          no_es_pdf: 'no es un PDF', demasiado_grande: 'pdf demasiado grande',
        };
        await anotar(h, 'pdf', 'revision', { motivo: `${motivo[r.motivo] ?? r.motivo}: revisar a mano o pedir el XML`, storageRuta: ruta });
        continue;
      }

      const revisar = requiereRevision(r.datos.confianza);
      const g = await deps.repo.guardarFacturaDePdf(tenantId, r.datos, ctx.rfcFlota, {
        requiereRevision: revisar, pdf: { ruta, sha256: h.sha, nombre: h.nombre },
      });
      if (g.ok) {
        await anotar(h, 'pdf', revisar ? 'revision' : 'procesada', {
          cfdiUuid: r.datos.uuid, facturaId: g.facturaId, confianza: r.datos.confianza, storageRuta: ruta,
          motivo: revisar ? `lectura de PDF de baja confianza (${r.datos.confianza}): una persona debe cotejarla` : `leída del ${r.datos.fuente === 'pdf_texto' ? 'texto' : 'PDF por visión'}`,
        });
        delCorreo.set(r.datos.uuid, { facturaId: g.facturaId });
      } else if (g.motivo === 'duplicada') {
        const ex = await deps.repo.facturaPorUuid(tenantId, r.datos.uuid);
        if (ex && !ex.tienePdf) await deps.repo.adjuntarPdfAFactura(tenantId, ex.id, { ruta, sha256: h.sha, nombre: h.nombre });
        await anotar(h, 'pdf', 'duplicada', { cfdiUuid: r.datos.uuid, facturaId: ex?.id ?? null, storageRuta: ruta, motivo: 'CFDI ya recibido (mismo folio fiscal)' });
      } else {
        resumen.caidas++;
      }
    } catch (e) {
      caida(h.nombre, e);
    }
  }

  // ── 4. Lo que no es XML, PDF ni zip ────────────────────────────────────────
  for (const h of unicas.filter((x) => x.tipo === 'otro' || x.tipo === 'zip')) {
    try {
      // Un zip dentro de un zip ya lo abrió `leerZipSeguro`; aquí solo llegan archivos desconocidos.
      await anotar(h, 'otro', 'ignorada', { motivo: 'tipo de archivo que el buzón no lee (solo XML, PDF y zip)' });
    } catch (e) {
      caida(h.nombre, e);
    }
  }

  return resumen;
}
