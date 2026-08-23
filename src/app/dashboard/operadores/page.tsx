import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeAdministrar } from '@/lib/auth/permisos';
import { getOperadoresDetalle } from '@/lib/likida/analytics';
import { actualizarOperador, mensajeParaPantalla } from '@/lib/likida/administracion';
import { ahoraMs } from '@/lib/saludo';
import { hoyMx } from '@/lib/formato';
import { sufijoTenant } from '../sufijo';
import { camposDeSufijo } from '../paginar-campos';
import { VistaOperadores, type FilaOperador } from './vista';
import type { ResultadoForma } from './forma';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/operadores';

/**
 * Registro de Operadores (F2 del plan) + su edición (auditoría 2, A2). Área
 * `operacion` y por eso el mapeo de abajo DEJA EN EL SERVIDOR el dinero que
 * `getOperadoresDetalle` trae (anticipoTotal, comprobadoTotal, pctComprobado):
 * fue exactamente la fuga del 4-ago-2026 — "anticipo entregado, comprobado y
 * % por chofer" a la vista del encargado. El dinero por operador vive en el
 * Agente de Liquidación, que sí es pantalla de `dinero`. `licencia` y `rfc` SÍ
 * viajan (no son dinero) porque el formulario de edición los necesita para
 * precargarse.
 *
 * Lo que la lista SIGUE enseñando es la "vigencia que ancla": la licencia
 * (0053) contra el día de México — y "sin registrar" cuando es null, que no
 * es lo mismo que vencida.
 *
 * ── DOS PUERTAS, como en /dashboard/clientes ──────────────────────────────
 *  · VER es área `operacion` (`puedeVerRuta`).
 *  · EDITAR es `puedeAdministrar`: el mismo criterio de `permisos.ts` que
 *    reparte control sobre los datos operativos de la flota — un operador no
 *    corrige su propia licencia (no tiene login desde el 7-ago-2026), lo hace
 *    quien administra.
 *
 * LAS DOS SE VUELVEN A COMPROBAR DENTRO DEL SERVER ACTION: el rol del render
 * es el del momento en que se pintó, y una server action es un endpoint POST
 * alcanzable sin pasar por aquí. El `tenantId` va por CLOSURE desde la sesión
 * re-resuelta — NADA del formulario decide a qué flota pertenece el operador
 * que se edita; eso lo ancla `actualizarOperador` con `.eq('tenant_id', ...)`.
 */
export default async function PaginaOperadores({
  searchParams,
}: {
  /** FE-12: `?q=` busca, `?p=` pagina y `?editar=<id>` abre UNA forma. */
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string; q?: string; p?: string; editar?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');
  const sufijo = sufijoTenant(sp);
  const camposOcultos = camposDeSufijo(sp);

  // ── UNA LECTURA CAÍDA NO TUMBA LA PANTALLA (auditoría de frontend, FE-3) ─
  // `getOperadoresDetalle` lee tablas del tenant y LANZA cuando no puede
  // leerlas completas (`LecturaIncompleta`, pg.ts) — a escala eso deja de ser
  // hipotético. Sin este catch, la excepción sube al render y el usuario ve la
  // pantalla de error de Next en lugar del registro: pierde también el alta y
  // la edición, que no dependen de esa lectura. Con él, la vista pinta la
  // sección caída DICIÉNDOLO, que no es lo mismo que una lista vacía
  // ("aún no hay operadores dados de alta" sería mentira, y la peor).
  let detalle: Awaited<ReturnType<typeof getOperadoresDetalle>> | null;
  try {
    detalle = await getOperadoresDetalle(tenantId);
  } catch {
    detalle = null;
  }

  const filas: FilaOperador[] = (detalle ?? []).map((o) => ({
    operadorId: o.operadorId,
    nombre: o.nombre,
    telefono: o.telefono,
    numeroEmpleado: o.numeroEmpleado,
    activo: o.activo,
    viajes: o.viajes,
    licencia: o.licencia,
    licenciaTipo: o.licenciaTipo,
    licenciaVence: o.licenciaVence,
    rfc: o.rfc,
  }));

  // El día del CHOFER (México), no el UTC del servidor — a las 6pm de CDMX
  // una licencia que vence "hoy" ya se marcaba vencida con el día UTC.
  const hoy = hoyMx(new Date(ahoraMs()));

  async function guardarOperador(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: 'Tu rol no puede ver el registro de operadores.' };
    if (!puedeAdministrar(s.rol)) {
      return { ok: false, error: 'Solo el dueño de la flota corrige los datos de un operador.' };
    }

    const operadorId = String(fd.get('operadorId') ?? '').trim();
    try {
      // La validación del navegador (required, minLength) avisa temprano;
      // `actualizarOperador` es la que manda — misma función que prueba
      // `administracion.test.ts`. Los CINCO campos van siempre, aunque no
      // hayan cambiado: es un reemplazo de fila, no un parche, y así lo prueba
      // el test "actualiza los campos editables".
      await actualizarOperador(s.tenantId, operadorId, {
        nombre: String(fd.get('nombre') ?? ''),
        numeroEmpleado: String(fd.get('numeroEmpleado') ?? ''),
        licencia: String(fd.get('licencia') ?? ''),
        licenciaTipo: String(fd.get('licenciaTipo') ?? ''),
        licenciaVence: String(fd.get('licenciaVence') ?? ''),
        rfc: String(fd.get('rfc') ?? ''),
      }, { id: s.userId });

      revalidatePath(RUTA);
      return { ok: true, mensaje: 'Datos del operador actualizados.' };
    } catch (e) {
      // `DatoInvalido` sale VERBATIM (dice qué corregir); cualquier otra cosa
      // se loguea y sale como falla del sistema.
      return { ok: false, error: mensajeParaPantalla(e, 'guardar los datos del operador') };
    }
  }

  return (
    <VistaOperadores
      filas={filas}
      sp={sp}
      sufijo={sufijo}
      camposOcultos={camposOcultos}
      ilegible={detalle === null}
      hoy={hoy}
      puedeEditar={puedeAdministrar(rol)}
      guardarOperador={guardarOperador}
    />
  );
}
