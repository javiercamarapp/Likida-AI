import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeEditarCatalogoOperativo } from '@/lib/auth/permisos';
import {
  alcanceDePatio, dentroDelAlcance, exigirDentroDelAlcance, movimientoPermitido, patioParaCrear,
} from '@/lib/auth/patio';
import { getTerminales, terminalDeRegistro, terminalesDeRegistros } from '@/lib/likida/terminales';
import { cargarUnidadesDesdeArchivo } from '@/lib/likida/importacion/panel';
import { plantillaUnidadesCsv } from '@/lib/likida/importacion/unidades';
import type { ResultadoImportacionUI } from '@/lib/likida/importacion/resultado_ui';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { validarUnidad, crearUnidad, editarUnidad, cambiarEstadoUnidad, ESTADOS_UNIDAD } from '@/lib/likida/operacion';
import {
  getUnidadesRegistro, getUnidadesConteos, UNIDADES_POR_PAGINA,
  type FilaRegistroUnidad,
} from '@/lib/likida/administracion';
import { DIAS_AVISO } from '@/lib/likida/vigencias';
import { hoyMx } from '@/lib/formato';
import { ahoraMs } from '@/lib/saludo';
import { sanearQ, type PaginaRegistroUI } from '../paginar-registro';
import { CONECTORES_GPS } from '@/lib/likida/conectores/gps';
import { sufijoTenant } from '../sufijo';
import { camposDeSufijo } from '../paginar-campos';
import { VistaUnidades } from './vista';
import { BloqueTaller } from './taller';
import type { ResultadoForma } from './forma';
import type { ResultadoEstado } from './estado';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/unidades';

/**
 * El Registro de Unidades — el activo que produce el dinero, con las vigencias
 * que la ley le exige para poder producirlo. Desde el 14-ago-2026 también se
 * CAPTURA aquí: era la única entidad del panel sin alta (solo la API la
 * escribía), y una flota sin TMS no tenía cómo estrenar su parque.
 *
 * ── DOS PUERTAS DISTINTAS, el patrón de clientes ──────────────────────────
 *  · VER es área `operacion` (`puedeVerRuta`): el jefe de tráfico es
 *    exactamente quien debe enterarse de que una unidad no puede salir.
 *  · ESCRIBIR es `puedeEditarCatalogoOperativo` (W2): el dueño, el soporte y el
 *    JEFE DE TRÁFICO. Antes era solo el dueño, y en una flota de 250 camiones
 *    con unidades que entran y salen de taller a diario quien marca «fuera de
 *    servicio» es el jefe, no el dueño. Un jefe con patio asignado (0460) solo
 *    toca las unidades de SU patio y da de alta en el suyo (`lib/auth/patio.ts`);
 *    sin patio, toda la flota. La baja pide confirmación y todo deja bitácora.
 *
 * LAS DOS SE RE-COMPRUEBAN DENTRO del server action: el `rol` del render es
 * el del momento en que se pintó, y una server action es un endpoint
 * alcanzable por POST directo. El `tenantId` va por sesión re-resuelta, nunca
 * del formulario.
 *
 * SIN CATCH en la lectura: una pantalla que existe para avisar de papeles
 * vencidos no puede pintar "todo en regla" porque la consulta falló. Si no se
 * puede leer, se cae y `error.tsx` lo dice.
 */
