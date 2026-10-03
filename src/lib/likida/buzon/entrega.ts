import { logger } from '@/lib/logger';
import { toCsv } from '../export';
import { mapaDeFormato } from '../proveedores';
import { crearZip, type EntradaParaZip } from './zip_escribir';
import { bufferDeTexto, copiar } from './bytes';
import type { ResultadoEnvio } from '@/lib/correo/enviar';
import type { Correo } from '@/lib/correo/plantilla';
import type * as repo from './entrega_repo';
import type { Entrega } from './entrega_repo';
import {
  tocaLoteAutomatico, decidirTamanoLote, trasFallo, nombreCsv, nombreZip, nombreArchivoFactura, textoCorreoEntrega,
  MAX_FACTURAS_POR_LOTE, RETRASO_CONFIRMACION_MS,
} from './entrega_pura';

// ═══════════════════════════════════════════════════════════════════════════
// LA ENTREGA AL CONTADOR (Agente 9) — la orquestación. Todo lo externo entra por
// `DepsEntrega` (en producción `depsEntregaReales`, en pruebas dobles de proveedor).
//
//   armar:  las aprobadas sin lote se RESERVAN (UPDATE condicional) en un lote; el lote
//           nace «pendiente». Un lote automático por flota por día (México).
//   enviar: CLAIM con lease → CSV + ZIP(XML/PDF) → correo con llave de idempotencia
//           (un crash entre «Resend aceptó» y «lo anoté» no manda dos veces) →
//           «enviada»; fallo → backoff 15 min / 1 h / 4 h / 12 h y a la 5.ª «fallida»,
//           visible para que una persona reintente o cancele.
//   confirmar: el webhook de Resend lo lleva a «entregada» o «rebotada» (y un rebote
//           suelta las facturas para rearmar con el correo corregido).
// ═══════════════════════════════════════════════════════════════════════════

export interface DepsEntrega {
  repo: Pick<typeof repo,
    'leerConfigEntrega' | 'flotasConEntregaAutomatica' | 'ultimoLoteAutomaticoEn' | 'facturasSinEntregar' | 'crearLote'
    | 'reservarFacturas' | 'ajustarLote' | 'borrarLote' | 'lotesParaEnviar' | 'reclamarLote' | 'facturasDelLote'
    | 'marcarEnviada' | 'marcarFallo' | 'anotarEvento' | 'marcarRetrasos'>;
  enviarCorreo: (para: string[], correo: Correo, op: { idempotencyKey: string; adjuntos: Array<{ filename: string; content: string; contentType: string }> }) => Promise<ResultadoEnvio>;
  /** Descarga el PDF del bucket; lanza si no puede (un PDF que no baja no tumba el lote: se omite y se dice). */
  descargarPdf: (ruta: string) => Promise<Uint8Array>;
  nombreFlota: (tenantId: string) => Promise<string | null>;
  ahora: () => Date;
}

export type ResultadoArmado =
  | { armado: true; entregaId: string; nFacturas: number; total: number }
  | { armado: false; motivo: 'apagada' | 'sin_destinatarios' | 'sin_facturas' | 'bajo_minimo' | 'no_disponible' | 'carrera' };

