// ═══════════════════════════════════════════════════════════════════════════
// GET /v1/hitos/eventos — el feed incremental de eventos del Agente 5 (hito
// recibido, validado, omitido, escalado, corregido, pospuesto, atendido, contacto).
//
// Pensado para que el sistema del cliente lo consulte cada pocos minutos con el
// último `id` que ya procesó (`?despues=<id>`) y NO se pierda ni repita nada: el id
// es un entero que solo crece. Los eventos no llevan datos personales (ids,
// estados y fuentes); el detalle del hito está en `/v1/hitos`.
//
// Es PULL. Un webhook saliente hacia el sistema del cliente exige una política de
// destinos (SSRF), secretos y reintentos que esta ruta no inventa: ver
// docs/operacion/agente-conductor.md.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { leerEventos } from '@/lib/likida/conductor/repo';
import { abrir, errorApi, fallo, LIMITE_DEFECTO, LIMITE_MAXIMO } from '../../_comun';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const acceso = await abrir(req, 'operacion');
  if (!acceso.ok) return acceso.respuesta;

  const q = new URL(req.url).searchParams;
  const crudoDespues = q.get('despues');
  const crudoLimite = q.get('limite');
  if (crudoDespues !== null && !/^\d{1,15}$/.test(crudoDespues)) {
    return errorApi('parametro_invalido', '`despues` tiene que ser el id (entero) del último evento que ya procesaste.');
  }
  if (crudoLimite !== null && !/^\d{1,4}$/.test(crudoLimite)) {
    return errorApi('parametro_invalido', '`limite` tiene que ser un entero mayor o igual a 1.');
  }
  const limite = crudoLimite === null ? LIMITE_DEFECTO : Number(crudoLimite);
  if (limite < 1 || limite > LIMITE_MAXIMO) {
    return errorApi('parametro_invalido', `\`limite\` va de 1 a ${LIMITE_MAXIMO}.`);
  }
  const despues = crudoDespues === null ? 0 : Number(crudoDespues);

  try {
    const { filas, hayMas } = await leerEventos(acceso.tenantId, despues, limite);
    return NextResponse.json({
      datos: filas,
      pagina: { limite, devueltos: filas.length, hayMas, siguiente: filas.length > 0 ? String(filas[filas.length - 1].id) : String(despues) },
    });
  } catch (e) {
    return fallo('v1.hitos_eventos', e, { tenant: acceso.tenantId });
  }
}
