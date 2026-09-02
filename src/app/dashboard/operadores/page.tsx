import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeAdministrar } from '@/lib/auth/permisos';
import {
  actualizarOperador, mensajeParaPantalla,
  getOperadoresRegistro, getOperadoresConteos, OPERADORES_POR_PAGINA,
} from '@/lib/likida/administracion';
import { DIAS_AVISO } from '@/lib/likida/vigencias';
import { ahoraMs } from '@/lib/saludo';
import { hoyMx } from '@/lib/formato';
import { sufijoTenant } from '../sufijo';
import { camposDeSufijo } from '../paginar-campos';
import { sanearQ, type PaginaRegistroUI } from '../paginar-registro';
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

  // El día del CHOFER (México), no el UTC del servidor — a las 6pm de CDMX
  // una licencia que vence "hoy" ya se marcaba vencida con el día UTC.
  const hoy = hoyMx(new Date(ahoraMs()));

  // ── LA PÁGINA LA CORTA LA BASE, NO LA PANTALLA (auditoría 24, ADM-2) ─────
  //
  // Antes: `getOperadoresDetalle(tenantId)` traía el padrón COMPLETO y
  // `paginarRegistro` lo filtraba y rebanaba en memoria. Con el padrón de una
  // flota de 800 tractos —varios cientos de choferes— eso es traer el catálogo
  // entero a cada pintado para enseñar 25 filas, y encima los KPIs se contaban
  // sobre la lista cargada.
  //
  // Ahora `operadores_registro_tenant` (0298) corta la página sobre un orden
  // TOTAL y devuelve el `total` en la MISMA respuesta, y
  // `operadores_conteos_tenant` cuenta los KPIs sobre la FLOTA ENTERA. El
  // «25 de N» del pie vuelve a ser verdad sin traerse las N filas.
  const q = sanearQ(sp.q);
  const pCruda = Number(sp.p);
  const paginaPedida = Number.isInteger(pCruda) && pCruda >= 1 ? pCruda : 1;

  // ── UNA LECTURA CAÍDA NO TUMBA LA PANTALLA (auditoría de frontend, FE-3) ─
  // Estas lecturas LANZAN cuando no pueden demostrar lo que devuelven. Sin
  // este catch, la excepción sube al render y el usuario ve la pantalla de
  // error de Next en lugar del registro: pierde también la edición, que no
  // depende de esa lectura. Con él, la vista pinta la sección caída
  // DICIÉNDOLO, que no es lo mismo que una lista vacía ("aún no hay
  // operadores dados de alta" sería mentira, y la peor).
  let registro: Awaited<ReturnType<typeof getOperadoresRegistro>> | null;
  let conteos: Awaited<ReturnType<typeof getOperadoresConteos>> = null;
  try {
    registro = await getOperadoresRegistro(tenantId, { q, pagina: paginaPedida, porPagina: OPERADORES_POR_PAGINA });
    // Los KPIs son de la FLOTA ENTERA, no de la página: un semáforo calculado
    // sobre 25 de 800 diría que no hay licencias vencidas porque cayeron en la
    // página 12. `null` = no se pudo contar, y la vista pinta «—».
    conteos = await getOperadoresConteos(tenantId, hoy, DIAS_AVISO);
  } catch {
    registro = null;
  }

  const filas: FilaOperador[] = (registro?.filas ?? []).map((o) => ({
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

  // ── EL «N de M» DEL PIE TIENE QUE SER VERDAD ────────────────────────────
  //
  // `filtrados` es el conteo REAL de los que casan con la búsqueda (lo cuenta
  // la base, no es el largo de esta página). `total` es el padrón entero, y
  // sale de `conteos` — que es la única lectura que lo sabe. Si `conteos` no
  // respondió Y hay búsqueda, el «de M» no se puede afirmar: se deja igual a
  // `filtrados` SOLO cuando no hay filtro (donde los dos son el mismo número
  // por definición), y con filtro la vista lo dice en vez de inventarlo.
  const filtrados = registro?.total ?? 0;
  const totalFlota = conteos?.total ?? (q === '' ? filtrados : null);

  const pag: PaginaRegistroUI<FilaOperador> = {
    filas,
    pagina: registro?.pagina ?? 1,
    paginas: registro?.paginas ?? 1,
    total: totalFlota ?? filtrados,
    filtrados,
    q,
    // Solo la fila que `?editar=` nombra Y que está en ESTA página trae su
    // formulario: uno abierto que no se ve sería HTML de una fila que nadie
    // está mirando.
    editando: (() => {
      const e = (sp.editar ?? '').trim().slice(0, 64);
      return e && filas.some((f) => f.operadorId === e) ? e : null;
    })(),
  };

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
      // Un checkbox NO viaja en el FormData cuando está desmarcado: su
      // ausencia ES el "false". Leerlo con `=== 'on'` (mismo criterio que
      // `/dashboard/clientes`) es lo que convierte el hueco en la baja.
      const activo = fd.get('activo') === 'on';

      await actualizarOperador(s.tenantId, operadorId, {
        nombre: String(fd.get('nombre') ?? ''),
        // FE-4. Va en CADA guardado igual que los demás (es un reemplazo de
        // fila, no un parche); `actualizarOperador` lee el anterior y solo
        // comprueba duplicados y anota bitácora cuando de verdad cambió.
        telefono: String(fd.get('telefono') ?? ''),
        numeroEmpleado: String(fd.get('numeroEmpleado') ?? ''),
        licencia: String(fd.get('licencia') ?? ''),
        licenciaTipo: String(fd.get('licenciaTipo') ?? ''),
        licenciaVence: String(fd.get('licenciaVence') ?? ''),
        rfc: String(fd.get('rfc') ?? ''),
        activo,
      }, { id: s.userId });

      revalidatePath(RUTA);
      // El mensaje DICE lo que pasó. "Datos actualizados" sobre una baja
      // esconde justo el efecto que hay que confirmar: que el chofer dejó de
      // recibir mensajes del bot y de aparecer en despacho.
      return {
        ok: true,
        mensaje: activo
          ? 'Datos del operador actualizados.'
          : 'Operador dado de baja. Ya no recibe mensajes del bot ni aparece en Despacho; su historial queda completo.',
      };
    } catch (e) {
      // `DatoInvalido` sale VERBATIM (dice qué corregir); cualquier otra cosa
      // se loguea y sale como falla del sistema.
      return { ok: false, error: mensajeParaPantalla(e, 'guardar los datos del operador') };
    }
  }

  return (
    <VistaOperadores
      filas={filas}
      pag={pag}
      conteos={conteos}
      totalConocido={totalFlota !== null}
      sufijo={sufijo}
      camposOcultos={camposOcultos}
      ilegible={registro === null}
      hoy={hoy}
      puedeEditar={puedeAdministrar(rol)}
      guardarOperador={guardarOperador}
    />
  );
}
