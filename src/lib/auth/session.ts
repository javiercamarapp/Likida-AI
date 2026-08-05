import { supabaseServer } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

/**
 * EL ROL DE UNA SESIÓN CUYA FILA DE `app_user` NO SE PUDO LEER.
 *
 * Aquí vivía `?? 'flota_admin'`: sin fila legible —RLS, un bache de red, o una
 * cuenta de `auth.users` que nadie dio de alta— la sesión nacía con el rol del
 * DUEÑO de la flota. El 4-ago-2026 eso dejó de ser teórico: la base de
 * producción se limpió y queda una sola cuenta, así que cualquier correo con
 * sesión de Supabase y sin fila entraba como flota_admin.
 *
 * NO ES UN ROL, ES LA MARCA DE QUE NO HAY ROL. No existe en el dominio de
 * `app_user.rol` (0044: superadmin, flota_admin, contador, operador,
 * encargado), no se escribe nunca en la base —nada persiste este campo— y
 * ninguna puerta lo reconoce, así que todas lo niegan por su default:
 *
 *   · `areasDe` → [], y con eso `puedeVerRuta` → false para toda ruta;
 *   · `puedeExportar` / `puedeAsignar` / `puedeAdministrar` → false;
 *   · `inicioDe` → '/sin-acceso', que es la pantalla que le explica al usuario
 *     que su cuenta no está ligada a ninguna flota;
 *   · `rolEfectivo` lo deja intacto (solo un superadmin puede previsualizar).
 *
 * POR QUÉ UN MARCADOR Y NO `rol: string | null`, que sería la forma honesta:
 * `SessionTenant.rol` viaja desde `requireSessionTenant` hasta las 20 páginas
 * del panel y el chrome del sidebar. Medido antes de elegir: volverlo anulable
 * son 81 errores de tsc en 25 archivos bajo `app/dashboard/**`, `app/admin/**`
 * y `auth/guard.ts` —los que esta ronda tiene prohibido tocar— porque
 * `guard.ts` afirma `SessionTenant` en su tipo de retorno y no hay dónde
 * estrecharlo sin editarlo. El día que se abran esos archivos, el cambio es
 * mecánico: `SIN_ROL` → `null` y estrechar en `requireSessionTenant`, que es el
 * único punto por el que pasan todas las páginas.
 */
export const SIN_ROL = 'sin_rol';

export interface SessionTenant {
  userId: string;
  tenantId: string | null;
  /**
   * El de `app_user.rol`, o `SIN_ROL` cuando no hubo fila legible. Nunca cae a
   * un rol del dominio: quien llama decide qué hacer con la ausencia, y las
   * matrices de `visibilidad.ts`/`permisos.ts` ya la niegan por default.
   */
  rol: string;
  nombre: string | null;
  /** Solo llena cuando rol='operador' (0045) — liga con la fila de `operador`. */
  operadorId: string | null;
  /** URL pública en el bucket `avatares` (0046), o null si no ha subido foto. */
  avatarUrl: string | null;
}

/**
 * Devuelve el tenant del usuario autenticado, o null si no hay sesión/config.
 *
 * Reintenta UNA vez antes de fallar cerrado: un `fetch failed`/timeout
 * transitorio de Supabase aquí no es "no hay sesión" — es la MISMA sesión
 * válida que un momento antes pasó `/auth/callback`, pero `requireSuperadmin`
 * trata `null` exactamente igual que "nunca inició sesión" y rebota a
 * /login. Sin el reintento, un usuario recién autenticado podía entrar y
 * ser expulsado a los pocos segundos por un bache de red que no tenía nada
 * que ver con su login. Dos intentos, no un loop: si el segundo también
 * truena, el problema ya no es un bache — sigue fallando cerrado.
 */
export async function getSessionTenant(): Promise<SessionTenant | null> {
  for (let intento = 0; intento < 2; intento++) {
    try {
      const sb = await supabaseServer();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return null;
      const { data, error } = await sb.from('app_user').select('tenant_id, rol, nombre, operador_id, avatar_url').eq('id', user.id).maybeSingle();
      // Sin este log, un bache de Supabase o una regresión de RLS es
      // INDISTINGUIBLE de "este correo nunca se dio de alta": las dos acaban con
      // `tenantId: null`, y `requireSessionTenant` manda al contralor a
      // /sin-acceso con un texto que le dice que pida su alta. El
      // comportamiento no cambia a propósito (fallar cerrado es lo correcto en
      // la puerta de autorización); lo que cambia es que ahora quede rastro.
      if (error) {
        logger.warn('session.app_user_error', { userId: user.id, err: error.message });
        // Y SE REINTENTA, como la excepción de abajo. supabase-js reporta este
        // fallo POR VALOR, así que hasta hoy un `fetch failed` al leer
        // `app_user` no gastaba el reintento que sí existía para el throw: la
        // misma sesión recién autenticada acababa sin tenant y rebotada a
        // /sin-acceso por un bache de tres segundos. Una fila que NO EXISTE no
        // pasa por aquí — `maybeSingle` la devuelve como `data: null` sin
        // error—, así que esto no le cuesta un viaje de más a nadie.
        if (intento === 0) {
          await new Promise((r) => setTimeout(r, 250));
          continue;
        }
      }
      return {
        userId: user.id,
        tenantId: (data?.tenant_id as string) ?? null,
        // SIN FILA LEGIBLE NO HAY ROL. Ver `SIN_ROL`: el `?? 'flota_admin'` que
        // estaba aquí convertía una lectura fallida en el dueño de la flota.
        rol: (data?.rol as string) ?? SIN_ROL,
        nombre: (data?.nombre as string) ?? null,
        operadorId: (data?.operador_id as string) ?? null,
        avatarUrl: (data?.avatar_url as string) ?? null,
      };
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e);
      if (intento === 0) {
        logger.warn('session.reintento', { err: mensaje });
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }
      // Lo que llega aquí ya no es "no hay sesión", es que el SDK tronó DOS
      // veces seguidas: red caída, URL/anon key mal puestas, respuesta
      // ilegible. El llamador solo ve `null` y redirige a /login, así que
      // este es el único sitio donde el motivo puede quedar escrito.
      logger.error('session.excepcion', { err: mensaje });
      return null;
    }
  }
  return null; // inalcanzable — el for siempre retorna o cae al catch final
}
