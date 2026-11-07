// ═══════════════════════════════════════════════════════════════════════════
// GET/PUT /v1/conductor/config — la estrategia del Agente 5 «Conductor» de la flota
// y a quién se escala (patio responsable → jefe general).
//
// PUT manda SOLO lo que cambia (se fusiona con la config actual y se valida entera:
// una llave desconocida o un valor fuera de rango es 400 en palabras, nunca se guarda
// a medias). `contactos`, si viene, REEMPLAZA la lista de la flota.
//
// ── ÁREA `administracion` TAMBIÉN PARA LEER ─────────────────────────────────
// La respuesta trae teléfonos de personas (patio y jefe general): no es un dato de
// tablero. Y escribir mueve CUÁNDO se le insiste a cada chofer y a quién se despierta.
//
// Siempre acotado a la flota de la credencial: un `tenant_id` en el cuerpo es una
// llave desconocida (400), no una puerta a otra flota.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { cargarContactosTrafico, guardarConfigConductor, leerConfigConductor } from '@/lib/likida/conductor/repo';
import { validarCambioConfig } from '@/lib/likida/conductor/lectura';
import { llavesCambiadas, mismosContactos } from '@/lib/likida/conductor/config_forma';
import { preflightReal } from '@/lib/likida/conductor/acciones_config';
import { mensajeBloqueoSenalVida } from '@/lib/likida/conductor/preflight_piloto';
import { anotarBitacora, type ActorBitacora } from '@/lib/likida/bitacora_escritura';
import { getSessionTenant } from '@/lib/auth/session';
import { abrir, errorApi, fallo } from '../../_comun';
import { leerCuerpo } from '../../_escritura';

/** Quien firma el cambio: la llave (`llave-api:` + 8 caracteres del id) o la persona de la sesion del panel. */
async function actorDe(acceso: { rol: string; llaveId?: string }): Promise<ActorBitacora> {
  if (acceso.llaveId) return { id: null, email: `llave-api:${acceso.llaveId.slice(0, 8)}` };
  const s = await getSessionTenant().catch(() => null);
  return { id: s?.userId ?? null, email: null };
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const acceso = await abrir(req, 'administracion');
  if (!acceso.ok) return acceso.respuesta;
  try {
    const [config, contactos] = await Promise.all([leerConfigConductor(acceso.tenantId), cargarContactosTrafico(acceso.tenantId)]);
    return NextResponse.json({ datos: { config, contactos } });
  } catch (e) {
    return fallo('v1.conductor_config.get', e, { tenant: acceso.tenantId });
  }
}

export async function PUT(req: Request) {
  const acceso = await abrir(req, 'administracion');
  if (!acceso.ok) return acceso.respuesta;

  const cuerpo = await leerCuerpo(req);
  if (!cuerpo.ok) return cuerpo.respuesta;

  try {
    const actual = await leerConfigConductor(acceso.tenantId);
    const v = validarCambioConfig(cuerpo.cuerpo, actual);
    if ('error' in v) return errorApi('parametro_invalido', v.error);
    // MX-007 / API04-01: la MISMA compuerta que el panel (`acciones_config.ts`). `avisarSenalVida` manda mensajes a personas y
    // nace apagado: pasarlo de apagado a encendido exige el preflight del piloto sin bloqueos. Por la API no hay `forzarPreflight`
    // (ese atajo es solo del soporte de Likida desde el panel).
    if (v.ok.config.avisarSenalVida && !actual.avisarSenalVida) {
      const pf = await preflightReal(acceso.tenantId, v.ok.config);
      if (!pf.lista) return errorApi('conflicto', mensajeBloqueoSenalVida(pf));
    }
    const contactosActuales = await cargarContactosTrafico(acceso.tenantId);
    const r = await guardarConfigConductor(acceso.tenantId, v.ok.config, v.ok.contactos);
    if (r === 'terminal_ajena') return errorApi('parametro_invalido', 'Algún `terminalId` de `contactos` no es una terminal de tu flota.');
    const contactos = await cargarContactosTrafico(acceso.tenantId);
    // Quién cambió qué llaves y cuántos contactos quedaron: nombres de llaves y conteos, nunca teléfonos ni nombres (la bitácora
    // sobrevive a un borrado ARCO). Best-effort: el guardado ya ocurrió.
    await anotarBitacora({
      tenantId: acceso.tenantId, actor: await actorDe(acceso), accion: 'conductor.config_guardada', entidad: 'conductor_config', entidadId: acceso.tenantId,
      detalle: {
        llaves: llavesCambiadas(actual, v.ok.config), contactos: contactos.length,
        contactosCambiaron: v.ok.contactos !== undefined && !mismosContactos(contactosActuales, v.ok.contactos),
        via: acceso.llaveId ? 'api_llave' : 'api_sesion',
      },
    });
    return NextResponse.json({ datos: { config: v.ok.config, contactos } });
  } catch (e) {
    return fallo('v1.conductor_config.put', e, { tenant: acceso.tenantId });
  }
}
