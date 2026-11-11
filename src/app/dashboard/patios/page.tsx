import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { resolverTenantAtadoOLanza } from '@/lib/auth/tenant-atado';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeAdministrar } from '@/lib/auth/permisos';
import { alcanceDePatio } from '@/lib/auth/patio';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import {
  getTerminalesConConteos, getJefesDeTrafico, contarSinPatio, crearTerminal, editarTerminal, eliminarTerminal,
  asignarTerminalJefe, asignarSinPatio,
} from '@/lib/likida/terminales';
import { sufijoTenant } from '../sufijo';
import { VistaPatios, type FilaPatio, type FilaJefe } from './vista';
import type { ResultadoForma } from './formas';
import type { Metadata } from 'next';
import { getT } from '@/lib/i18n/servidor';
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('operacion');
  return { title: t('meta.patios') };
}

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/patios';

/**
 * LOS PATIOS DE LA FLOTA (W2 «producto»). Ver: `vista.tsx`.
 *
 * DOS PUERTAS. VER es área `operacion` (el jefe de tráfico ve cuál es su patio);
 * ADMINISTRAR —crear, editar, borrar, asignar jefes y mover lo que quedó sin
 * patio— es `puedeAdministrar` (dueño y soporte): que un jefe cambiara patios o
 * se asignara a sí mismo uno distinto sería ampliarse el alcance. LAS DOS SE
 * VUELVEN A COMPROBAR dentro de cada server action (alcanzable por POST directo),
 * y el `tenantId` sale de la sesión re-resuelta, nunca del formulario.
 */
export default async function PaginaPatios({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol, userId } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');
  const sufijo = sufijoTenant(sp);
  const administra = puedeAdministrar(rol);

  // UNA LECTURA CAÍDA NO TUMBA LA PANTALLA ni se pinta como «no hay patios»:
  // la vista dice que no pudo leer.
  let patios: FilaPatio[] | null = null;
  try { patios = await getTerminalesConConteos(tenantId); } catch { patios = null; }

  let jefes: FilaJefe[] | null = null;
  let sinPatio: { operadores: number; unidades: number } | null = null;
  if (administra) {
    try {
      jefes = (await getJefesDeTrafico(tenantId)).map((j) => ({
        userId: j.userId, etiqueta: j.nombre ? `${j.nombre} (${j.email})` : j.email, terminalId: j.terminalId ?? '',
      }));
    } catch { jefes = null; }
    try { sinPatio = await contarSinPatio(tenantId); } catch { sinPatio = null; }
  }

  // Si quien mira es un jefe con patio, se le dice cuál es el suyo.
  let patioDelJefe: string | null = null;
  if (!administra) {
    const alcance = await alcanceDePatio(tenantId, userId, rol);
    if (alcance?.tipo === 'patio') patioDelJefe = (patios ?? []).find((p) => p.id === alcance.terminalId)?.nombre ?? 'tu patio';
  }

  async function crear(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
  const { t } = await getT('operacion');
    const s = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
    if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: t('patios.a.rol') };
    if (!puedeAdministrar(s.rol)) return { ok: false, error: t('patios.a.crea') };
    try {
      const nombre = String(fd.get('nombre') ?? '');
      await crearTerminal(s.tenantId, { nombre, ciudad: String(fd.get('ciudad') ?? '') }, { id: s.userId });
      revalidatePath(RUTA);
      return { ok: true, mensaje: t('patios.a.creado', { nombre: nombre.replace(/\s+/g, ' ').trim() }) };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'crear el patio') };
    }
  }

  async function editar(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
  const { t } = await getT('operacion');
    const s = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
    if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: t('patios.a.rol') };
    if (!puedeAdministrar(s.rol)) return { ok: false, error: t('patios.a.edita') };
    try {
      await editarTerminal(s.tenantId, String(fd.get('terminalId') ?? ''), {
        nombre: String(fd.get('nombre') ?? ''), ciudad: String(fd.get('ciudad') ?? ''),
      }, { id: s.userId });
      revalidatePath(RUTA);
      return { ok: true, mensaje: t('patios.a.actualizado') };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'guardar el patio') };
    }
  }

  async function eliminar(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
  const { t } = await getT('operacion');
    const s = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
    if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: t('patios.a.rol') };
    if (!puedeAdministrar(s.rol)) return { ok: false, error: t('patios.a.borra') };
    try {
      const q = await eliminarTerminal(s.tenantId, String(fd.get('terminalId') ?? ''), { id: s.userId });
      revalidatePath(RUTA);
      return { ok: true, mensaje: t('patios.a.borrado', { operadores: q.operadores, unidades: q.unidades }) };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'borrar el patio') };
    }
  }

  async function asignarJefe(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
  const { t } = await getT('operacion');
    const s = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
    if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: t('patios.a.rol') };
    if (!puedeAdministrar(s.rol)) return { ok: false, error: t('patios.a.jefes') };
    try {
      const terminalId = String(fd.get('terminalId') ?? '').trim() || null;
      await asignarTerminalJefe(s.tenantId, String(fd.get('userId') ?? ''), terminalId, { id: s.userId });
      revalidatePath(RUTA);
      return {
        ok: true,
        mensaje: terminalId
          ? t('patios.a.jefe.patio')
          : t('patios.a.jefe.toda'),
      };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'asignar el patio al jefe') };
    }
  }

  async function asignarSinPatioAccion(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
  const { t } = await getT('operacion');
    const s = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
    if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: t('patios.a.rol') };
    if (!puedeAdministrar(s.rol)) return { ok: false, error: t('patios.a.sinpatio') };
    const tabla = String(fd.get('tabla') ?? '');
    if (tabla !== 'operador' && tabla !== 'unidad') return { ok: false, error: t('patios.a.noreconoce') };
    try {
      const n = await asignarSinPatio(tabla, s.tenantId, String(fd.get('terminalId') ?? ''), { id: s.userId });
      revalidatePath(RUTA);
      return { ok: true, mensaje: n === 0 ? t('patios.a.nadie') : t(`patios.a.listo.${tabla}`, { n }) };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'asignar el patio') };
    }
  }

  return (
    <VistaPatios
      tr={await getT('operacion')}
      patios={patios}
      jefes={jefes}
      sinPatio={sinPatio}
      puedeAdministrar={administra}
      ilegible={patios === null}
      hrefOperadores={`/dashboard/operadores${sufijo}`}
      hrefUnidades={`/dashboard/unidades${sufijo}`}
      crear={crear}
      editar={editar}
      eliminar={eliminar}
      asignarJefe={asignarJefe}
      asignarSinPatio={asignarSinPatioAccion}
      patioDelJefe={patioDelJefe}
    />
  );
}
