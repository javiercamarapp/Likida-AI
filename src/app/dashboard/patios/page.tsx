import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
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
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: 'Tu rol no puede ver los patios.' };
    if (!puedeAdministrar(s.rol)) return { ok: false, error: 'Solo quien administra la flota crea patios.' };
    try {
      const nombre = String(fd.get('nombre') ?? '');
      await crearTerminal(s.tenantId, { nombre, ciudad: String(fd.get('ciudad') ?? '') }, { id: s.userId });
      revalidatePath(RUTA);
      return { ok: true, mensaje: `El patio «${nombre.replace(/\s+/g, ' ').trim()}» ya existe. Asígnale gente y camiones desde sus fichas o con la carga masiva.` };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'crear el patio') };
    }
  }

  async function editar(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: 'Tu rol no puede ver los patios.' };
    if (!puedeAdministrar(s.rol)) return { ok: false, error: 'Solo quien administra la flota edita patios.' };
    try {
      await editarTerminal(s.tenantId, String(fd.get('terminalId') ?? ''), {
        nombre: String(fd.get('nombre') ?? ''), ciudad: String(fd.get('ciudad') ?? ''),
      }, { id: s.userId });
      revalidatePath(RUTA);
      return { ok: true, mensaje: 'Patio actualizado.' };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'guardar el patio') };
    }
  }

  async function eliminar(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: 'Tu rol no puede ver los patios.' };
    if (!puedeAdministrar(s.rol)) return { ok: false, error: 'Solo quien administra la flota borra patios.' };
    try {
      const q = await eliminarTerminal(s.tenantId, String(fd.get('terminalId') ?? ''), { id: s.userId });
      revalidatePath(RUTA);
      return { ok: true, mensaje: `Patio borrado. ${q.operadores} operadores y ${q.unidades} unidades quedaron sin patio; no se borró a nadie.` };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'borrar el patio') };
    }
  }

  async function asignarJefe(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: 'Tu rol no puede ver los patios.' };
    if (!puedeAdministrar(s.rol)) return { ok: false, error: 'Solo quien administra la flota asigna patios a los jefes de tráfico.' };
    try {
      const terminalId = String(fd.get('terminalId') ?? '').trim() || null;
      await asignarTerminalJefe(s.tenantId, String(fd.get('userId') ?? ''), terminalId, { id: s.userId });
      revalidatePath(RUTA);
      return {
        ok: true,
        mensaje: terminalId
          ? 'Listo: el jefe solo corrige lo de ese patio.'
          : 'Listo: el jefe vuelve a ver y corregir toda la flota.',
      };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'asignar el patio al jefe') };
    }
  }

  async function asignarSinPatioAccion(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: 'Tu rol no puede ver los patios.' };
    if (!puedeAdministrar(s.rol)) return { ok: false, error: 'Solo quien administra la flota reparte lo que quedó sin patio.' };
    const tabla = String(fd.get('tabla') ?? '');
    if (tabla !== 'operador' && tabla !== 'unidad') return { ok: false, error: 'No se reconoce qué asignar. Recarga la pantalla.' };
    try {
      const n = await asignarSinPatio(tabla, s.tenantId, String(fd.get('terminalId') ?? ''), { id: s.userId });
      revalidatePath(RUTA);
      return { ok: true, mensaje: n === 0 ? 'No había nada sin patio que asignar.' : `Listo: ${n} ${tabla === 'operador' ? 'operadores' : 'unidades'} pasaron a ese patio.` };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'asignar el patio') };
    }
  }

  return (
    <VistaPatios
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
