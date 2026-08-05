import { getSessionTenant } from './session';
import { tenantDemo } from './tenant-demo';
import { supabaseAdmin } from '@/lib/supabase/admin';

// ═══════════════════════════════════════════════════════════════════════════
// DE QUÉ FLOTA HABLA UNA RUTA DE API.
//
// Existe porque el mismo criterio estaba escrito en `/api/dashboard/asistente`
// y FALTABA en los dos endpoints de export, que hacían:
//
//     if (!s || !s.tenantId) return 401
//
// `app_user.tenant_id` de un superadmin es `null` POR DISEÑO (0001: "null =
// superadmin"), así que esa línea le devolvía 401 a Javier. En pantalla: se
// aprieta "Descargar PDF", se abre una pestaña en blanco que dice
// "No autorizado". Es el minuto 4 del guion del demo.
//
// El fallback a la flota demo vivía solo en `guard.ts`, que las rutas de API no
// llaman porque `guard.ts` redirige (y una API no puede redirigir a /login).
//
// ── EL `?tenant=` SE VALIDA, NO SE CREE ──────────────────────────────────
//
// Solo un superadmin puede apuntar a otra flota, y el uuid se comprueba contra
// la tabla antes de usarse. Sin eso, cualquiera con sesión podría exportar las
// liquidaciones de otra empresa cambiando un parámetro de la URL — y un archivo
// con datos de otra flota es peor que un botón muerto.
// ═══════════════════════════════════════════════════════════════════════════


export type ResultadoTenantApi =
  | { ok: true; tenantId: string; rol: string }
  | { ok: false; status: 401 | 403; motivo: string };

/**
 * Resuelve la flota de una petición de API.
 *
 * Devuelve el motivo en vez de lanzar: quien llama decide el formato de la
 * respuesta (texto plano para una descarga, JSON para el rail), y así los dos
 * comparten el criterio de autorización sin compartir el de presentación.
 */
export async function resolverTenantApi(url: string): Promise<ResultadoTenantApi> {
  const s = await getSessionTenant();
  if (!s) return { ok: false, status: 401, motivo: 'Necesitas iniciar sesión.' };

  let tenantId = s.tenantId;
  if (!tenantId) {
    // Sin tenant propio, solo el superadmin sigue: cae a la flota demo, que es
    // lo mismo que hace `requireSessionTenant` para las páginas.
    if (s.rol !== 'superadmin') {
      return { ok: false, status: 403, motivo: 'Tu cuenta no está asignada a una flota.' };
    }
    tenantId = tenantDemo();
  }

  const pedido = new URL(url).searchParams.get('tenant');
  if (pedido && s.rol === 'superadmin') {
    const { data } = await supabaseAdmin().from('tenant').select('id').eq('id', pedido).maybeSingle();
    // Un uuid que no existe se IGNORA en silencio y se sigue con el de la
    // sesión. Fallar aquí convertiría un enlace viejo en un error, y lo que se
    // exporta con el tenant de la sesión es correcto, solo que no era el
    // pedido — el rótulo de la pantalla ya dice de qué flota se trata.
    if (data) tenantId = data.id as string;
  }

  return { ok: true, tenantId, rol: s.rol };
}
