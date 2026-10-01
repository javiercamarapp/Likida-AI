// ═══════════════════════════════════════════════════════════════════════════
// GET /v1/estadias — las estadías en ANDÉN (llegada→salida de cada carga y descarga), con la hora EXACTA
// del mensaje, de dónde salió, si la ubicación la validó y cuántas fotos la respaldan; y, donde la flota
// pactó horas libres y tarifa, el renglón PROPUESTO de cobro. Para el cobro de estadías al cliente.
//
//   ?desde=AAAA-MM-DD&hasta=AAAA-MM-DD   días de MÉXICO, ambos inclusive (por defecto, los últimos 7; máx. 93)
//   ?formato=json|csv                    csv = UTF-8 con BOM, listo para Excel
//   ?terminalId= ?clienteId= ?operadorId= filtros opcionales (uuid)
//
// ── ÁREA `dinero` ──────────────────────────────────────────────────────────
// Trae el monto propuesto: es dinero, y el jefe de tráfico (que ve operación y nada de pesos) no lo lee. Siempre
// acotado a la flota de la credencial.
//
// ── LO QUE NO ES ───────────────────────────────────────────────────────────
// El monto es una PROPUESTA: sin horas libres pactadas no hay «excedido»; sin tarifa no hay monto; una parada
// que sigue corriendo (`en_curso`) no es cobrable y su monto va vacío. El agente prepara; el contralor factura.
// La hora es la del MENSAJE del chofer (o la declarada por la oficina), no telemetría del evento físico.
// Si hay más viajes en el periodo de los que una lectura trae, `truncada: true` (y el encabezado
// `X-Estadias-Truncada`): jamás una cifra parcial sin decirlo.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { hoyMx } from '@/lib/formato';
import { csvEstadias } from '@/lib/likida/conductor/estadias_anden';
import { rangoDeDias } from '@/lib/likida/conductor/estadias_lectura';
import { estadiasDelPeriodo } from '@/lib/likida/conductor/servicios';
import { abrir, errorApi, fallo } from '../_comun';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  const acceso = await abrir(req, 'dinero');
  if (!acceso.ok) return acceso.respuesta;

  const p = new URL(req.url).searchParams;
  const hasta = p.get('hasta') ?? hoyMx();
  const desde = p.get('desde') ?? new Date(new Date(`${hasta}T12:00:00-06:00`).getTime() - 6 * 86_400_000).toISOString().slice(0, 10);
  const rango = rangoDeDias(desde, hasta);
  if ('error' in rango) return errorApi('parametro_invalido', rango.error);

  const formato = p.get('formato') ?? 'json';
  if (formato !== 'json' && formato !== 'csv') return errorApi('parametro_invalido', '`formato` es json o csv.');
  const filtros: { terminalId?: string; clienteId?: string; operadorId?: string } = {};
  for (const [param, llave] of [['terminalId', 'terminalId'], ['clienteId', 'clienteId'], ['operadorId', 'operadorId']] as const) {
    const v = p.get(param);
    if (v === null || v === '') continue;
    if (!UUID.test(v)) return errorApi('parametro_invalido', `\`${param}\` tiene que ser un uuid.`);
    filtros[llave] = v.toLowerCase();
  }

  try {
    const r = await estadiasDelPeriodo(acceso.tenantId, rango.desde, rango.hasta, filtros);
    if (formato === 'csv') {
      return new Response(csvEstadias(r.filas), {
        status: 200,
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="estadias-${desde}-a-${hasta}.csv"`,
          'cache-control': 'no-store',
          ...(r.truncada ? { 'x-estadias-truncada': 'true' } : {}),
        },
      });
    }
    return NextResponse.json({
      datos: r.filas.map((f) => ({
        viajeId: f.viaje.id, folio: f.viaje.folio, chofer: f.viaje.operadorNombre, cliente: f.viaje.clienteNombre, patio: f.viaje.terminalNombre,
        parada: f.estancia.lugar, sitio: f.sitio, estado: f.estancia.fase, minutos: f.estancia.minutos,
        llegada: f.estancia.llegada, salida: f.estancia.salida,
        pacto: f.origenPolitica,
        detencion: f.estancia.fase === 'cerrada' ? f.detencion : { ...f.detencion, monto: null, moneda: null, horasCobrables: null },
      })),
      resumen: r.resumen,
      periodo: { desde, hasta },
      truncada: r.truncada,
    });
  } catch (e) {
    return fallo('v1.estadias', e, { tenant: acceso.tenantId });
  }
}
