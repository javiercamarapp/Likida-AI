// ═══════════════════════════════════════════════════════════════════════════
// LA COMPUERTA DEL ALTA SIN TELÉFONO (A1 por correo, Ola 1 · 0932): ¿esta flota entrega el desglose por correo?
//
// Aparte de `operador_sin_telefono.ts` (puro) porque lee el perfil y la configuración de la flota (base y sesión). Quien necesita la
// compuerta desde `administracion.ts` la importa con `import()` perezoso: ese archivo lo cargan también scripts de Node que no
// pueden resolver `next/navigation`.
// ═══════════════════════════════════════════════════════════════════════════

import { perfilDeTenant } from '@/lib/auth/perfil_tenant';
import { leerConfigCorreo } from './liquidacion_externa/repo_correo';

/**
 * ¿Puede esta flota dar de alta operadores sin teléfono? Solo si el canal del desglose es `correo`: el MISMO criterio que la entrega
 * (`canalDeEntregaPorOmision`): una flota con el perfil `cinco_agentes` es siempre `correo`; las demás, el canal de su configuración.
 * Falla cerrado: una lectura caída, la migración 0785 ausente o una flota sin configuración dan `false` (el teléfono sigue siendo
 * obligatorio). Un bache leyendo el perfil se lee como «sin perfil» (como en la entrega), nunca como «asume cinco_agentes».
 */
export async function permiteAltaSinTelefono(tenantId: string): Promise<boolean> {
  try {
    if ((await perfilDeTenant(tenantId, Date.now(), 'permitir')) === 'cinco_agentes') return true;
    const c = await leerConfigCorreo(tenantId);
    return c.ok && c.valor.canal === 'correo';
  } catch {
    return false;
  }
}