export default async function PaginaUnidades({
  searchParams,
}: {
  /** FE-12: `?q=` busca, `?p=` pagina y `?editar=<id>` abre UNA forma. Los
   *  sanea `paginarRegistro`; un link viejo se lee como primera página. */
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
  // Un `<form method="get">` reemplaza el query string ENTERO, así que el
  // sufijo del superadmin tiene que viajar como campo oculto o la búsqueda lo
  // sacaría de la flota que estaba viendo.
  const camposOcultos = camposDeSufijo(sp);

  // ── LA PÁGINA LA CORTA LA BASE, NO LA PANTALLA (auditoría 24, ADM-2) ────
  //
  // Antes: `getUnidades(tenantId)` traía el parque COMPLETO —`traerTodo`, que
  // es lo correcto para DEMOSTRAR un conteo, pero no para pintar 25
  // renglones— y `paginarRegistro` lo ordenaba y rebanaba en memoria. Con 800
  // tractos, el catálogo entero viajaba a la pantalla en cada render.
  //
  // Ahora `unidades_registro_tenant` (0298) corta la página sobre un orden
  // TOTAL —lo que vence antes primero, sin papeles al final, desempate por
  // económico e id— y devuelve el `total` real en la misma respuesta.
  const hoy = hoyMx(new Date(ahoraMs()));
  const q = sanearQ(sp.q);
  const pCruda = Number(sp.p);
  const paginaPedida = Number.isInteger(pCruda) && pCruda >= 1 ? pCruda : 1;

  const registro = await getUnidadesRegistro(tenantId, hoy, {
    q, pagina: paginaPedida, porPagina: UNIDADES_POR_PAGINA, activo: true,
  });

  // Las bajas van en su propia sección y en su propia lectura, ACOTADA: un
  // parque con cientos de bajas no puede arrastrarlas todas a la pantalla solo
  // para llenar un plegable. Se pide una página y se dice cuántas hay.
  const bajas = await getUnidadesRegistro(tenantId, hoy, {
    q: '', pagina: 1, porPagina: UNIDADES_POR_PAGINA, activo: false,
  });

  // El semáforo cuenta la FLOTA ENTERA, no la página: calculado sobre 25 de
  // 800 diría que no hay nada vencido porque los vencidos cayeron en la página
  // 3. `null` = no se pudo contar, y entonces se pinta «—», no un 0.
  const conteos = await getUnidadesConteos(tenantId, hoy, DIAS_AVISO);

  const pag: PaginaRegistroUI<FilaRegistroUnidad> = {
    filas: registro.filas,
    pagina: registro.pagina,
    paginas: registro.paginas,
    // `total` es el parque ACTIVO entero (lo que el pie compara contra los que
    // coinciden); `filtrados`, los que casan con la búsqueda. Los dos los
    // cuenta la base.
    total: conteos?.activas ?? registro.total,
    filtrados: registro.total,
    q,
    editando: (() => {
      const e = (sp.editar ?? '').trim().slice(0, 64);
      return e && registro.filas.some((u) => u.id === e) ? e : null;
    })(),
  };

  // El patio de CADA unidad de la página y de las bajas, en UN `in(...)`. Si no se
  // pudo leer, no se inventa: un jefe con patio no edita lo que no sabe de quién es.
  const idsVisibles = [...registro.filas.map((u) => u.id), ...bajas.filas.map((u) => u.id)];
  let patioPorId: Map<string, string | null> | null = null;
  try { patioPorId = await terminalesDeRegistros('unidad', tenantId, idsVisibles); } catch { /* ver arriba */ }
  const terminalPorUnidad: Record<string, string | null> = {};
  const editablePorUnidad: Record<string, boolean> = {};
  for (const id of idsVisibles) {
    terminalPorUnidad[id] = patioPorId?.get(id) ?? null;
    editablePorUnidad[id] = alcance?.tipo === 'flota' || (patioPorId !== null && dentroDelAlcance(alcance, patioPorId.get(id) ?? null));
  }

  async function guardarUnidad(_previo: ResultadoForma, fd: FormData): Promise<ResultadoForma> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: 'Tu rol no puede ver las unidades.' };
    if (!puedeEditarCatalogoOperativo(s.rol)) {
      return { ok: false, error: 'Tu rol no puede dar de alta ni editar unidades.' };
    }
    const alcanceAccion = await alcanceDePatio(s.tenantId, s.userId, s.rol);
    if (!alcanceAccion) return { ok: false, error: 'No pude comprobar tu patio — no se guardó nada. Vuelve a intentar.' };

    const id = String(fd.get('id') ?? '').trim();
    const eco = String(fd.get('numeroEconomico') ?? '').trim();
    try {
      // El patio del registro sale de la BASE, no del formulario: un POST directo
      // con el id de una unidad de otro patio rebota aquí, antes de escribir.
      let terminalId: string | null | undefined;
      if (id) {
        const actual = await terminalDeRegistro('unidad', s.tenantId, id);
        if (!actual.encontrado) return { ok: false, error: 'No se encontró esa unidad en tu flota. Recarga la pantalla.' };
        exigirDentroDelAlcance(alcanceAccion, actual.terminalId);
        if (fd.has('terminalId')) {
          const pedido = String(fd.get('terminalId') ?? '').trim() || null;
          if (pedido !== actual.terminalId) {
            if (!movimientoPermitido(alcanceAccion, pedido)) return { ok: false, error: 'Solo quien administra la flota mueve una unidad de patio.' };
            terminalId = pedido;
          }
        }
      } else {
        // El ALTA: un jefe con patio crea SIEMPRE en el suyo, pida lo que pida el formulario.
        terminalId = patioParaCrear(alcanceAccion, String(fd.get('terminalId') ?? ''));
      }
      // La validación del navegador (required, max) avisa temprano; ÉSTA es
      // la que manda, y es la misma función que prueba `operacion.test.ts`.
      const valores = validarUnidad({
        numeroEconomico: eco,
        placas: String(fd.get('placas') ?? ''),
        marca: String(fd.get('marca') ?? ''),
        modelo: String(fd.get('modelo') ?? ''),
        anio: String(fd.get('anio') ?? ''),
        polizaVence: String(fd.get('polizaVence') ?? ''),
        permisoSictVence: String(fd.get('permisoSictVence') ?? ''),
        verificacionVence: String(fd.get('verificacionVence') ?? ''),
        // El amarre con el GPS (0176). `validarAmarreGps` comprueba que el
        // proveedor esté en el catálogo y que los dos campos vayan juntos:
        // uno solo de los dos produce una unidad que el poller nunca casa.
        gpsProveedor: String(fd.get('gpsProveedor') ?? ''),
        gpsDeviceId: String(fd.get('gpsDeviceId') ?? ''),
      });

      if (id) await editarUnidad(s.tenantId, id, { ...valores, ...(terminalId !== undefined ? { terminalId } : {}) }, { id: s.userId });
      else await crearUnidad(s.tenantId, { ...valores, terminalId }, { id: s.userId });

      revalidatePath(RUTA);
      const sinPapeles = !valores.polizaVence && !valores.permisoSictVence && !valores.verificacionVence;
      return {
        ok: true,
        mensaje: id
          ? `La unidad ${valores.numeroEconomico} quedó actualizada.`
          : `La unidad ${valores.numeroEconomico} ya está dada de alta.${sinPapeles
            ? ' Sin fechas de papeles sale como "sin papeles" — captúralas para que Likida avise antes de que venzan.'
            : ''}`,
      };
    } catch (e) {
      // El choque contra `unidad_economico_unico` llega como Error plano
      // (`crearUnidad` no lo traduce porque `POST /v1/unidades` reconoce el
      // nombre del índice en el mensaje). Aquí sí se dice en palabras de
      // quien capturó; el resto va por `mensajeParaPantalla`.
      if (e instanceof Error && e.message.includes('unidad_economico_unico')) {
        return { ok: false, error: `Ya tienes una unidad con el número económico "${eco}". Búscala en la lista en vez de darla de alta otra vez.` };
      }
      // El otro índice que un alta puede chocar desde la 0176: `uq_unidad_gps`
      // (un dispositivo = un camión por flota). `crearUnidad` tampoco lo
      // traduce, por el mismo motivo que el anterior.
      if (e instanceof Error && e.message.includes('uq_unidad_gps')) {
        return { ok: false, error: 'Ese número de dispositivo de GPS ya está ligado a otra unidad de tu flota con el mismo proveedor. Un dispositivo solo puede pertenecer a un camión.' };
      }
      return { ok: false, error: mensajeParaPantalla(e, id ? 'guardar la unidad' : 'dar de alta la unidad') };
    }
  }

  /**
   * ── EL ESTADO OPERATIVO DE LA UNIDAD (auditoría 20, H4) ──────────────────
   *
   * LAS MISMAS DOS PUERTAS que el alta y la edición, y por la misma razón: dar
   * de baja un camión es un acto sobre un activo de la empresa, no una nota
   * operativa. Se re-comprueban aquí adentro porque un server action es un
   * endpoint POST alcanzable sin haber pasado por el render — el `rol` de
   * arriba es el del momento en que se pintó la pantalla.
   *
   * El `tenantId` va por SESIÓN RE-RESUELTA, nunca del formulario: lo único
   * que el navegador decide es QUÉ unidad y A QUÉ estado, y las dos cosas las
   * vuelve a revisar `cambiarEstadoUnidad` (dominio del estado + `.eq(
   * 'tenant_id')` + filas afectadas). Con el UUID de una unidad de OTRA flota
   * el UPDATE toca cero filas y sale como error, no como "dada de baja".
   */
  async function cambiarEstado(_previo: ResultadoEstado, fd: FormData): Promise<ResultadoEstado> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: 'Tu rol no puede ver las unidades.' };
    if (!puedeEditarCatalogoOperativo(s.rol)) {
      return { ok: false, error: 'Tu rol no puede cambiar el estado de una unidad.' };
    }
    const alcanceAccion = await alcanceDePatio(s.tenantId, s.userId, s.rol);
    if (!alcanceAccion) return { ok: false, error: 'No pude comprobar tu patio — no se cambió nada. Vuelve a intentar.' };

    const unidadId = String(fd.get('unidadId') ?? '').trim();
    const estado = String(fd.get('estado') ?? '').trim();
    try {
      // El patio de la unidad sale de la BASE: el jefe de otro patio no la da de baja.
      const actual = await terminalDeRegistro('unidad', s.tenantId, unidadId);
      if (!actual.encontrado) return { ok: false, error: 'No se encontró esa unidad en tu flota. Recarga la pantalla.' };
      exigirDentroDelAlcance(alcanceAccion, actual.terminalId);
      // El actor viaja para que la bitácora pueda contestar "quién dio de baja
      // este camión y cuándo" — la pregunta del seguro y la del contador que
      // lo deduce.
      await cambiarEstadoUnidad(s.tenantId, unidadId, estado, { id: s.userId });
      revalidatePath(RUTA);
      return {
        ok: true,
        mensaje: estado === 'baja'
          ? 'Unidad dada de baja. Deja de ofrecerse para viajes nuevos y sale del conteo de papeles; su historial queda completo.'
          : `Unidad en «${ESTADOS_UNIDAD[estado] ?? estado}».`,
      };
    } catch (e) {
      return { ok: false, error: mensajeParaPantalla(e, 'cambiar el estado de la unidad') };
    }
  }

  /** La carga masiva: revisar (no escribe) y confirmar. Mismo motor que `POST /v1/unidades`. */
  async function cargarUnidades(_previo: ResultadoImportacionUI | null, fd: FormData): Promise<ResultadoImportacionUI | null> {
    'use server';
    const vacio = (error: string): ResultadoImportacionUI => ({
      error, paso: 'previsualizar', huella: '', archivo: '', leidas: 0, nuevas: 0, yaEstaban: 0, conProblema: 0,
      muestra: [], problemas: [], patiosDesconocidos: [], avisos: [], excedeTope: false,
    });
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return vacio('Tu rol no puede ver las unidades.');
    if (!puedeEditarCatalogoOperativo(s.rol)) return vacio('Tu rol no puede dar de alta unidades.');
    const alcanceAccion = await alcanceDePatio(s.tenantId, s.userId, s.rol);
    if (!alcanceAccion) return vacio('No pude comprobar tu patio — no se cargó nada. Vuelve a intentar.');
    const r = await cargarUnidadesDesdeArchivo({ tenantId: s.tenantId, alcance: alcanceAccion, actor: { id: s.userId }, datos: fd });
    if (r.confirmado) revalidatePath(RUTA);
    return r;
  }

  return (
    <>
      <VistaUnidades
        pag={pag}
        bajas={bajas.filas}
        totalBajas={bajas.total}
        conteos={conteos}
        totalActivasConocido={conteos !== null}
        sufijo={sufijo}
        camposOcultos={camposOcultos}
        cambiarEstado={cambiarEstado}
        // El gateo de la UI solo decide si la forma SE PINTA; la puerta real se
        // re-comprueba adentro del action (alcanzable por POST directo).
        puedeEditar={puedeEditar}
        guardar={guardarUnidad}
        patios={patios.map((p) => ({ id: p.id, nombre: p.nombre }))}
        patioDelJefe={patioDelJefe}
        terminalPorUnidad={terminalPorUnidad}
        editablePorUnidad={editablePorUnidad}
        cargarUnidades={cargarUnidades}
        plantillaCsv={plantillaUnidadesCsv()}
        hrefPatios={`/dashboard/patios${sufijo}`}
        // Al cliente viaja SOLO id+nombre: el catálogo trae los `probar()` y
        // las fuentes de cada fabricante, y nada de eso va al navegador.
        proveedoresGps={CONECTORES_GPS.map((c) => ({ id: c.id, nombre: c.nombre }))}
      />
      {/* Fase 9 (0209): el taller — órdenes de mantenimiento y rutinas
          preventivas de las mismas unidades de arriba. */}
      <BloqueTaller sp={sp} />
    </>
  );
}
