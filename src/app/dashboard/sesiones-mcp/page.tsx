import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { PlugZap } from 'lucide-react';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeAdministrar } from '@/lib/auth/permisos';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { listarSesionesMcp, revocarSesionesMcp, type SesionMcpUsuario } from '@/lib/mcp/sesiones';
import { EstadoError } from '@/app/admin/ui/kit';
import { BarraPagina } from '../resumen-visual';
import type { ResultadoForma } from './forma';
import { ListaSesionesMcp } from './vista';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/sesiones-mcp';

/**
 * SESIONES MCP DE LA FLOTA — el cable que faltaba para la 0265.
 *
 * H3 (auditoría de dashboards, 29-ago-2026): la 0260 montó el servidor MCP con
 * OAuth y la 0265 dejó `revocar_mcp_oauth_usuario` escrita y con grant… con
 * CERO llamadores, y sin una sola mención de «MCP» en ninguna pantalla de
 * ningún panel. Un usuario que conectó Claude o ChatGPT a su cuenta seguía con
 * acceso de lectura a los datos de su área indefinidamente, y la única forma
 * de cortarlo era SQL a mano. El escenario del hallazgo es el de siempre: se
 * pierde una laptop, o se va el empleado.
 *
 * ── POR QUÉ ESTA PANTALLA Y NO UNA SOLA ───────────────────────────────────
 * El acceso MCP es de UNA persona (el token nace atado a un `user_id` y a un
 * `rol`, 0260), así que hacen falta dos puertas distintas y no se pueden
 * fundir en una:
 *   · las MÍAS las corta cada quien —también el contador y el encargado, que
 *     no ven `administracion`— y por eso viven en /dashboard/mi-perfil, que
 *     es `RUTAS_TODO_ROL`;
 *   · las de OTRO las corta el dueño, y eso es `administracion`.
 * `visibilidad.ts` asigna UN área por ruta a propósito ("una pantalla que
 * hubiera que gatear para unos sí y para otros no rompe esa regla justo donde
 * más caro es"): partirlas es lo que esa regla pide, no una duplicación.
 *
 * ── LAS DOS PUERTAS COINCIDEN AQUÍ, IGUAL QUE EN LLAVES-API ───────────────
 * VER es área `administracion` (`puedeVerRuta`) y CORTAR es
 * `puedeAdministrar`: hoy los dos conjuntos son {superadmin, flota_admin}.
 * Se comprueban LAS DOS dentro de la server action de todas formas — el `rol`
 * del render es el del momento en que se pintó, y una server action es un
 * endpoint alcanzable por POST directo. El `tenantId` va por CLOSURE desde la
 * sesión re-resuelta: del formulario solo viene A QUIÉN se le corta, y la RPC
 * de la 0265 filtra por ese tenant, así que el uuid de un usuario de otra
 * flota toca cero filas y contesta un error, no un "listo".
 */
export default async function PaginaSesionesMcp({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  // El catch NO finge que no hay nada conectado: una base caída pintada como
  // "nadie tiene MCP" es exactamente la mentira que haría que nadie cortara
  // nada. Se pinta el error.
  let sesiones: SesionMcpUsuario[] | null;
  try {
    sesiones = await listarSesionesMcp(tenantId);
  } catch {
    sesiones = null;
  }

  async function cortarSesiones(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA) || !puedeAdministrar(s.rol)) {
      return { ok: false, error: 'Solo el dueño de la flota corta los accesos MCP de otro usuario.' };
    }

    try {
      const tumbados = await revocarSesionesMcp(s.tenantId, String(fd.get('usuarioId') ?? '').trim(), s.userId);
      revalidatePath(RUTA);
      return {
        ok: true,
        mensaje: tumbados === 1
          ? 'Acceso cortado.'
          : `Accesos cortados (${tumbados} tokens).`,
      };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'cortar los accesos MCP') };
    }
  }

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<PlugZap width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Sesiones MCP"
        />

        <div className="px-5 py-5 flex-1 space-y-4">
          <p className="text-[12.5px] max-w-2xl" style={{ color: 'var(--muted)' }}>
            Cuando alguien de tu equipo conecta Claude o ChatGPT a Likida, ese cliente
            queda <strong>leyendo</strong> —nunca cambiando— lo que ve el rol con el que
            autorizó, sin navegador y sin volver a iniciar sesión. Aquí está quién tiene
            qué conectado y desde cuándo. Tus propias conexiones las cortas en{' '}
            <strong>Mi perfil</strong>.
          </p>

          {sesiones === null ? (
            <EstadoError mensaje="No pude leer las sesiones MCP de la flota. No se enseña una lista a medias: media lista se vería igual que la lista entera, y sobre accesos eso hace creer que ya no queda nada conectado." />
          ) : (
            <ListaSesionesMcp sesiones={sesiones} cortarSesiones={cortarSesiones} />
          )}

          <p className="text-[11px] max-w-2xl" style={{ color: 'var(--faint)' }}>
            El nombre del cliente lo declaró quien lo registró, no Likida. Cortar el
            acceso tumba todos los tokens vivos de esa persona de un tiro y no tiene
            deshacer: para volver a conectar hay que autorizar otra vez desde el cliente.
          </p>
        </div>
      </div>
    </main>
  );
}
