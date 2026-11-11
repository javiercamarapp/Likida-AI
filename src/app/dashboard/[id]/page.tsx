import { firmarImpersonacion } from '@/lib/auth/tenant-efectivo';
import { exigirFlotaPintada, MENSAJE_FLOTA_CAMBIO } from '@/lib/auth/tenant-atado';
import { requireSessionTenant } from '@/lib/auth/guard';
import { puedeVerArea, inicioDe, rolEfectivo } from '@/lib/auth/visibilidad';
import { notFound, redirect } from 'next/navigation';
import { getLiquidacionDetalle } from '@/lib/likida/analytics';
import { etiquetaConcepto } from '@/lib/likida/cuadre/engine';
import { puedeExportar, puedeAsignar, puedeAdministrar } from '@/lib/auth/permisos';
import { instruccionesAlCambiarOperador } from '@/lib/likida/convenios/envio';
import { avisarAlChofer } from '@/lib/likida/operacion';
import { reasignarOperador, buscarCatalogo, contarCatalogo, type OpcionCatalogo, type TipoCatalogo } from '@/lib/likida/repo';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolverTenantPedido } from '@/lib/auth/tenant-api';
import { revalidatePath } from 'next/cache';
import { reabrirViaje, mensajeParaPantalla } from '@/lib/likida/administracion';
import type { ResultadoAccion } from '@/app/ui-v2/componentes';
import { getT } from '@/lib/i18n/servidor';
import type { Tr } from '@/lib/i18n/dinero_tr';
import { sufijoTenant } from '../sufijo';
import { estadoDeColor, plural } from './vista';
import { DetalleLiquidacion } from './detalle';
import { etiquetaEstatus } from '../estatus';
import {
  leerRevision, revisarLiquidacion, normalizarAjustes, puedeFirmarLiquidacion,
  type AccionRevision, type RevisionDetalle,
} from '@/lib/likida/revision';
import { mxn } from '@/lib/formato';
import { reintentarPdfAjustado } from '@/lib/likida/revision_recalculo';
import { logger } from '@/lib/logger';
import { corregirMontoGasto } from '@/lib/likida/gasto_correccion';
import { disputaPendiente } from '@/lib/likida/gasto_disputa';
import type { Metadata } from 'next';
export async function generateMetadata(): Promise<Metadata> {
  const { t: tr } = await getT('dinero');
  return { title: tr('liquidacion.detalle.meta') };
}

export const dynamic = 'force-dynamic';

// Este mapa YA NO pinta el renglón: lo pinta `etiquetaGasto` (abajo), que
// delega en el motor. Se queda como traducción de respaldo (con el diccionario
// del idioma activo) y como el mapa que `etiquetas_sincronizadas.test.ts`
// mantiene a la par de `label()` del motor. Se desincronizó una vez al partir
// 'viaticos' en tres: el contralor veía "hospedaje" en minúscula cruda en su tabla.
const CONCEPTO = {
  diesel: 'liquidacion.accion.concepto.diesel', caseta: 'liquidacion.accion.concepto.caseta', factura: 'liquidacion.accion.concepto.factura',
  alimentacion: 'liquidacion.accion.concepto.alimentacion', hospedaje: 'liquidacion.accion.concepto.hospedaje',
  transporte: 'liquidacion.accion.concepto.transporte', flete: 'liquidacion.accion.concepto.flete',
  viaticos: 'liquidacion.accion.concepto.viaticos', otro: 'liquidacion.accion.concepto.otro',
} as const;

/** `https://wa.me/52…` con el teléfono del operador tal como está en su
 *  ficha: solo dígitos, y la lada de México una sola vez. Sin teléfono no
 *  hay botón — nunca un link a un número inventado. */
function hrefWhatsApp(telefono: string | null): string | null {
  if (!telefono) return null;
  const digitos = telefono.replace(/\D/g, '');
  if (digitos.length < 10) return null;
  return `https://wa.me/52${digitos.replace(/^52/, '')}`;
}

