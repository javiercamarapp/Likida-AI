// ═══════════════════════════════════════════════════════════════════════════
// GET /v1/viajes/{id}/contribucion — cuánto dejó el viaje, y qué falta para
// poder decirlo.
//
// Es el renglón del libro mayor: ingreso del flete menos lo comprobado, su
// margen, el respaldo documental, las observaciones fiscales del motor y el
// estado de cobro. Sale entero de `getLibroViaje`, que es donde vive el
// criterio; aquí solo se le pone la puerta enfrente y se traduce a JSON.
//
// ── `null` NO ES CERO, Y ES LA MITAD DEL VALOR DE ESTA RUTA ──────────────
//
// Un TMS que consuma esto va a graficar `contribucion`. Si un viaje sin ingreso
// capturado devolviera 0, la gráfica diría que ese viaje salió a mano — una
// medición — cuando lo que pasa es que nadie tecleó lo que se le cobró al
// cliente. Los dos casos se ven idénticos aplastados a 0 y significan cosas
// opuestas.
//
// Por eso `contribucion`, `margenPct`, `ingreso`, `comprobado` y todo lo de
// `cobro` pueden venir `null`, y por eso viaja `falta`: la regla del producto no
// es callarse cuando no hay dato, es DECIR QUÉ FALTA. `falta` trae la frase
// exacta (y distingue "falta el ingreso" de "falta cerrar la liquidación", que
// se resuelven con dos personas distintas).
//
// El OpenAPI declara cada uno de esos campos como `["number","null"]` y explica
// esto mismo, para que un generador de clientes produzca un tipo anulable y el
// integrador no pueda escribir `?? 0` sin darse cuenta de lo que está haciendo.
//
// ── ÁREA `dinero` ────────────────────────────────────────────────────────
//
// Es la única de las rutas de viaje que la lleva. `/v1/viajes` y
// `/v1/viajes/{id}` son `operacion` y no devuelven un peso, justamente para que
// el jefe de tráfico pueda consumirlas sin que esta se le abra de paso.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import {
  getLibroViaje,
  type Cobro,
  type Documental,
  type ObservacionFiscal,
} from '@/lib/likida/libro_viaje';
import { abrir, errorApi, fallo } from '../../../_comun';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface ContribucionApi {
  viajeId: string;
  folio: string;
  estatus: string;
  cliente: string | null;
  /** `viaje.ingreso_flete`. `null` = NO SE CAPTURÓ, no "cobró cero". */
  ingreso: number | null;
  /** `liquidacion.total_comprobado`. `null` = el viaje no tiene liquidación.
   *  Un 0 aquí sí es un 0 medido: se cuadró y no se comprobó nada. */
  comprobado: number | null;
  /** ingreso − comprobado. `null` si falta cualquiera de las dos mitades. */
  contribucion: number | null;
  /** Contribución como % del ingreso. `null` también con ingreso 0 — eso es
   *  una división entre cero, no un margen de 0%. */
  margenPct: number | null;
  /** Qué falta para que los dos de arriba existan. `null` = no falta nada. */
  falta: string | null;
  liquidacionId: string | null;
  documental: Documental;
  /** `null` = no hay liquidación. `[]` = la hay y salió limpia. No es lo mismo,
   *  y por eso el campo es anulable en vez de "arreglo vacío para todo". */
  observaciones: ObservacionFiscal[] | null;
  cobro: Cobro;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const acceso = await abrir(req, 'dinero');
  if (!acceso.ok) return acceso.respuesta;

  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return errorApi('parametro_invalido', 'El id del viaje tiene que ser un uuid.');
  }

  try {
    // El tenant sale de la credencial, el id de la URL, y `getLibroViaje`
    // filtra por los dos. Un uuid de otra flota devuelve `null` → 404, igual
    // que uno inventado: quien pregunta no puede distinguir "no existe" de
    // "existe y no es tuyo".
    const renglon = await getLibroViaje(acceso.tenantId, id);
    if (!renglon) return errorApi('no_encontrado', 'No hay un viaje con ese id en tu flota.');

    const datos: ContribucionApi = {
      viajeId: renglon.viajeId,
      folio: renglon.folio,
      estatus: renglon.estatus,
      cliente: renglon.cliente,
      ingreso: renglon.ingreso,
      comprobado: renglon.comprobado,
      contribucion: renglon.contribucion,
      margenPct: renglon.margenPct,
      falta: renglon.falta,
      liquidacionId: renglon.liquidacionId,
      documental: renglon.documental,
      observaciones: renglon.observaciones,
      cobro: renglon.cobro,
    };
    return NextResponse.json({ datos });
  } catch (e) {
    return fallo('v1.viaje_contribucion', e, { tenant: acceso.tenantId, viaje: id });
  }
}
