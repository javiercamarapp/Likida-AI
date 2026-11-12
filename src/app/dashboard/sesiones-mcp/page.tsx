import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { resolverTenantAtadoOLanza } from '@/lib/auth/tenant-atado';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeAdministrar } from '@/lib/auth/permisos';
import { fechaMx } from '@/lib/formato';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { listarSesionesMcp, revocarSesionesMcp, type SesionMcpUsuario } from '@/lib/mcp/sesiones';
import type { ResultadoForma } from './forma';
import { ListaSesionesMcp } from './vista';
import './sesiones-mcp.css';
import { EstadoError } from '@/app/ui-v2/componentes';
import { EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import type { Metadata } from 'next';
import { getT } from '@/lib/i18n/servidor';
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('resto');
  return { title: t('cfg.sesiones_mcp') };
}

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
  const { t } = await getT('resto');
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
    const s = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
    if (!puedeVerRuta(s.rol, RUTA) || !puedeAdministrar(s.rol)) {
      return { ok: false, error: t('cfg.solo_el_dueno_de_la_flota_8') };
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

  // Las cifras salen de las mismas filas que la tabla; si la lectura cayó no hay cifras (nunca un 0 que parezca «nadie conectado»).
  const ultimoUso = sesiones === null ? null : sesiones.reduce<string | null>((m, s) => (s.ultimoUsoEn !== null && (m === null || s.ultimoUsoEn > m) ? s.ultimoUsoEn : m), null);
  const cifras = sesiones === null ? undefined : [
    { etiqueta: t('e26.mcp_personas'), valor: sesiones.length, nota: t('e26b.mcp_personas_nota') },
    { etiqueta: t('e26.mcp_clientes'), valor: sesiones.reduce((n, s) => n + s.clientes.length, 0), nota: t('e26b.mcp_clientes_nota') },
    { etiqueta: t('e26.mcp_ultimo_uso'), valor: ultimoUso === null ? null : fechaMx(ultimoUso), nota: ultimoUso === null ? t('e26b.mcp_sin_uso_nota') : t('e26b.mcp_ultimo_uso_nota') },
  ];

  return (
    <EsqueletoTablaMaestra
      titulo={t('cfg.sesiones_mcp')} apoyo={t('cfg.quien_de_tu_equipo_tiene_claude')}
      cifras={cifras} etiquetaCifras={t('cfg.sesiones_mcp')}
      pie={`${t('cfg.quien_conecta_claude_o_chatgpt_a')} ${t('cfg.el_nombre_del_cliente_lo_declaro')}`}
    >
      {/* Marcador (display: contents): la tira de cifras lleva su forma también con la lista vacía, cuando no hay tabla que la dispare. */}
      <div className="rv-mcp__cuerpo">
        {sesiones === null ? (
          <EstadoError reintentar>{t('cfg.no_pude_leer_las_sesiones_mcp')}</EstadoError>
        ) : (
          <ListaSesionesMcp t={t} sesiones={sesiones} cortarSesiones={cortarSesiones} />
        )}
      </div>
    </EsqueletoTablaMaestra>
  );
}