export default async function Detalle({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ tenant?: string; vista?: string; rol?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { t: tr } = await getT('dinero');

  // Segunda capa (ver dashboard/page.tsx). El id va en la ruta de vuelta para
  // que tras el passcode aterrice en la liquidación que pidió.
  //
  // `sp` VIAJA A LA PUERTA, como en `resolverTenantEfectivo`: sin él, un
  // superadmin en `?vista=demo` caía al tenant de su selección explícita
  // (admin/elegir-flota) y esta página respondía 404 — la liquidación del
  // demo no existe bajo la flota elegida. Esta página no puede usar
  // `resolverTenantEfectivo` directo porque su ruta es dinámica
  // (`/dashboard/<uuid>`) y `puedeVerRuta` no la conoce; el área se gatea a
  // mano abajo.
  const { tenantId: tenantIdDemo, rol: rolReal, userId: actorId } = await requireSessionTenant(`/dashboard/${id}`, sp);
  // AUDITORÍA 13, MEDIO (arquitectura): esta página era la única de datos que
  // no pasaba por rolEfectivo — la previsualización 'ver como' (?rol=contador)
  // gateaba con el rol REAL (superadmin) y el formulario 'Reasignar'/'Reabrir'
  // (acciones destructivas) se pintaban y se EJECUTABAN como superadmin. El rol
  // efectivo solo QUITA visibilidad; las escrituras re-chequean abajo con el
  // rol real.
  const rol = rolEfectivo(rolReal, sp.rol);

  // ESTA PANTALLA ES DINERO, no la ficha operativa del viaje: enseña
  // comprobado contra anticipo, la deducibilidad y el desglose de IVA/IEPS.
  // El área se comprueba a mano y no por `puedeVerRuta` porque la ruta es
  // dinámica (`/dashboard/<uuid>`) y no puede estar en el mapa de rutas.
  if (!puedeVerArea(rol, 'dinero')) redirect(inicioDe(rol));

  // Mismo criterio de dashboard/page.tsx: un superadmin viendo la flota X
  // desde "Ver dashboard" (admin/flotas) necesita que ESTA página de detalle
  // también resuelva a X, no al tenant demo — si no, el link de la tabla
  // llevaría a un 404 (la liquidación no existe bajo el tenant equivocado).
  let tenantId = tenantIdDemo;
  if (rolReal === 'superadmin' && sp?.tenant) {
    tenantId = await resolverTenantPedido(supabaseAdmin(), tenantId, sp.tenant);
    // MX-016 / P06-06: el «ver como» de ESTA pantalla también se firma (0110), igual que en las demás de /dashboard
    // (`resolverTenantEfectivo`); esta ruta dinámica no pasa por ahí. Una vez por (actor, flota, día), nunca rompe la página.
    if (tenantId === sp.tenant) await firmarImpersonacion(actorId, tenantId);
  }

  // `vista`, `rol` y `tenant` TIENEN QUE VIAJAR EN LA VUELTA: el mismo
  // contrato de sufijo que el sidebar y el resto de las páginas
  // (`sufijoTenant`). Sin él, "Viajes" durante el demo caía en `/dashboard`
  // pelón, donde un superadmin sin vista ni tenant rebota a /admin — y la
  // consola interna se proyectaba delante del director de la flota.
  const sufijo = sufijoTenant(sp);

  const d = await getLiquidacionDetalle(id, tenantId);
  if (!d) notFound();
  const e = etiquetaEstatus(d.estatus);
  const puedeReasignar = puedeAsignar(rol);
  // Reabrir es del dueño, no del encargado ni del contador: borra la
  // liquidación y el PDF que quizá ya se entregó.
  // A37-S12-02: se compara contra el estatus del VIAJE (`liquidado`); el de la
  // liquidación es cuadrada / con_diferencias / revisar y nunca lo igualaba.
  const puedeReabrir = puedeAdministrar(rol) && d.viaje?.estatus === 'liquidado';

  /**
   * Reabre el viaje. NO BASTA CAMBIAR `viaje.estatus` — el trigger de la 0036
   * mira si EXISTE la fila de `liquidacion`, y mientras esté no entra ni un
   * gasto. Eso lo resuelve `reabrirViaje`; aquí solo se comprueba el permiso y
   * se exige la confirmación explícita, porque es destructivo.
   */
  async function reabrir(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tra } = await getT('dinero');
    const s = await requireSessionTenant(`/dashboard/${id}`, sp);
    if (!puedeAdministrar(s.rol)) {
      return { error: tra('liquidacion.accion.reabrirSinPermiso') };
    }
    let t = s.tenantId;
    if (s.rol === 'superadmin' && sp?.tenant) {
      t = await resolverTenantPedido(supabaseAdmin(), t, sp.tenant);
    }
    if (!exigirFlotaPintada(t, tenantId)) return { error: MENSAJE_FLOTA_CAMBIO };

    try {
      const { pdfPerdido } = await reabrirViaje(t, d!.folio, fd.get('confirmar') === 'on', { id: s.userId });
      revalidatePath(`/dashboard/${id}`);
      return { ok: tra(pdfPerdido ? 'liquidacion.accion.reabrirOkConPdf' : 'liquidacion.accion.reabrirOk', { folio: d!.folio }) };
    } catch (err) {
      return { error: mensajeParaPantalla(err, 'reabrir el viaje') };
    }
  }

  /**
   * FE-11: devuelve el rechazo, no lo lanza.
   *
   * Antes esto era `(fd) => Promise<void>` con un `await reasignarOperador`
   * pelón: un chofer dado de baja o un fallo de red lanzaba DENTRO de la
   * action y `error.tsx` se llevaba la pantalla entera —«No se pudo cargar el
   * panel»— por un cambio de chofer. Y el rechazo de permiso era un `redirect`
   * mudo: la pantalla volvía igual, sin decir que no se hizo.
   */
  async function reasignar(_previo: ResultadoAccion, formData: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tra } = await getT('dinero');
    // Repite la comprobación de permiso EN el server action: el `puedeAsignar`
    // de arriba solo decide si el <form> se pinta. Sin este segundo chequeo,
    // un contador que arme la petición a mano (misma sesión válida, sin el
    // botón) podría reasignar igual — el mismo criterio que ya usa
    // `requireSessionTenant` para no confiar solo en lo que el proxy filtra.
    const { tenantId: tDemo, rol: r } = await requireSessionTenant(`/dashboard/${id}`, sp);
    if (!puedeAsignar(r)) return { error: tra('liquidacion.accion.reasignarSinPermiso') };
    let t = tDemo;
    if (r === 'superadmin' && sp?.tenant) {
      t = await resolverTenantPedido(supabaseAdmin(), t, sp.tenant);
    }
    if (!exigirFlotaPintada(t, tenantId)) return { error: MENSAJE_FLOTA_CAMBIO };
    const operadorId = String(formData.get('operadorId') ?? '');
    if (!operadorId) {
      return { error: tra('liquidacion.accion.reasignarEligeChofer') };
    }
    let cambio: Awaited<ReturnType<typeof reasignarOperador>>;
    try {
      cambio = await reasignarOperador(t, d!.viajeId, operadorId);
    } catch (err) {
      return { error: mensajeParaPantalla(err, 'reasignar el chofer') };
    }
    // AUDITORÍA A8 ESCALACIÓN (ALTO, hallazgo 1): esta pantalla reseteaba
    // `avisado_en` (dentro de `reasignarOperador`, en cada cambio REAL de
    // chofer) pero nunca avisaba al chofer nuevo — a diferencia de
    // `/dashboard/despacho` (`asignarYAvisar`, despacho/page.tsx:277-308) y del
    // flujo por WhatsApp (`asignar_wa.ts`), que SÍ llaman `avisarAlChofer`
    // justo después de reasignar. Sin el aviso, `avisado_en` se queda en NULL
    // para siempre y el viaje reasignado por aquí queda invisible para
    // `viajesSinAceptar()`/A8 — el chofer nuevo nunca recibe el WhatsApp de
    // asignación y nadie se entera. Mismo patrón: asignado SÍ queda si el
    // aviso falla (best-effort), y se dice para que se pueda reintentar.
    let avisoFallo = false;
    try {
      await avisarAlChofer(t, operadorId, d!.viajeId);
    } catch (err) {
      logger.error('dashboard.reasignar.aviso_fallo', {
        viajeId: d!.viajeId, operadorId, err: err instanceof Error ? err.message : String(err),
      });
      avisoFallo = true;
    }
    // El chofer nuevo recibe las instrucciones del convenio del cliente (nunca lanza ni deshace la reasignación).
    await instruccionesAlCambiarOperador(t, d!.viajeId, cambio);
    revalidatePath(`/dashboard/${id}`);
    if (avisoFallo) {
      return { error: tra('liquidacion.accion.reasignarAvisoFallo') };
    }
    return { ok: tra('liquidacion.accion.reasignarOk') };
  }

  /**
   * FE-2: el `<select>` de "Reasignar chofer" traía el catálogo COMPLETO
   * (`listOperadores` sin `.limit()`), que PostgREST recortaba a 1,000 en
   * silencio — con 7,500 choferes, reasignar al 1,001 era imposible desde la
   * pantalla y nada lo decía. Ahora se busca en el servidor, 20 a la vez; el
   * chofer ACTUAL se pinta desde `d.operadorNombre`, que ya viene con el
   * detalle, así que el control arranca diciendo la verdad sin catálogo.
   *
   * Guardia idéntica a `reasignar` (el server action de al lado): esto es
   * alcanzable por POST directo y devuelve nombres de UNA flota. Lanza ante
   * rechazo o fallo — una lista vacía afirmaría "ningún chofer se llama así".
   */
  async function buscarOperadores(tipo: TipoCatalogo, q: string): Promise<OpcionCatalogo[]> {
    'use server';
    const { t: tra } = await getT('dinero');
    const s = await requireSessionTenant(`/dashboard/${id}`, sp);
    if (!puedeAsignar(s.rol)) throw new Error(tra('liquidacion.accion.reasignarSinPermiso'));
    if (tipo !== 'operador') throw new Error(tra('liquidacion.accion.catalogoDesconocido'));
    let t = s.tenantId;
    if (s.rol === 'superadmin' && sp?.tenant) {
      t = await resolverTenantPedido(supabaseAdmin(), t, sp.tenant);
    }
    if (!exigirFlotaPintada(t, tenantId)) throw new Error(MENSAJE_FLOTA_CAMBIO);
    return buscarCatalogo(t, 'operador', typeof q === 'string' ? q : '');
  }

  // ── LA FIRMA HUMANA (auditoría 24, BLOQ-6 — mig. 0299) ──────────────────
  //
  // Hasta hoy no había NI UN `update` sobre `liquidacion` en toda la app: el
  // agente cerraba y nadie firmaba. `leerRevision` degrada solo — si no se
  // pudo leer, el panel NO se pinta: unos botones sin saber si la liquidación
  // ya está firmada invitan a firmarla dos veces.
  //
  // `leerRevision` LANZA ante un error real de lectura (`exigir()` en pg.ts
  // es fail-closed) y solo devuelve `null` cuando la fila simplemente no
  // tiene revisión. Un `.catch(() => null)` ciego —lo que había aquí antes—
  // metía los dos casos en el mismo balde: "no hay revisión" y "no se pudo
  // leer la revisión" se veían IGUAL, y con eso una liquidación rechazada
  // cuya revisión falló de leer se pintaba como si nunca hubiera pasado por
  // revisión — sin el panel de estado, pero también sin el aviso de que algo
  // falló, y `pdfHref` (abajo) seguía ofreciendo la descarga (BE-A1/FE-M2).
  // Mismo criterio que `totalOperadores`/`contarCatalogo` unas líneas abajo:
  // separar "no hay dato" de "no se pudo leer el dato" en vez de igualarlos.
  let revisionEstado: RevisionDetalle | null = null;
  let revisionIlegible = false;
  try {
    revisionEstado = await leerRevision(tenantId, id);
  } catch (err) {
    logger.error('dashboard.detalle.revision_ilegible', {
      tenantId, liquidacion: id, err: err instanceof Error ? err.message : String(err),
    });
    revisionIlegible = true;
  }
  const puedeFirmar = puedeFirmarLiquidacion(rol);

  /**
   * Aprobar / ajustar / rechazar. TODO pasa por la RPC `revisar_liquidacion`
   * (la tabla rebota cualquier otro camino con LR003), que deja la bitácora en
   * la misma transacción. Aquí solo se re-gatea el permiso con el rol REAL —
   * el `puedeFirmar` de arriba decide si el panel se pinta, no si la petición
   * se acepta — y se traducen los rechazos a mensajes para la persona.
   */
  async function revisar(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tra } = await getT('dinero');
    const s = await requireSessionTenant(`/dashboard/${id}`, sp);
    if (!puedeVerArea(s.rol, 'dinero') || !puedeFirmarLiquidacion(s.rol)) {
      return { error: tra('liquidacion.revision.rolNoFirma') };
    }
    let t = s.tenantId;
    if (s.rol === 'superadmin' && sp?.tenant) {
      t = await resolverTenantPedido(supabaseAdmin(), t, sp.tenant);
    }
    if (!exigirFlotaPintada(t, tenantId)) return { error: MENSAJE_FLOTA_CAMBIO };
    const accion = String(fd.get('accion') ?? '') as AccionRevision;
    try {
      // Los ajustes viajan como `monto:<gastoId>`; los vacíos se saltan en
      // `normalizarAjustes` — un campo en blanco es "no lo toques", no un cero.
      const ajustes = accion === 'ajustar'
        ? normalizarAjustes([...fd.entries()]
          .filter(([k]) => k.startsWith('monto:'))
          .map(([k, v]) => ({ gastoId: k.slice('monto:'.length), montoNuevo: v })))
        : null;
      const r = await revisarLiquidacion({
        tenantId: t, liquidacionId: id, accion, ajustes,
        motivo: String(fd.get('motivo') ?? ''),
        // El correo lo resuelve la RPC desde `app_user` con este id (y lo
        // copia a la fila para que sobreviva a la baja del usuario).
        actor: { id: s.userId },
      });
      revalidatePath(`/dashboard/${id}`);
      revalidatePath('/dashboard/agentes/liquidacion');
      if (r.revision === 'rechazada') {
        return { ok: tra(r.choferAvisado ? 'liquidacion.accion.revisarRechazadaAvisado' : 'liquidacion.accion.revisarRechazadaSinAviso', { folio: r.folio }) };
      }
      if (r.revision === 'ajustada') {
        return {
          ok: plural(tra, r.pdfPendiente ? 'liquidacion.accion.revisarAjustadaPdf' : 'liquidacion.accion.revisarAjustada', r.ajustes.length,
            { folio: r.folio, total: mxn(r.totalComprobado), diferencia: mxn(r.diferencia) }),
        };
      }
      return { ok: tra('liquidacion.accion.revisarAprobada', { folio: r.folio }) };
    } catch (err) {
      return { error: mensajeParaPantalla(err, 'firmar la liquidación') };
    }
  }

  /**
   * A37-P-01 (S45-01): corrige el monto de un comprobante que el operador disputó. Mismo permiso que firmar. `corregirMontoGasto`
   * exige actor y motivo, deja el historial en `ocr_extra` y la bitácora, y el trigger de la base rechaza un viaje con liquidación
   * vigente (CU001) o un gasto con CFDI verificado (CU017): ahí se dice el camino correcto en vez de un «no se pudo».
   */
  async function corregirMontoDisputado(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tra } = await getT('dinero');
    const s = await requireSessionTenant(`/dashboard/${id}`, sp);
    if (!puedeVerArea(s.rol, 'dinero') || !puedeFirmarLiquidacion(s.rol)) {
      return { error: tra('liquidacion.accion.corregirSinPermiso') };
    }
    let t = s.tenantId;
    if (s.rol === 'superadmin' && sp?.tenant) t = await resolverTenantPedido(supabaseAdmin(), t, sp.tenant);
    if (!exigirFlotaPintada(t, tenantId)) return { error: MENSAJE_FLOTA_CAMBIO };
    const gastoId = String(fd.get('gastoId') ?? '');
    // El gasto tiene que ser de ESTA liquidación y seguir disputado: el id del formulario no se acepta a ciegas.
    const det = await getLiquidacionDetalle(id, t);
    const g = det?.gastos.find((x) => x.id === gastoId);
    if (!g || !disputaPendiente(g.ocrExtra)) return { error: tra('liquidacion.accion.corregirSinDisputa') };
    const crudo = String(fd.get('monto') ?? '').replace(/\s/g, '').replace(/,/g, '');
    const [enteros = '', decimales = '', ...resto] = crudo.split('.');
    const monto = resto.length === 0 && /^\d+$/.test(enteros) && /^\d{0,2}$/.test(decimales) ? Number(crudo) : NaN;
    if (!Number.isFinite(monto) || monto <= 0) return { error: tra('liquidacion.accion.corregirFormato') };
    const r = await corregirMontoGasto({
      tenantId: t, gastoId, montoNuevo: monto,
      actor: { id: s.userId }, motivo: String(fd.get('motivo') ?? ''),
    });
    revalidatePath(`/dashboard/${id}`);
    if (r.ok) return { ok: tra('liquidacion.accion.corregirOk', { antes: mxn(r.antes), despues: mxn(r.despues) }) };
    const MOTIVOS = {
      monto_invalido: 'liquidacion.accion.corregirMontoInvalido',
      sin_motivo: 'liquidacion.accion.corregirSinMotivo',
      sin_actor: 'liquidacion.accion.corregirSinActor',
      no_existe: 'liquidacion.accion.corregirNoExiste',
      liquidado: 'liquidacion.accion.corregirLiquidado',
      xml_verificado: 'liquidacion.accion.corregirXmlVerificado',
    } as const;
    const clave = (MOTIVOS as Record<string, (typeof MOTIVOS)[keyof typeof MOTIVOS]>)[r.motivo];
    return { error: tra(clave ?? 'liquidacion.accion.corregirFallo') };
  }

  async function reintentarPdf(_previo: ResultadoAccion, _fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tra } = await getT('dinero');
    const s = await requireSessionTenant(`/dashboard/${id}`, sp);
    if (!puedeVerArea(s.rol, 'dinero') || !puedeFirmarLiquidacion(s.rol)) {
      return { error: tra('liquidacion.accion.pdfSinPermiso') };
    }
    let t = s.tenantId;
    if (s.rol === 'superadmin' && sp?.tenant) t = await resolverTenantPedido(supabaseAdmin(), t, sp.tenant);
    if (!exigirFlotaPintada(t, tenantId)) return { error: MENSAJE_FLOTA_CAMBIO };
    try {
      const r = await reintentarPdfAjustado(t, id);
      revalidatePath(`/dashboard/${id}`);
      return r.regenerado ? { ok: tra('liquidacion.accion.pdfOk') }
        : { error: tra('liquidacion.accion.pdfPendiente') };
    } catch (error) { return { error: mensajeParaPantalla(error, 'regenerar el PDF') }; }
  }

  // Cuántos choferes activos hay — `count exact, head`, cero filas de vuelta.
  // Solo para la pista "20 de N" y para no pintar el control cuando de verdad
  // no hay ninguno. `null` (no se pudo contar) NO apaga el control: no saber
  // cuántos hay no es saber que no hay.
  const totalOperadores = puedeAsignar(rol) ? await contarCatalogo(tenantId, 'operador') : 0;

  return (
    <DetalleLiquidacion
      tr={tr}
      d={d}
      sufijo={sufijo}
      estatus={{ label: e.label, estado: estadoDeColor(e.color) }}
      etiqueta={(g) => etiquetaGasto(g, tr)}
      // BE-A1/FE-M2: una liquidación RECHAZADA no tiene PDF vigente aunque
      // `pdfPath` siga guardado (la 0346 solo lo anula en 'ajustada'), y una
      // revisión que no se pudo LEER tampoco puede afirmar que sí está
      // vigente — las dos apagan el botón. El export vuelve a comprobar
      // `revision` por su cuenta (defensa en profundidad, mismo criterio del
      // IDOR de rol/tenant): esto es solo para no ofrecer un botón que la
      // ruta va a rechazar.
      pdfHref={d.pdfPath && puedeExportar(rol) && revisionEstado?.revision !== 'rechazada' && !revisionIlegible
        ? `/api/export/pdf/${d.id}` : null}
      revisionIlegible={revisionIlegible}
      reintentarPdf={!d.pdfPath && revisionEstado?.revision === 'ajustada' && puedeFirmar ? reintentarPdf : null}
      wa={hrefWhatsApp(d.viaje.operadorTelefono)}
      reasignar={puedeReasignar && totalOperadores !== 0
        ? {
          buscar: buscarOperadores, total: totalOperadores,
          actual: d.operadorId, actualNombre: d.operadorNombre, accion: reasignar,
        }
        : null}
      reabrir={puedeReabrir ? reabrir : null}
      revision={revisionEstado ? {
        estado: revisionEstado,
        // Solo los comprobantes CON id se pueden ajustar: sin id no hay a qué
        // fila apuntarle, y la RPC lo rebotaría (LR017).
        gastos: d.gastos.filter((g) => g.id).map((g) => ({
          id: g.id as string, etiqueta: etiquetaGasto(g, tr), monto: g.monto,
          disputa: disputaPendiente(g.ocrExtra),
        })),
        accion: puedeFirmar ? revisar : null,
        corregir: puedeFirmar ? corregirMontoDisputado : null,
      } : null}
    />
  );
}

/**
 * La etiqueta del renglón tiene que decir lo MISMO que el renglón del PDF.
 *
 * El PDF imprime `etiquetaConcepto`, que para combustible se salta el mapa y
 * respeta el producto impreso en el ticket: "Combustible Magna". El panel usaba
 * su copia literal y del mismo comprobante decía "Diésel" (auditoría 5,
 * arquitectura, ALTO 1). No es cosmética: el estímulo de IEPS es SOLO diésel
 * (LIF 20-A fr. IV), así que etiquetar gasolina como diésel invita a acreditar
 * algo que no aplica — exactamente lo que el motor documenta querer evitar.
 *
 * `etiquetaConcepto` devuelve la clave cruda cuando su mapa no conoce el
 * concepto; ahí —y solo ahí— entra el mapa local como red.
 */
function etiquetaGasto(g: { concepto: string; ocrExtra?: Record<string, unknown> }, tr: Tr): string {
  const delMotor = etiquetaConcepto(g.concepto, g.ocrExtra);
  return delMotor === g.concepto ? (g.concepto in CONCEPTO ? tr(CONCEPTO[g.concepto as keyof typeof CONCEPTO]) : g.concepto) : delMotor;
}
