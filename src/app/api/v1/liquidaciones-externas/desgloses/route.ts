// ═══════════════════════════════════════════════════════════════════════════
// POST /v1/liquidaciones-externas/desgloses — plan B de la entrada del desglose por bitácora (T-A1-21).
//
// Si el conector del sistema de transporte no está listo, el integrador (o el export de unas ~20 bitácoras) manda el
// desglose en JSON con el mismo contrato interno que usa el conector (`DesgloseBitacora`, desglose_contrato.ts).
//
// Cuerpo: `{ "desgloses": [ … ] }` (1 a 100) o UN desglose suelto (un objeto). Estricto: un campo desconocido en el
// sobre o en un desglose es 400, y TODO se valida antes de escribir nada (si un elemento está mal, no se guarda ninguno).
//
// Cada desglose pasa por `recibirDesglose` (el mismo servicio del conector):
//   · misma clave + mismo contenido → idempotente (no inserta ni reenvía nada);
//   · misma clave + otro contenido  → NO sobrescribe: excepción `correccion_pendiente`;
//   · una guarda que retiene        → queda pendiente, sin entregas, con su excepción;
//   · operador que no existe        → excepción `operador_no_encontrado`.
//
// ESTA RUTA NO ENTREGA: solo recibe y programa. Los correos los manda `procesarEntregasCorreo` (cron).
//
// Respuesta `{ datos: { recibidas, idempotentes, retenidas, excepciones: [{ clave, motivo }] } }`.
//   · 201 si se guardó al menos una liquidación; 200 si todo ya existía o solo hubo excepciones.
//   · Un fallo de infraestructura a mitad (Storage, base) es 500 y es seguro REINTENTAR TODO: lo ya guardado vuelve
//     como idempotente.
//
// Área `administracion`. El tenant sale SIEMPRE de la credencial, nunca del cuerpo.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { abrir, errorApi } from '../../_comun';
import { leerCuerpo, traducirFalla, CampoInvalido } from '../../_escritura';
import { DatoInvalido } from '@/lib/likida/errores';
import { logger } from '@/lib/logger';
import { aLiquidacionExterna, validarDesgloseBitacora, type DesgloseBitacora } from '@/lib/likida/liquidacion_externa/desglose_contrato';
import { recibirDesglose } from '@/lib/likida/liquidacion_externa/desglose_recibir';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Hasta 100 desgloses, cada uno con su Excel y su subida a Storage.
export const maxDuration = 60;

const MAX_DESGLOSES = 100;
/** Tope del cuerpo: 100 desgloses de hasta 200 renglones caben de sobra. */
const MAX_CUERPO_DESGLOSES_BYTES = 2_000_000;

const SISTEMA_ORIGEN = 'desglose-bitacora-api';

export interface RespuestaDesgloses {
  recibidas: number;
  idempotentes: number;
  retenidas: number;
  excepciones: Array<{ clave: string; motivo: string }>;
}

type Preparado = { ok: true; desgloses: DesgloseBitacora[] } | { ok: false; respuesta: NextResponse };

/** Extrae y valida TODOS los desgloses del cuerpo; el primero que no cumpla el contrato corta la petición con su índice. */
function preparar(cuerpo: Record<string, unknown>): Preparado {
  let crudos: unknown[];
  if ('desgloses' in cuerpo) {
    const otros = Object.keys(cuerpo).filter((k) => k !== 'desgloses');
    if (otros.length > 0) {
      return { ok: false, respuesta: errorApi('parametro_invalido', `El cuerpo trae campos que el contrato no tiene: ${otros.map((s) => `\`${s}\``).join(', ')}.`) };
    }
    if (!Array.isArray(cuerpo.desgloses)) {
      return { ok: false, respuesta: errorApi('parametro_invalido', '`desgloses` tiene que ser una lista de desgloses.') };
    }
    crudos = cuerpo.desgloses;
  } else {
    crudos = [cuerpo];
  }
  if (crudos.length === 0) {
    return { ok: false, respuesta: errorApi('parametro_invalido', '`desgloses` no puede venir vacía.') };
  }
  if (crudos.length > MAX_DESGLOSES) {
    return { ok: false, respuesta: errorApi('parametro_invalido', `Máximo ${MAX_DESGLOSES} desgloses por petición (mandaste ${crudos.length}); manda el resto en otra petición.`) };
  }

  const validos: DesgloseBitacora[] = [];
  for (let i = 0; i < crudos.length; i++) {
    const donde = Array.isArray(cuerpo.desgloses) ? `desgloses[${i}]` : 'desglose';
    try {
      const d = validarDesgloseBitacora(crudos[i]);
      // Que también pase la conversión al contrato vigente (cuadre del neto, montos): así el 400 llega ANTES de escribir.
      aLiquidacionExterna(d, { sistemaOrigen: SISTEMA_ORIGEN });
      validos.push(d);
    } catch (e) {
      if (e instanceof CampoInvalido || e instanceof DatoInvalido) {
        return { ok: false, respuesta: errorApi('parametro_invalido', `${donde}: ${e.message}`) };
      }
      throw e;
    }
  }
  return { ok: true, desgloses: validos };
}

export async function POST(req: Request) {
  const acceso = await abrir(req, 'administracion');
  if (!acceso.ok) return acceso.respuesta;

  const cuerpo = await leerCuerpo(req, MAX_CUERPO_DESGLOSES_BYTES);
  if (!cuerpo.ok) return cuerpo.respuesta;

  let preparado: Preparado;
  try {
    preparado = preparar(cuerpo.cuerpo);
  } catch (e) {
    return traducirFalla('v1.liquidaciones_externas.desgloses.post', acceso.tenantId, e);
  }
  if (!preparado.ok) return preparado.respuesta;

  const salida: RespuestaDesgloses = { recibidas: 0, idempotentes: 0, retenidas: 0, excepciones: [] };
  try {
    for (const d of preparado.desgloses) {
      const r = await recibirDesglose(acceso.tenantId, d, undefined, { sistemaOrigen: SISTEMA_ORIGEN });
      switch (r.estado) {
        case 'creada':
          if (r.retenida) salida.retenidas += 1;
          else salida.recibidas += 1;
          for (const motivo of r.excepciones) salida.excepciones.push({ clave: r.claveExterna, motivo });
          break;
        case 'idempotente':
          salida.idempotentes += 1;
          break;
        case 'correccion_pendiente':
          salida.excepciones.push({ clave: r.claveExterna, motivo: 'correccion_pendiente' });
          break;
        case 'operador_no_encontrado':
          salida.excepciones.push({ clave: r.claveExterna, motivo: 'operador_no_encontrado' });
          break;
      }
    }
  } catch (e) {
    logger.warn('v1.liquidaciones_externas.desgloses.parcial', { tenant: acceso.tenantId, procesados: salida.recibidas + salida.retenidas + salida.idempotentes });
    return traducirFalla('v1.liquidaciones_externas.desgloses.post', acceso.tenantId, e);
  }

  const status = salida.recibidas + salida.retenidas > 0 ? 201 : 200;
  return NextResponse.json({ datos: salida }, { status });
}