/** Arma un lote con las aprobadas sin entregar. `manual` = una persona lo pidió (ignora el mínimo y la hora). */
export async function armarLote(
  deps: DepsEntrega, tenantId: string, disparo: 'manual' | 'automatica', creadoPor: string | null,
): Promise<ResultadoArmado> {
  const { config, disponible } = await deps.repo.leerConfigEntrega(tenantId);
  if (!disponible) return { armado: false, motivo: 'no_disponible' };
  if (!config.activo) return { armado: false, motivo: 'apagada' };
  if (config.destinatarios.length === 0) return { armado: false, motivo: 'sin_destinatarios' };

  const candidatas = await deps.repo.facturasSinEntregar(tenantId, MAX_FACTURAS_POR_LOTE + 1);
  const cuantas = decidirTamanoLote(candidatas.length, disparo, config.minFacturas);
  if (cuantas === 0) return { armado: false, motivo: candidatas.length === 0 ? 'sin_facturas' : 'bajo_minimo' };
  const elegidas = candidatas.slice(0, cuantas);

  const suma = (fs: typeof elegidas) => Math.round(fs.reduce((s, f) => s + f.total, 0) * 100) / 100;
  const entregaId = await deps.repo.crearLote(tenantId, {
    disparo, creadoPor, formato: config.formato, incluyeZip: config.incluirZip, destinatarios: config.destinatarios,
    nFacturas: elegidas.length, total: suma(elegidas),
  });
  await deps.repo.anotarEvento(tenantId, entregaId, 'creada', `${disparo}: ${elegidas.length} factura(s)`);
  try {
    const reservadas = new Set(await deps.repo.reservarFacturas(tenantId, entregaId, elegidas.map((f) => f.id)));
    if (reservadas.size === 0) {
      // Otra corrida se llevó todas: el lote vacío no existe.
      await deps.repo.borrarLote(tenantId, entregaId);
      return { armado: false, motivo: 'carrera' };
    }
    if (reservadas.size < elegidas.length) {
      const propias = elegidas.filter((f) => reservadas.has(f.id));
      await deps.repo.ajustarLote(tenantId, entregaId, propias.length, suma(propias));
      return { armado: true, entregaId, nFacturas: propias.length, total: suma(propias) };
    }
  } catch (e) {
    // Sin reserva el lote no puede enviarse: se retira (lo reservado a medias lo suelta la cancelación humana).
    logger.error('buzon_entrega.armado_fallo', { tenantId, entregaId, err: e instanceof Error ? e.message : String(e) });
    await deps.repo.borrarLote(tenantId, entregaId).catch(() => {});
    throw e;
  }
  return { armado: true, entregaId, nFacturas: elegidas.length, total: suma(elegidas) };
}

export type ResultadoEnvioLote = { estado: 'enviada' | 'reprogramada' | 'fallida' | 'no_tomado'; detalle?: string };

/** Envía UN lote (ya vencido). El claim decide quién lo manda; el que pierde no hace nada. */
export async function enviarLote(deps: DepsEntrega, lote: Entrega): Promise<ResultadoEnvioLote> {
  const ahora = deps.ahora();
  const tomado = await deps.repo.reclamarLote(lote, ahora);
  if (!tomado) return { estado: 'no_tomado' };
  await deps.repo.anotarEvento(tomado.tenantId, tomado.id, 'intento', `intento ${tomado.intentos}`);

  const fallar = async (mensaje: string): Promise<ResultadoEnvioLote> => {
    const t = trasFallo(tomado.intentos, deps.ahora());
    await deps.repo.marcarFallo(tomado.tenantId, tomado.id, t.estado, t.proximoIntentoEn, mensaje);
    await deps.repo.anotarEvento(tomado.tenantId, tomado.id, 'fallo', mensaje);
    if (t.estado === 'pendiente') {
      await deps.repo.anotarEvento(tomado.tenantId, tomado.id, 'reintento_programado', `próximo intento ${t.proximoIntentoEn?.toISOString()}`);
      return { estado: 'reprogramada', detalle: mensaje };
    }
    return { estado: 'fallida', detalle: mensaje };
  };

  try {
    const filas = await deps.repo.facturasDelLote(tomado.tenantId, tomado.id);
    if (filas.length === 0) return await fallar('El lote no tiene facturas reservadas.');

    const mapa = mapaDeFormato(tomado.formato);
    const csv = toCsv(filas.map((f) => mapa(f.factura)));
    const adjuntos: Array<{ filename: string; content: string; contentType: string }> = [
      { filename: nombreCsv(tomado.formato, ahora), content: bufferDeTexto(csv).toString('base64'), contentType: 'text/csv; charset=utf-8' },
    ];

    let faltanXml = 0;
    const sinPdf: string[] = [];
    if (tomado.incluyeZip) {
      const entradas: EntradaParaZip[] = [];
      for (const f of filas) {
        const uuid = f.factura.cfdiUuid;
        if (f.xmlCrudo) entradas.push({ nombre: nombreArchivoFactura(f.factura.emisorRfc, uuid, 'xml'), bytes: new Uint8Array(bufferDeTexto(f.xmlCrudo)) });
        else faltanXml++;
        if (f.pdfRuta) {
          try { entradas.push({ nombre: nombreArchivoFactura(f.factura.emisorRfc, uuid, 'pdf'), bytes: await deps.descargarPdf(f.pdfRuta) }); }
          catch (e) {
            sinPdf.push(uuid);
            logger.warn('buzon_entrega.pdf_no_bajo', { tenantId: tomado.tenantId, entregaId: tomado.id, err: e instanceof Error ? e.message : String(e) });
          }
        }
      }
      if (entradas.length > 0) {
        adjuntos.push({ filename: nombreZip(ahora), content: copiar(crearZip(entradas, ahora)).toString('base64'), contentType: 'application/zip' });
      }
    } else {
      faltanXml = filas.filter((f) => !f.xmlCrudo).length;
    }

    const nombre = await deps.nombreFlota(tomado.tenantId).catch(() => null);
    const t = textoCorreoEntrega({ nFacturas: filas.length, total: tomado.total, formato: tomado.formato, incluyeZip: tomado.incluyeZip, faltanXml, nombreFlota: nombre });
    if (sinPdf.length > 0) t.parrafos.splice(t.parrafos.length - 1, 0, `${sinPdf.length} PDF no se pudieron adjuntar en este envío; el XML sí va.`);
    const correo: Correo = { ...t, porQueLoRecibes: 'Recibes esto porque la flota te registró como destinataria de sus facturas de proveedores aprobadas.', datos: [['Facturas', String(filas.length)], ['Total', `$${tomado.total.toFixed(2)} MXN`]] };

    // La llave NO lleva el intento: un reintento tras un timeout ambiguo debe deduplicarse en Resend.
    const r = await deps.enviarCorreo(tomado.destinatarios, correo, { idempotencyKey: `buzon-entrega-${tomado.id}`, adjuntos });
    if (!r.ok) {
      const motivo = r.motivo === 'sin_configurar' ? 'El correo no está configurado en este entorno.'
        : r.motivo === 'rechazado' ? `Resend rechazó el envío: ${r.detalle}` : `Falló la red al enviar: ${r.detalle}`;
      return await fallar(motivo);
    }
    if (!r.id) return await fallar('Resend aceptó el correo pero no devolvió su id: no se puede confirmar.');
    await deps.repo.marcarEnviada(tomado.tenantId, tomado.id, r.id, deps.ahora());
    await deps.repo.anotarEvento(tomado.tenantId, tomado.id, 'enviada', `a ${tomado.destinatarios.length} destinatario(s)`);
    return { estado: 'enviada' };
  } catch (e) {
    logger.error('buzon_entrega.enviar_fallo', { tenantId: tomado.tenantId, entregaId: tomado.id, err: e instanceof Error ? e.message : String(e) });
    return await fallar('Falló la preparación del lote; se reintenta.').catch(() => ({ estado: 'fallida' as const, detalle: 'no se pudo ni anotar el fallo' }));
  }
}

