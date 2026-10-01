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
import { abrir, errorApi, fallo } from '../../_comun';
import { leerCuerpo } from '../../_escritura';

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
    const r = await guardarConfigConductor(acceso.tenantId, v.ok.config, v.ok.contactos);
    if (r === 'terminal_ajena') return errorApi('parametro_invalido', 'Algún `terminalId` de `contactos` no es una terminal de tu flota.');
    const contactos = await cargarContactosTrafico(acceso.tenantId);
    return NextResponse.json({ datos: { config: v.ok.config, contactos } });
  } catch (e) {
    return fallo('v1.conductor_config.put', e, { tenant: acceso.tenantId });
  }
}
