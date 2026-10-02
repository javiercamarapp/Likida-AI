// ═══════════════════════════════════════════════════════════════════════════
// GET /v1/liquidaciones-externas/exportacion — el archivo para el SAP/TMS del
// cliente, con el layout que ÉL pida (ver `liquidacion_externa/exportacion.ts`:
// columnas, granularidad liquidación/concepto, separador, decimal, fechas, BOM).
//
// Filtros (los del listado): `estado`, `respuestaChofer`, `operadorId`,
// `claveExterna`, `desde`, `hasta` (días de México sobre la fecha de carga) y
// `sinConfirmar=1` (solo acuses que su sistema aún no confirmó; combínalo con
// `POST …/acuses/confirmar` para un ciclo completo por archivo).
//
// COMPLETO O NADA: si el filtro trae más de `TOPE` liquidaciones no se devuelve un
// archivo corto con cara de completo — se responde `lectura_incompleta` y se pide
// acotar el rango. Área `dinero`.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { abrir, errorApi, fallo } from '../../_comun';
import { listarParaExportacion, ESTADOS, type EstadoLiquidacionExterna, type FiltroListado } from '@/lib/likida/liquidacion_externa/repo';
import { leerOpcionesExportacion, generarExportacion } from '@/lib/likida/liquidacion_externa/exportacion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Tope duro por archivo (el listado pide uno más para saber si se pasó). */
export const TOPE_EXPORTACION = 900;

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function diaValido(v: string): boolean {
  if (!DIA.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  // `toISOString` LANZA con una fecha inválida (2026-13-45): se comprueba antes.
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export async function GET(req: Request) {
  const acceso = await abrir(req, 'dinero');
  if (!acceso.ok) return acceso.respuesta;

  const q = new URL(req.url).searchParams;
  const lectura = leerOpcionesExportacion(q);
  if (!lectura.ok) return errorApi('parametro_invalido', lectura.mensaje);

  const filtro: FiltroListado & { sinConfirmar?: boolean } = {};
  const estado = q.get('estado');
  if (estado) {
    if (!(ESTADOS as readonly string[]).includes(estado)) return errorApi('parametro_invalido', `\`estado\` tiene que ser uno de: ${ESTADOS.join(', ')}.`);
    filtro.estado = estado as EstadoLiquidacionExterna;
  }
  const respuesta = q.get('respuestaChofer');
  if (respuesta) {
    if (respuesta !== 'recibida' && respuesta !== 'no_coincide') return errorApi('parametro_invalido', '`respuestaChofer` tiene que ser `recibida` o `no_coincide`.');
    filtro.acuseTipo = respuesta;
  }
  const operadorId = q.get('operadorId');
  if (operadorId) {
    if (!UUID.test(operadorId)) return errorApi('parametro_invalido', '`operadorId` tiene que ser un uuid.');
    filtro.operadorId = operadorId.toLowerCase();
  }
  const clave = q.get('claveExterna');
  if (clave) {
    if (clave.length > 120) return errorApi('parametro_invalido', '`claveExterna` no puede pasar de 120 caracteres.');
    filtro.claveExterna = clave;
  }
  for (const campo of ['desde', 'hasta'] as const) {
    const valor = q.get(campo);
    if (valor) {
      if (!diaValido(valor)) return errorApi('parametro_invalido', `\`${campo}\` tiene que ser un día \`AAAA-MM-DD\`.`);
      filtro[campo] = valor;
    }
  }
  if (filtro.desde && filtro.hasta && filtro.hasta < filtro.desde) return errorApi('parametro_invalido', '`hasta` no puede ser anterior a `desde`.');
  const sin = q.get('sinConfirmar');
  if (sin !== null && sin !== '0' && sin !== '1') return errorApi('parametro_invalido', '`sinConfirmar` solo acepta 1 o 0.');
  if (sin === '1') filtro.sinConfirmar = true;

  try {
    const { filas, truncado } = await listarParaExportacion(acceso.tenantId, filtro, TOPE_EXPORTACION);
    if (truncado) {
      return errorApi('lectura_incompleta', `El filtro trae más de ${TOPE_EXPORTACION} liquidaciones: no se entrega un archivo parcial. Acota con \`desde\`/\`hasta\` (o \`sinConfirmar=1\`).`);
    }
    return new NextResponse(generarExportacion(filas, lectura.opciones), {
      headers: {
        'Content-Type': `${lectura.opciones.separador === 'tab' ? 'text/tab-separated-values' : 'text/csv'}; charset=utf-8`,
        'Content-Disposition': `attachment; filename="liquidaciones_externas.${lectura.opciones.separador === 'tab' ? 'tsv' : 'csv'}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Likida-Filas': String(filas.length),
      },
    });
  } catch (e) {
    return fallo('v1.liquidaciones_externas.exportacion', e, { tenant: acceso.tenantId });
  }
}
