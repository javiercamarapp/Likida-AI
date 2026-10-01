import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeEditarCatalogoOperativo } from '@/lib/auth/permisos';
import {
  alcanceDePatio, dentroDelAlcance, exigirDentroDelAlcance, movimientoPermitido, patioParaCrear,
} from '@/lib/auth/patio';
import {
  actualizarOperador, crearOperador, mensajeParaPantalla,
  getOperadoresRegistro, getOperadoresConteos, OPERADORES_POR_PAGINA,
} from '@/lib/likida/administracion';
import { getTerminales, terminalDeRegistro, terminalesDeRegistros } from '@/lib/likida/terminales';
import {
  invitarOperadores, reintentarFallidas, estadoInvitaciones, contarPendientes, contarConFallo, mensajeDeInvitacion,
  type InvitacionDeOperador,
} from '@/lib/likida/invitacion_operador';
import { cargarOperadoresDesdeArchivo } from '@/lib/likida/importacion/panel';
import { plantillaOperadoresCsv } from '@/lib/likida/importacion/operadores';
import type { ResultadoImportacionUI } from '@/lib/likida/importacion/resultado_ui';
import { DIAS_AVISO } from '@/lib/likida/vigencias';
import { ahoraMs } from '@/lib/saludo';
import { hoyMx } from '@/lib/formato';
import { sufijoTenant } from '../sufijo';
import { camposDeSufijo } from '../paginar-campos';
import { sanearQ, type PaginaRegistroUI } from '../paginar-registro';
import { VistaOperadores, type FilaOperador } from './vista';
import type { ResultadoForma } from './forma';
import type { ResultadoInvitar } from './invitaciones';

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
 *  · EDITAR es `puedeEditarCatalogoOperativo` (W2): el dueño, el soporte y el
 *    JEFE DE TRÁFICO — antes solo el dueño, aunque `roles.ts` le anuncia al
 *    encargado «despacha y da seguimiento: viajes, operadores, unidades». Un
 *    jefe con patio asignado (`app_user.terminal_id`, 0460) solo corrige los de
 *    SU patio (`lib/auth/patio.ts`); sin patio, toda la flota. Un operador no
 *    corrige su propia licencia (no tiene login desde el 7-ago-2026).
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
  const { tenantId, rol, userId } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');
  const sufijo = sufijoTenant(sp);

  // ── EL ALCANCE (W2). `null` = no edita (rol sin el permiso, o un jefe cuyo
  // patio no se pudo leer: «no sé de qué patio es» no es «de toda la flota»).
  const alcance = await alcanceDePatio(tenantId, userId, rol);
  const puedeEditar = alcance !== null;
  let patios: Awaited<ReturnType<typeof getTerminales>> = [];
  try { patios = await getTerminales(tenantId); } catch { /* el selector no se pinta; el servidor sigue exigiendo el alcance */ }
  const patioDelJefe = alcance?.tipo === 'patio'
    ? (patios.find((p) => p.id === alcance.terminalId)?.nombre ?? 'tu patio')
    : null;
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

  // El patio y la invitación de CADA fila de la página, en un `in(...)` cada uno
  // (no una consulta por fila). Si no se pueden leer, no se inventa: sin patio
  // conocido, un jefe con patio no edita la fila; sin invitación conocida, no se
  // pinta el estado.
  const idsPagina = (registro?.filas ?? []).map((o) => o.operadorId);
  let patioPorId: Map<string, string | null> | null = null;
  let invitacionPorId: Map<string, InvitacionDeOperador> | null = null;
  try { patioPorId = await terminalesDeRegistros('operador', tenantId, idsPagina); } catch { /* ver arriba */ }
  try { invitacionPorId = await estadoInvitaciones(tenantId, idsPagina); } catch { /* ver arriba */ }
  const nombreDePatio = new Map(patios.map((p) => [p.id, p.nombre] as const));

  let invitaciones: { pendientes: number; conFallo: number } | null = null;
  if (puedeEditar) {
    try {
      const a = alcance ?? { tipo: 'flota' as const };
      invitaciones = { pendientes: await contarPendientes(tenantId, a), conFallo: await contarConFallo(tenantId, a) };
    } catch { /* la tarjeta no se pinta: contar mal sería afirmar «0 pendientes» */ }
  }

  const filas: FilaOperador[] = (registro?.filas ?? []).map((o) => ({
    terminalId: patioPorId?.get(o.operadorId) ?? null,
    terminalNombre: nombreDePatio.get(patioPorId?.get(o.operadorId) ?? '') ?? null,
    invitacion: invitacionPorId?.get(o.operadorId) ?? null,
    // Con alcance de flota se edita todo; con patio, solo lo que se pudo LEER
    // como de ese patio (`patioPorId` nulo = no se pudo leer = no se edita).
    editable: alcance?.tipo === 'flota' || (patioPorId !== null && dentroDelAlcance(alcance, patioPorId.get(o.operadorId) ?? null)),
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
    if (!puedeEditarCatalogoOperativo(s.rol)) {
      return { ok: false, error: 'Tu rol no puede corregir los datos de un operador.' };
    }
    const alcanceAccion = await alcanceDePatio(s.tenantId, s.userId, s.rol);
    if (!alcanceAccion) return { ok: false, error: 'No pude comprobar tu patio — no se guardó nada. Vuelve a intentar.' };

    const operadorId = String(fd.get('operadorId') ?? '').trim();
    try {
      // El patio del registro sale de la BASE, no del formulario: un POST directo
      // con el id de un operador de otro patio rebota aquí, antes de escribir.
      const actual = await terminalDeRegistro('operador', s.tenantId, operadorId);
      if (!actual.encontrado) return { ok: false, error: 'No se encontró ese operador en tu flota. Recarga la pantalla.' };
      exigirDentroDelAlcance(alcanceAccion, actual.terminalId);

      // El patio nuevo, solo si la forma lo mandó. Un jefe con patio no puede
      // mover al operador a otro patio (ni sacarlo de su patio).
      let terminalId: string | null | undefined;
      if (fd.has('terminalId')) {
        const pedido = String(fd.get('terminalId') ?? '').trim() || null;
        if (pedido !== actual.terminalId) {
          if (!movimientoPermitido(alcanceAccion, pedido)) {
            return { ok: false, error: 'Solo quien administra la flota mueve a un operador de patio.' };
          }
          terminalId = pedido;
        }
      }

      // La baja y la reactivación son BOTONES (no un checkbox): `accion` lo dice.
      // Sin `accion` (guardar) el estado de alta NO se toca.
      const accion = String(fd.get('accion') ?? 'guardar');
      const activo = accion === 'baja' ? false : accion === 'reactivar' ? true : undefined;

      // `actualizarOperador` es la que manda (misma función que prueba
      // `administracion.test.ts`); anota la bitácora con el actor, y la baja y
      // la reactivación con su propio nombre.
      await actualizarOperador(s.tenantId, operadorId, {
        nombre: String(fd.get('nombre') ?? ''),
        telefono: String(fd.get('telefono') ?? ''),
        numeroEmpleado: String(fd.get('numeroEmpleado') ?? ''),
        licencia: String(fd.get('licencia') ?? ''),
        licenciaTipo: String(fd.get('licenciaTipo') ?? ''),
        licenciaVence: String(fd.get('licenciaVence') ?? ''),
        rfc: String(fd.get('rfc') ?? ''),
        ...(activo !== undefined ? { activo } : {}),
        ...(terminalId !== undefined ? { terminalId } : {}),
      }, { id: s.userId });

      revalidatePath(RUTA);
      // El mensaje DICE lo que pasó. "Datos actualizados" sobre una baja
      // esconde justo el efecto que hay que confirmar: que el chofer dejó de
      // recibir mensajes del bot y de aparecer en despacho.
      return {
        ok: true,
        mensaje: activo === false
          ? 'Operador dado de baja. Ya no recibe mensajes del bot ni aparece en Despacho; su historial queda completo.'
          : activo === true ? 'Operador reactivado. Vuelve a aparecer en Despacho y el bot lo atiende otra vez.'
            : 'Datos del operador actualizados.',
      };
    } catch (e) {
      // `DatoInvalido` sale VERBATIM (dice qué corregir); cualquier otra cosa
      // se loguea y sale como falla del sistema.
      return { ok: false, error: mensajeParaPantalla(e, 'guardar los datos del operador') };
    }
  }

  /** El alta de UN operador (la guía de arranque mandaba aquí y solo se editaba). */
  async function altaOperador(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: 'Tu rol no puede ver el registro de operadores.' };
    if (!puedeEditarCatalogoOperativo(s.rol)) return { ok: false, error: 'Tu rol no puede dar de alta operadores.' };
    const alcanceAccion = await alcanceDePatio(s.tenantId, s.userId, s.rol);
    if (!alcanceAccion) return { ok: false, error: 'No pude comprobar tu patio — no se dio de alta a nadie. Vuelve a intentar.' };
    try {
      const nombre = String(fd.get('nombre') ?? '');
      await crearOperador(s.tenantId, {
        nombre,
        telefono: String(fd.get('telefono') ?? ''),
        numeroEmpleado: String(fd.get('numeroEmpleado') ?? '') || undefined,
        // Un jefe con patio da de alta SIEMPRE en el suyo; el dueño, donde pida.
        terminalId: patioParaCrear(alcanceAccion, String(fd.get('terminalId') ?? '')),
      }, { id: s.userId });
      revalidatePath(RUTA);
      return { ok: true, mensaje: `${nombre.trim()} quedó dado de alta. Cuando le escriba a Likida desde ese número, el bot ya lo reconoce.` };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'dar de alta al operador') };
    }
  }

  /** La carga masiva: revisar (no escribe) y confirmar. Mismo motor que `POST /v1/operadores`. */
  async function cargarOperadores(_previo: ResultadoImportacionUI | null, fd: FormData): Promise<ResultadoImportacionUI | null> {
    'use server';
    const vacio = (error: string): ResultadoImportacionUI => ({
      error, paso: 'previsualizar', huella: '', archivo: '', leidas: 0, nuevas: 0, yaEstaban: 0, conProblema: 0,
      muestra: [], problemas: [], patiosDesconocidos: [], avisos: [], excedeTope: false,
    });
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return vacio('Tu rol no puede ver el registro de operadores.');
    if (!puedeEditarCatalogoOperativo(s.rol)) return vacio('Tu rol no puede dar de alta operadores.');
    const alcanceAccion = await alcanceDePatio(s.tenantId, s.userId, s.rol);
    if (!alcanceAccion) return vacio('No pude comprobar tu patio — no se cargó nada. Vuelve a intentar.');
    const r = await cargarOperadoresDesdeArchivo({ tenantId: s.tenantId, alcance: alcanceAccion, actor: { id: s.userId }, datos: fd });
    if (r.confirmado) revalidatePath(RUTA);
    return r;
  }

  /** Las invitaciones por WhatsApp: a uno, a los pendientes, o reintento de los fallidos. */
  async function invitar(_previo: ResultadoInvitar, fd: FormData): Promise<ResultadoInvitar> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: 'Tu rol no puede ver el registro de operadores.' };
    if (!puedeEditarCatalogoOperativo(s.rol)) return { ok: false, error: 'Tu rol no puede invitar operadores.' };
    const alcanceAccion = await alcanceDePatio(s.tenantId, s.userId, s.rol);
    if (!alcanceAccion) return { ok: false, error: 'No pude comprobar tu patio — no se mandó nada. Vuelve a intentar.' };
    try {
      const modo = String(fd.get('modo') ?? '');
      const actor = { id: s.userId };
      const r = modo === 'uno'
        ? await invitarOperadores(s.tenantId, { ids: [String(fd.get('operadorId') ?? '')], alcance: alcanceAccion, actor })
        : modo === 'fallidas'
          ? await reintentarFallidas(s.tenantId, { alcance: alcanceAccion, actor })
          : await invitarOperadores(s.tenantId, { alcance: alcanceAccion, actor });
      revalidatePath(RUTA);
      return mensajeDeInvitacion(r);
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'enviar las invitaciones') };
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
      puedeEditar={puedeEditar}
      guardarOperador={guardarOperador}
      patios={patios.map((p) => ({ id: p.id, nombre: p.nombre }))}
      patioDelJefe={patioDelJefe}
      altaOperador={altaOperador}
      cargarOperadores={cargarOperadores}
      invitar={invitar}
      plantillaCsv={plantillaOperadoresCsv()}
      invitaciones={invitaciones}
      hrefPatios={`/dashboard/patios${sufijo}`}
      hrefGuia={`/dashboard/whatsapp${sufijo}`}
    />
  );
}
