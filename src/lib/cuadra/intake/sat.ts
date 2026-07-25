// ═══════════════════════════════════════════════════════════════════════════
// Consulta de estatus de CFDI ante el SAT — ConsultaCFDIService (SOAP público).
//
// REGLA DE ORO (demo-safe): esta llamada JAMÁS tumba la liquidación. Timeout
// corto; ante CUALQUIER error/timeout/SAT caído → estado 'pendiente' y el flujo
// continúa. Los pasos que NO dependen de red (QR, RFC receptor, dedup por UUID)
// funcionan aunque el SAT esté caído el día del demo.
//
// Verificar: formato exacto de `tt` en la expresión impresa (Anexo 20) y que el
// endpoint/WSDL siga vigente (el SAT cambia rutas sin aviso).
// ═══════════════════════════════════════════════════════════════════════════

import { logger } from '@/lib/logger';

const ENDPOINT = 'https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc';
const SOAP_ACTION = 'http://tempuri.org/IConsultaCFDIService/Consulta';

export type EstadoSat = 'vigente' | 'cancelado' | 'no_encontrado' | 'pendiente';

export interface ResultadoSat {
  estado: EstadoSat;
  /** true = emisor en lista negra EFOS (art. 69-B) → fraude. null = no evaluable. */
  efos: boolean | null;
}

export interface QrCfdi {
  re?: string;   // RFC emisor
  rr?: string;   // RFC receptor
  tt?: number;   // total
  id?: string;   // UUID
}

export async function consultarCFDI(q: QrCfdi, timeoutMs = 4000): Promise<ResultadoSat> {
  if (!q.id) return { estado: 'pendiente', efos: null }; // sin UUID no hay qué consultar
  const expr = `?re=${q.re ?? ''}&rr=${q.rr ?? ''}&tt=${q.tt != null ? q.tt.toFixed(6) : ''}&id=${q.id}`;
  const soap =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">` +
    `<s:Body><tem:Consulta><tem:expresionImpresa><![CDATA[${expr}]]></tem:expresionImpresa></tem:Consulta></s:Body></s:Envelope>`;
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: SOAP_ACTION },
      body: soap,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { estado: 'pendiente', efos: null };
    const xml = await res.text();
    const estadoRaw = (/Estado>([^<]*)</i.exec(xml)?.[1] ?? '').toLowerCase();
    const efosRaw = /ValidacionEFOS>([^<]*)</i.exec(xml)?.[1] ?? '';
    const estado: EstadoSat = estadoRaw.includes('vigente')
      ? 'vigente'
      : estadoRaw.includes('cancelado')
      ? 'cancelado'
      : estadoRaw.includes('no encontrado')
      ? 'no_encontrado'
      : 'pendiente';
    // 200/201 = fuera de lista EFOS (limpio); cualquier otro código = EFOS.
    const efos = efosRaw ? !(efosRaw.trim() === '200' || efosRaw.trim() === '201') : null;
    return { estado, efos };
  } catch (e) {
    logger.warn('sat.consulta', { err: e instanceof Error ? e.message : String(e) });
    return { estado: 'pendiente', efos: null }; // SAT caído/timeout → continuar
  }
}
