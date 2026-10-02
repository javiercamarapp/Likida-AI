// ═══════════════════════════════════════════════════════════════════════════
// POST /v1/hitos/{id}/validar — el sistema del cliente (TMS/SAP) marca un hito como VALIDADO: «sí, confirmo que
// esta llegada o salida ocurrió». Es la misma acción que el jefe de tráfico hace con su botón en el tablero
// (`validarHitoOficina`), con las mismas reglas:
//
//   · MOTIVO OBLIGATORIO (5 a 200 caracteres): queda en la bitácora `conductor_accion_oficina` junto con quién y cuándo,
//     escrita en la MISMA transacción que el cambio. Aquí «quién» es la llave de API (`llave a1b2c3d4`).
//   · solo se valida un hito ya REPORTADO (`recibido`): no se valida lo que el chofer nunca dijo ni lo ya validado; si el
//     hito cambió entre la lectura y la acción (el chofer lo corrigió, alguien más lo validó) la respuesta es 409.
//   · el validado conserva la hora del mensaje del chofer: validar no la mueve.
//
// ── ÁREA `administracion` ────────────────────────────────────────────────────
// Cambia el estado de un registro que alimenta estadías y cobro. Y SOLO con llave de API: una acción de oficina por
// sesión de panel se hace desde el tablero (ahí queda firmada con la persona); aquí no hay forma de saber quién es.
//
// «No existe» y «no es de tu flota» contestan lo MISMO (404): el id del hito se resuelve DENTRO de la flota de la llave.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { UUID } from '@/lib/likida/conductor/lectura';
import { MOTIVO_MAX, MOTIVO_MIN } from '@/lib/likida/conductor/acciones_oficina';
import { hitoDeFlota, validarHitoOficina } from '@/lib/likida/conductor/repo_validacion';
import { abrir, errorApi, fallo } from '../../../_comun';
import { leerCuerpo } from '../../../_escritura';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const acceso = await abrir(req, 'administracion');
  if (!acceso.ok) return acceso.respuesta;
  if (!acceso.llaveId) {
    return errorApi('sin_permiso', 'Esta acción solo se hace con una llave de API. Desde el panel, valida el hito en el tablero del Agente Conductor (queda firmada con tu nombre).');
  }

  const { id } = await params;
  if (!UUID.test(id)) return errorApi('parametro_invalido', 'El id del hito tiene que ser un uuid.');

  const cuerpo = await leerCuerpo(req);
  if (!cuerpo.ok) return cuerpo.respuesta;
  const o = cuerpo.cuerpo;
  const desconocidas = Object.keys(o).filter((k) => k !== 'motivo');
  if (desconocidas.length > 0) return errorApi('parametro_invalido', `Llaves desconocidas: ${desconocidas.slice(0, 5).join(', ')}. La única válida es: motivo.`);
  const motivo = typeof o.motivo === 'string' ? o.motivo.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
  if (motivo.length < MOTIVO_MIN || motivo.length > MOTIVO_MAX) {
    return errorApi('parametro_invalido', `\`motivo\` es obligatorio y va de ${MOTIVO_MIN} a ${MOTIVO_MAX} caracteres: queda en la bitácora junto con la llave y la hora.`);
  }

  try {
    // El hito se resuelve DENTRO de la flota de la llave antes de cualquier otra cosa.
    const hito = await hitoDeFlota(acceso.tenantId, id.toLowerCase());
    if (!hito) return errorApi('no_encontrado', 'No hay un hito con ese id en tu flota.');
    // Un reintento del TMS (timeout, doble clic) no es un error: ya estaba validado → 200 sin tocar nada.
    if (hito.estado === 'validado') {
      return NextResponse.json({ datos: { id: hito.id, viajeId: hito.viajeId, tipo: hito.tipo, estado: 'validado', idempotente: true } });
    }
    if (hito.estado !== 'recibido') {
      return errorApi('conflicto', `Ese hito está en estado «${hito.estado}»: solo se valida lo que el chofer ya reportó (recibido).`);
    }
    const r = await validarHitoOficina(acceso.tenantId, hito.id, { usuarioId: null, email: `llave-api:${acceso.llaveId.slice(0, 8)}` }, motivo, new Date());
    if (r === 'hito_cambio') return errorApi('conflicto', 'Ese hito ya cambió (el chofer lo corrigió, o ya estaba validado, o aún no lo reporta nadie): vuelve a leerlo.');
    if (r !== 'ok') return errorApi('dependencia_no_disponible', 'No se pudo guardar ahorita. Intenta de nuevo en un momento.');
    return NextResponse.json({ datos: { id: hito.id, viajeId: hito.viajeId, tipo: hito.tipo, estado: 'validado', validadoPor: 'oficina' } });
  } catch (e) {
    return fallo('v1.hito_validar', e, { tenant: acceso.tenantId, hito: id });
  }
}
