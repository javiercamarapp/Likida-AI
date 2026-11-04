// MX-004: de qué tenant sale el presupuesto de IA cuando lo gasta el superadmin global.
//
// El ledger de gasto de modelo es por flota (`createLlmBudget(tenantId, ...)` falla cerrado sin tenant). El superadmin real tiene
// `app_user.tenant_id` NULL por diseño, así que el redactor del Cerebro de prospectos respondía 503 siempre. La regla:
//   1. si la sesión trae una flota elegida, paga esa (comportamiento previo);
//   2. si no, paga el TENANT INTERNO de Likida (`tenant.interno = true`, migración 0970), que Javier marca a mano y que tiene su
//      propio techo de IA;
//   3. si no hay tenant interno (o la migración no está aplicada), NO hay presupuesto: falla cerrado con el motivo exacto, que la
//      pantalla muestra. Nunca un presupuesto global implícito ni una flota de cliente elegida por código.
import { leerTenantsInternos } from '@/lib/likida/repo';

export type TenantPresupuestoSuperadmin =
  | { ok: true; tenantId: string; origen: 'sesion' | 'interno' }
  | { ok: false; motivo: 'sin_tenant_interno' | 'migracion_pendiente' | 'varios_internos' | 'error_lectura'; mensaje: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function tenantDePresupuestoSuperadmin(tenantSesion: string | null | undefined): Promise<TenantPresupuestoSuperadmin> {
  const propio = typeof tenantSesion === 'string' ? tenantSesion.trim() : '';
  if (propio) return { ok: true, tenantId: propio, origen: 'sesion' };

  const { data, error } = await leerTenantsInternos();
  if (error) {
    // 42703 = la columna no existe: la migración 0970 aún no se aplica en esta base.
    if (error.code === '42703' || /column .*interno/i.test(error.message ?? '')) {
      return {
        ok: false,
        motivo: 'migracion_pendiente',
        mensaje: 'El redactor aún no tiene de dónde cobrar el gasto de IA: falta aplicar la migración 0970 (tenant interno de Likida).',
      };
    }
    return { ok: false, motivo: 'error_lectura', mensaje: 'No se pudo leer de qué tenant sale el presupuesto del redactor. Intenta de nuevo.' };
  }
  const filas = (data ?? []) as Array<{ id: unknown }>;
  if (filas.length === 0) {
    return {
      ok: false,
      motivo: 'sin_tenant_interno',
      mensaje: 'El redactor no tiene tenant de presupuesto: elige una flota arriba o marca el tenant interno de Likida (tenant.interno = true) para que el gasto de IA del equipo tenga dueño y techo propios.',
    };
  }
  if (filas.length > 1) {
    return { ok: false, motivo: 'varios_internos', mensaje: 'Hay más de un tenant marcado como interno: debe haber uno solo.' };
  }
  const id = String(filas[0].id ?? '');
  if (!UUID.test(id)) return { ok: false, motivo: 'error_lectura', mensaje: 'El tenant interno tiene un id inválido.' };
  return { ok: true, tenantId: id, origen: 'interno' };
}
