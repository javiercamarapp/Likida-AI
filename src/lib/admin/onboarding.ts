// ═══════════════════════════════════════════════════════════════════════════
// ONBOARDING POR FLOTA — las mediciones cross-tenant que /admin/flotas pinta
// como checklist (auditoría D9: el ciclo real de arranque de una flota).
//
// Aquí SOLO viven las dos lecturas que no existían en ningún lib. Las otras
// tres casillas del checklist ya se miden en otro lado y de ahí se toman:
//   · teléfono del jefe   → `telefonosJefe` (lib/likida/contactos.ts)
//   · política propia     → `flotas[].politicaPropia` (getResumenNegocio)
//   · primer viaje        → `flotas[].viajes` (getResumenNegocio)
//
// Vive en lib/admin porque cruza tenants (el permiso exclusivo de este
// barrio, ver negocio.ts). Errores: LANZA — la página atrapa por lectura y
// pinta "no se pudo medir", que no es lo mismo que "pendiente".
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { conteo, traerTodo } from '@/lib/likida/pg';

export interface OnboardingFlota {
  /** Credenciales de conectores ACTIVAS de la flota: cuántas hay y cuántas
   *  pasaron su prueba real (`probada_en` — guardar NO es conectar, 0094). */
  credenciales: { total: number; probadas: number };
  /** Filas en `agente_notificacion_config` (0097). 0 NO es "roto": sin fila
   *  corren los defaults del código — la casilla lo dice así. */
  avisosConfigurados: number;
  /** ¿El aviso de privacidad de la flota se puede armar completo? (auditoría
   *  19, legal C3 / C.16). Sin razón social el aviso NI EXISTE (404 y el
   *  tratamiento de datos de choferes queda frenado en el primer mensaje);
   *  sin domicilio existe pero sale con la fr. I pendiente. Se capturan en
   *  /dashboard/suscripcion. */
  avisoPrivacidad: { razonSocial: boolean; domicilio: boolean };
}

/**
 * UNA lectura por tabla para TODAS las flotas (no N consultas por flota):
 * el mapa va keyed por tenant_id, y una flota sin filas simplemente no
 * aparece — el llamador la lee como `{0, 0}` CONTADO, porque la lectura sí
 * se completó (traerTodo lanza si no).
 */
export async function getOnboardingFlotas(): Promise<Map<string, OnboardingFlota>> {
  const admin = supabaseAdmin();
  const [credenciales, avisos, tenants] = await Promise.all([
    traerTodo<{ tenant_id: string; probada_en: string | null }>(
      (d, h) => admin
        .from('conector_credencial')
        .select('tenant_id, probada_en', conteo(d))
        .eq('activo', true)
        .order('id').range(d, h),
      'getOnboardingFlotas/conector_credencial',
    ),
    // La PK es (tenant_id, agente) — se ordena por ambas para que la
    // paginación no repita ni salte filas con tenants que empaten.
    traerTodo<{ tenant_id: string; agente: string }>(
      (d, h) => admin
        .from('agente_notificacion_config')
        .select('tenant_id, agente', conteo(d))
        .order('tenant_id').order('agente').range(d, h),
      'getOnboardingFlotas/agente_notificacion_config',
    ),
    // Los dos datos que sostienen /aviso/<flota> (auditoría 19, legal C3 /
    // C.16). Se leen de `tenant` directo — es la misma verdad que consulta
    // `getDatosResponsable`, sin duplicar el criterio en otra tabla.
    traerTodo<{ id: string; razon_social: string | null; domicilio_fiscal: string | null }>(
      (d, h) => admin
        .from('tenant')
        .select('id, razon_social, domicilio_fiscal', conteo(d))
        .order('id').range(d, h),
      'getOnboardingFlotas/tenant',
    ),
  ]);

  const mapa = new Map<string, OnboardingFlota>();
  const de = (tenantId: string): OnboardingFlota => {
    let v = mapa.get(tenantId);
    if (!v) {
      v = {
        credenciales: { total: 0, probadas: 0 },
        avisosConfigurados: 0,
        avisoPrivacidad: { razonSocial: false, domicilio: false },
      };
      mapa.set(tenantId, v);
    }
    return v;
  };
  for (const c of credenciales) {
    const v = de(c.tenant_id);
    v.credenciales.total += 1;
    if (c.probada_en !== null) v.credenciales.probadas += 1;
  }
  for (const a of avisos) de(a.tenant_id).avisosConfigurados += 1;
  for (const t of tenants) {
    const v = de(t.id);
    v.avisoPrivacidad = {
      razonSocial: Boolean(t.razon_social?.trim()),
      domicilio: Boolean(t.domicilio_fiscal?.trim()),
    };
  }
  return mapa;
}
