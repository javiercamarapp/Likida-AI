// ═══════════════════════════════════════════════════════════════════════════
// GET /v1/liquidaciones-externas/acuses — lo que contestaron los choferes, para
// que el SAP/TMS del cliente lo registre en SU sistema (salida por PULL).
//
// Devuelve solo los acuses que su sistema AÚN NO CONFIRMÓ haber leído
// (`acuse_confirmado_en` nulo), del más viejo al más nuevo, paginados por cursor.
// Cuando los registró, los confirma con `POST …/acuses/confirmar`; lo no
// confirmado vuelve a salir en la siguiente lectura, así que una caída a la mitad
// del proceso del integrador no pierde ninguno. Si el chofer cambia su respuesta,
// el acuse nuevo vuelve a salir.
//
// Área `dinero` (el acuse lleva el total de la liquidación). Es lectura.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { abrir, leerPagina, leerCursor, sobre, fallo, errorApi, codificarCursor } from '../../_comun';
import { listarAcusesPendientes } from '@/lib/likida/liquidacion_externa/repo';
import { aAcuseApi, type AcuseApi } from '@/lib/likida/liquidacion_externa/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: Request) {
  const acceso = await abrir(req, 'dinero');
  if (!acceso.ok) return acceso.respuesta;

  const pag = leerPagina(req.url);
  if (!pag.ok) return pag.respuesta;
  const cur = leerCursor(req.url, pag.pagina);
  if (!cur.ok) return cur.respuesta;
  if (pag.pagina.desplazamiento > 0) {
    return errorApi('parametro_invalido', 'Esta ruta pagina solo por cursor: usa `despues` con el `pagina.siguiente` de la respuesta anterior, no `desplazamiento`.');
  }

  try {
    // El cursor reutiliza la forma `(creadoEn, id)` del resto de /v1; aquí `creadoEn` es el instante del acuse.
    const { filas, hayMas } = await listarAcusesPendientes(
      acceso.tenantId, pag.pagina.limite, cur.despues ? { acuseEn: cur.despues.creadoEn, id: cur.despues.id } : null,
    );
    const datos = filas.map(aAcuseApi).filter((a): a is AcuseApi => a !== null);
    const ultima = filas.at(-1);
    return NextResponse.json(sobre(datos, pag.pagina, null, {
      hayMas,
      siguiente: hayMas && ultima?.acuseEn ? codificarCursor({ creadoEn: ultima.acuseEn, id: ultima.id }) : null,
    }));
  } catch (e) {
    return fallo('v1.liquidaciones_externas.acuses', e, { tenant: acceso.tenantId });
  }
}
