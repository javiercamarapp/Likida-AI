import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { descifrar, cofreConfigurado } from '../conectores/cofre';
import { comercioDeConector, conectorDePortal } from '../conectores/portales_facturacion';
import type { ValoresCredencial } from '../conectores/tipos';

// ═══════════════════════════════════════════════════════════════════════════
// LAS CUENTAS DE PORTAL QUE LA FLOTA COMPARTIÓ — leídas para enrutar.
//
// `enrutar()` decide "requiere_cuenta → persona" porque la sesión la tiene el
// encargado. Este módulo responde la pregunta que cambia esa decisión: ¿la
// flota YA compartió esa cuenta en el cofre? Si sí, la sesión también la tiene
// la máquina, y el ticket puede ir por el camino automático — cuando además
// exista quién opere ese portal (`sabeOperarlo`), que es problema de otro.
//
// ── FALLA CERRADO HACIA EL ENCARGADO ─────────────────────────────────────
//
// Si la base no contesta, o el cofre no está configurado, la respuesta es "no
// hay cuentas compartidas": el ticket va con la persona, que es el camino que
// funcionaba antes de que esto existiera. El error caro sería el contrario —
// afirmar una cuenta que no se puede descifrar y dejar el ticket esperando a
// un robot que no va a poder entrar.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Las claves de comercio cuyo portal tiene una cuenta compartida ACTIVA.
 *
 * Activa ≠ probada: `probada_en` puede ser null (guardada, sin probar). Aquí
 * cuenta igual — la prueba real de una cuenta de portal ES el intento del
 * agente, y excluirla la dejaría sin estrenar para siempre. Si al entrar no
 * sirve, el resultado del intento lo dice y el ticket sale por `bloqueado`.
 */
export async function cuentasCompartidas(tenantId: string): Promise<Set<string>> {
  if (!cofreConfigurado()) return new Set();

  const { data, error } = await supabaseAdmin()
    .from('conector_credencial')
    .select('conector_id')
    .eq('tenant_id', tenantId)
    .eq('activo', true)
    .like('conector_id', 'portal_facturacion:%');

  if (error) {
    // Se dice y se devuelve vacío: el ticket va con la persona, no se pierde.
    logger.warn('facturacion.cuentas_sin_leer', { tenant: tenantId, err: error.message });
    return new Set();
  }

  const claves = new Set<string>();
  for (const f of data ?? []) {
    const clave = comercioDeConector(String((f as { conector_id: unknown }).conector_id));
    if (clave) claves.add(clave);
  }
  return claves;
}

/**
 * TODAS las credenciales de portal de la flota, descifradas: clave de comercio
 * → valores. Es lo que el cron le pasa al registro de adaptadores para que el
 * piloto de visión pueda entrar a los portales con cuenta.
 *
 * Una fila que no descifra SE SALTA con grito en el log — el resto de las
 * cuentas no puede pagar por una corrupta — y el secreto jamás viaja en el
 * error.
 */
export async function credencialesDePortales(tenantId: string): Promise<Map<string, ValoresCredencial>> {
  const vacio = new Map<string, ValoresCredencial>();
  if (!cofreConfigurado()) return vacio;

  const { data, error } = await supabaseAdmin()
    .from('conector_credencial')
    .select('conector_id, valores_cifrados')
    .eq('tenant_id', tenantId)
    .eq('activo', true)
    .like('conector_id', 'portal_facturacion:%');

  if (error) {
    logger.warn('facturacion.credenciales_sin_leer', { tenant: tenantId, err: error.message });
    return vacio;
  }

  for (const f of data ?? []) {
    const fila = f as { conector_id: unknown; valores_cifrados: unknown };
    const clave = comercioDeConector(String(fila.conector_id));
    if (!clave || !fila.valores_cifrados) continue;
    try {
      vacio.set(clave, descifrar(String(fila.valores_cifrados)));
    } catch (e) {
      logger.error('facturacion.credencial_no_descifra', {
        tenant: tenantId, comercio: clave, err: e instanceof Error ? e.message : 'error',
      });
    }
  }
  return vacio;
}

/**
 * La credencial del portal de UN comercio, descifrada, para el robot que va a
 * entrar. `null` = no hay cuenta compartida activa (o no se pudo leer), y el
 * llamador manda el ticket con la persona.
 *
 * El secreto NO SE LOGUEA ni viaja en errores: si el descifrado falla se dice
 * el hecho, nunca el contenido.
 */
export async function credencialDePortal(
  tenantId: string,
  claveComercio: string,
): Promise<ValoresCredencial | null> {
  if (!cofreConfigurado()) return null;

  const { data, error } = await supabaseAdmin()
    .from('conector_credencial')
    .select('valores_cifrados')
    .eq('tenant_id', tenantId)
    .eq('conector_id', conectorDePortal(claveComercio))
    .eq('activo', true)
    .maybeSingle();

  if (error) {
    logger.warn('facturacion.credencial_sin_leer', { tenant: tenantId, comercio: claveComercio, err: error.message });
    return null;
  }
  if (!data?.valores_cifrados) return null;

  try {
    return descifrar(String(data.valores_cifrados));
  } catch (e) {
    // Cofre rotado o fila corrupta. El arreglo es recapturar la credencial, y
    // eso se dice sin imprimir un byte del cifrado.
    logger.error('facturacion.credencial_no_descifra', {
      tenant: tenantId, comercio: claveComercio, err: e instanceof Error ? e.message : 'error',
    });
    return null;
  }
}
