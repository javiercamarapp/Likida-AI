// ═══════════════════════════════════════════════════════════════════════════
// PUT /v1/viajes/{id}/citas — la cita y la ETA de origen y destino de un viaje.
//
// Es lo que le dice al Agente 5 CUÁNDO pedir cada hito: sin cita ni ETA el agente
// usa los plazos por defecto de la flota (supuestos); con ellas pide la llegada
// `anticipoCitaMin` antes. Cuerpo (todas opcionales, al menos una; `null` borra):
//
//   { "citaOrigen": "2026-10-02T08:00:00-06:00", "citaDestino": "...",
//     "etaOrigen": "...", "etaDestino": "..." }
//
// Fecha-hora ISO CON zona horaria: «las 8:00» sin huso es un dato que nadie
// declaró. PUT es idempotente por naturaleza: repetirlo deja lo mismo.
//
// ── ÁREA `administracion` (como POST /v1/viajes) ────────────────────────────
// Mover una cita mueve cuándo se le insiste a un chofer: no es un permiso de
// tablero de lectura. "No existe" y "no es de tu flota" contestan lo MISMO (404).
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { UUID, validarCitas } from '@/lib/likida/conductor/lectura';
import { guardarCitas } from '@/lib/likida/conductor/repo';
import { abrir, errorApi, fallo } from '../../../_comun';
import { leerCuerpo } from '../../../_escritura';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const acceso = await abrir(req, 'administracion');
  if (!acceso.ok) return acceso.respuesta;

  const { id } = await params;
  if (!UUID.test(id)) return errorApi('parametro_invalido', 'El id del viaje tiene que ser un uuid.');

  const cuerpo = await leerCuerpo(req);
  if (!cuerpo.ok) return cuerpo.respuesta;
  const v = validarCitas(cuerpo.cuerpo);
  if ('error' in v) return errorApi('parametro_invalido', v.error);

  try {
    const r = await guardarCitas(acceso.tenantId, id.toLowerCase(), v.ok);
    if (r === 'no_encontrado') return errorApi('no_encontrado', 'No hay un viaje con ese id en tu flota.');
    return NextResponse.json({ datos: { viajeId: id.toLowerCase(), ...v.ok } });
  } catch (e) {
    return fallo('v1.viaje_citas', e, { tenant: acceso.tenantId, viaje: id });
  }
}
