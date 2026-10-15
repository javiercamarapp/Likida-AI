// Dobles y datos SINTÉTICOS de la respuesta con el CCP timbrado (T-A3-33): ni una persona ni una empresa reales.
import type { ResultadoEnvio } from '@/lib/correo/enviar';
import type { Correo } from '@/lib/correo/plantilla';
import type { DepsCcp, EnvioPropio, EstadoCcpTimbrado, FilaCcp, NuevaFilaCcp } from './ccp_respuesta';

export const TENANT = '11111111-1111-4111-8111-111111111111';
export const OTRO_TENANT = '22222222-2222-4222-8222-222222222222';
export const UUID_FISCAL = 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb';
export const REFERENCIA = 'REF-0001';

export function xmlCcp(uuid: string | null = UUID_FISCAL, folio = 'F-100'): Uint8Array {
  const timbre = uuid ? `<tfd:TimbreFiscalDigital Version="1.1" UUID="${uuid.toUpperCase()}"/>` : '';
  return new TextEncoder().encode(
    `<?xml version="1.0" encoding="UTF-8"?><cfdi:Comprobante Version="4.0" Serie="S" Folio="${folio}" TipoDeComprobante="T">`
    + `<cfdi:Complemento><cartaporte31:CartaPorte Version="3.1" TranspInternac="No"/>${timbre}</cfdi:Complemento></cfdi:Comprobante>`,
  );
}
export const xmlSinCartaPorte = (): Uint8Array =>
  new TextEncoder().encode('<cfdi:Comprobante Version="4.0"><cfdi:Complemento><tfd:TimbreFiscalDigital UUID="aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb"/></cfdi:Complemento></cfdi:Comprobante>');
export const pdfSintetico = (): Uint8Array => new TextEncoder().encode('%PDF-1.4\n% sintetico\n%%EOF');

export interface EstadoDoble {
  filas: FilaCcp[];
  correos: Array<{ para: string; correo: Correo; adjuntos: Array<{ filename: string; content: string; contentType: string }>; llave: string }>;
  archivos: Map<string, Uint8Array>;
  logs: Array<{ evento: string; datos: Record<string, string | number | boolean> }>;
  config: { activa: boolean | 'sin_migracion' };
  envios: Map<string, EnvioPropio>; // `${tenant}|${referencia}`
  correoOk: boolean;
  /** Para simular la carrera de dos hilos: el primer `marcarRespondido` pierde. */
  perderCandado: boolean;
}

export function dobleCcp(parcial: Partial<EstadoDoble> = {}): { deps: DepsCcp; e: EstadoDoble } {
  const e: EstadoDoble = {
    filas: [], correos: [], archivos: new Map(), logs: [], config: { activa: true },
    envios: new Map([[`${TENANT}|${REFERENCIA}`, { envioId: 'e0000000-0000-4000-8000-000000000001', documentoId: 'd0000000-0000-4000-8000-000000000001', remitente: 'Cliente Sintetico <compras@cliente-sintetico.test>', remitenteReconocido: true }]]),
    correoOk: true, perderCandado: false, ...parcial,
  };
  let n = 0;
  const deps: DepsCcp = {
    buscarEnvio: async (t, r) => e.envios.get(`${t}|${r}`) ?? null,
    respuestaActiva: async () => e.config.activa,
    buscarPorUuid: async (t, u) => e.filas.find((f) => f.tenantId === t && f.uuid === u) ?? null,
    subirArchivo: async (ruta, bytes) => { e.archivos.set(ruta, bytes); },
    descargarArchivo: async (ruta) => { const b = e.archivos.get(ruta); if (!b) throw new Error('sin archivo'); return b; },
    insertar: async (f: NuevaFilaCcp) => {
      const previa = e.filas.find((x) => x.tenantId === f.tenantId && x.uuid === f.uuid);
      if (previa) return { creada: false, fila: previa };
      const fila: FilaCcp = { id: `c${++n}`, tenantId: f.tenantId, documentoId: f.documentoId, envioId: f.envioId, uuid: f.uuid, pdfRuta: f.pdfRuta, xmlRuta: f.xmlRuta, destinoCorreo: f.destinoCorreo, estado: f.estado, respondidoEn: null };
      e.filas.push(fila);
      return { creada: true, fila };
    },
    destinoYaConfirmado: async (t, d) => e.filas.some((f) => f.tenantId === t && f.destinoCorreo === d && f.estado === 'respondido'),
    fijarDestino: async (t, id, d) => { const f = e.filas.find((x) => x.tenantId === t && x.id === id); if (f && f.estado !== 'respondido') f.destinoCorreo = d; },
    marcarRespondido: async (t, id) => {
      if (e.perderCandado) { e.perderCandado = false; return false; }
      const f = e.filas.find((x) => x.tenantId === t && x.id === id);
      if (!f || f.respondidoEn !== null || !['guardado', 'pendiente_confirmacion', 'error_envio'].includes(f.estado) || !f.destinoCorreo) return false;
      f.estado = 'respondido'; f.respondidoEn = '2026-10-15T12:00:00.000Z';
      return true;
    },
    liberarRespuesta: async (t, id) => {
      const f = e.filas.find((x) => x.tenantId === t && x.id === id);
      if (!f || f.estado !== 'respondido') return false;
      f.estado = 'error_envio' as EstadoCcpTimbrado; f.respondidoEn = null;
      return true;
    },
    enviarCorreo: async (para, correo, adjuntos, llave): Promise<ResultadoEnvio> => {
      if (!e.correoOk) return { ok: false, motivo: 'rechazado', detalle: 'HTTP 500', status: 500 };
      e.correos.push({ para, correo, adjuntos, llave });
      return { ok: true, id: `mail-${e.correos.length}` };
    },
    registrar: (evento, datos) => { e.logs.push({ evento, datos }); },
  };
  return { deps, e };
}