export interface ResultadoPasada {
  armados: number;
  enviados: number;
  reprogramados: number;
  fallidos: number;
  retrasados: number;
  errores: number;
}

/** Una pasada del cron: arma los lotes automáticos que tocan, envía los vencidos y marca retrasos. */
export async function procesarEntregas(deps: DepsEntrega, opciones: { vencePorReloj?: number } = {}): Promise<ResultadoPasada> {
  const r: ResultadoPasada = { armados: 0, enviados: 0, reprogramados: 0, fallidos: 0, retrasados: 0, errores: 0 };
  const quedaTiempo = () => opciones.vencePorReloj === undefined || deps.ahora().getTime() < opciones.vencePorReloj;

  for (const flota of await deps.repo.flotasConEntregaAutomatica()) {
    if (!quedaTiempo()) break;
    try {
      const ultimo = await deps.repo.ultimoLoteAutomaticoEn(flota.tenantId);
      if (!tocaLoteAutomatico(flota.config, deps.ahora(), ultimo)) continue;
      const a = await armarLote(deps, flota.tenantId, 'automatica', null);
      if (a.armado) r.armados++;
    } catch (e) {
      r.errores++;
      logger.error('buzon_entrega.armar_automatico_fallo', { tenantId: flota.tenantId, err: e instanceof Error ? e.message : String(e) });
    }
  }

  for (const lote of await deps.repo.lotesParaEnviar(deps.ahora())) {
    if (!quedaTiempo()) break;
    try {
      const e = await enviarLote(deps, lote);
      if (e.estado === 'enviada') r.enviados++;
      else if (e.estado === 'reprogramada') r.reprogramados++;
      else if (e.estado === 'fallida') r.fallidos++;
    } catch (e) {
      r.errores++;
      logger.error('buzon_entrega.enviar_pasada_fallo', { entregaId: lote.id, err: e instanceof Error ? e.message : String(e) });
    }
  }

  try { r.retrasados = await deps.repo.marcarRetrasos(deps.ahora(), RETRASO_CONFIRMACION_MS); }
  catch (e) { r.errores++; logger.warn('buzon_entrega.retrasos_fallo', { err: e instanceof Error ? e.message : String(e) }); }
  return r;
}
