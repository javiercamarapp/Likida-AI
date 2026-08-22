import { requireSessionTenant } from '@/lib/auth/guard';
import { puedeVerArea, inicioDe, rolEfectivo } from '@/lib/auth/visibilidad';
import { notFound, redirect } from 'next/navigation';
import { getLiquidacionDetalle } from '@/lib/likida/analytics';
import { etiquetaConcepto } from '@/lib/likida/cuadre/engine';
import { puedeExportar, puedeAsignar, puedeAdministrar } from '@/lib/auth/permisos';
import { listOperadores, reasignarOperador } from '@/lib/likida/repo';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolverTenantPedido } from '@/lib/auth/tenant-api';
import { revalidatePath } from 'next/cache';
import { reabrirViaje, mensajeParaPantalla } from '@/lib/likida/administracion';
import type { ResultadoAccion } from '../../admin/ui/forma';
import { sufijoTenant } from '../sufijo';
import { estadoDeColor } from './vista';
import { DetalleLiquidacion } from './detalle';
import { etiquetaEstatus } from '../estatus';

export const dynamic = 'force-dynamic';

// Este mapa YA NO pinta el renglón: lo pinta `etiquetaGasto` (abajo), que
// delega en el motor. Se queda como traducción de respaldo y como el mapa que
// `etiquetas_sincronizadas.test.ts` mantiene a la par de `label()` del motor.
// Se desincronizó una vez al partir 'viaticos' en tres: el contralor veía
// "hospedaje" en minúscula cruda en su tabla.
const CONCEPTO: Record<string, string> = {
  diesel: 'Diésel', caseta: 'Caseta', factura: 'Factura',
  alimentacion: 'Alimentación', hospedaje: 'Hospedaje', transporte: 'Transporte', flete: 'Flete',
  viaticos: 'Viáticos', otro: 'Otro',
};

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
  const { tenantId: tenantIdDemo, rol: rolReal } = await requireSessionTenant(`/dashboard/${id}`, sp);
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
  // (Se conserva la condición original: `d.estatus` es el de la LIQUIDACIÓN
  // —cuadrada / con_diferencias / revisar—, así que hoy esto no se pinta
  // nunca; queda anotado en el resumen de la rama para decidirlo aparte.)
  const puedeReabrir = puedeAdministrar(rol) && d.estatus === 'liquidado';

  /**
   * Reabre el viaje. NO BASTA CAMBIAR `viaje.estatus` — el trigger de la 0036
   * mira si EXISTE la fila de `liquidacion`, y mientras esté no entra ni un
   * gasto. Eso lo resuelve `reabrirViaje`; aquí solo se comprueba el permiso y
   * se exige la confirmación explícita, porque es destructivo.
   */
  async function reabrir(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await requireSessionTenant(`/dashboard/${id}`, sp);
    if (!puedeAdministrar(s.rol)) {
      return { error: 'Tu rol no puede reabrir un viaje liquidado. Pídeselo al dueño de la flota.' };
    }
    let t = s.tenantId;
    if (s.rol === 'superadmin' && sp?.tenant) {
      t = await resolverTenantPedido(supabaseAdmin(), t, sp.tenant);
    }

    try {
      const { pdfPerdido } = await reabrirViaje(t, d!.folio, fd.get('confirmar') === 'on', { id: s.userId });
      revalidatePath(`/dashboard/${id}`);
      return {
        ok: `${d!.folio} quedó abierto y vuelve a aceptar comprobantes.${pdfPerdido ? ' El PDF anterior ya no es válido.' : ''}`,
      };
    } catch (err) {
      return { error: mensajeParaPantalla(err, 'reabrir el viaje') };
    }
  }

  async function reasignar(formData: FormData) {
    'use server';
    // Repite la comprobación de permiso EN el server action: el `puedeAsignar`
    // de arriba solo decide si el <form> se pinta. Sin este segundo chequeo,
    // un contador que arme la petición a mano (misma sesión válida, sin el
    // botón) podría reasignar igual — el mismo criterio que ya usa
    // `requireSessionTenant` para no confiar solo en lo que el proxy filtra.
    const { tenantId: tDemo, rol: r } = await requireSessionTenant(`/dashboard/${id}`, sp);
    if (!puedeAsignar(r)) redirect(`/dashboard/${id}${sufijo}`);
    let t = tDemo;
    if (r === 'superadmin' && sp?.tenant) {
      t = await resolverTenantPedido(supabaseAdmin(), t, sp.tenant);
    }
    const operadorId = String(formData.get('operadorId') ?? '');
    if (!operadorId) redirect(`/dashboard/${id}${sufijo}`);
    await reasignarOperador(t, d!.viajeId, operadorId);
    redirect(`/dashboard/${id}${sufijo}`);
  }

  const operadores = puedeAsignar(rol) ? await listOperadores(tenantId) : [];

  return (
    <DetalleLiquidacion
      d={d}
      sufijo={sufijo}
      estatus={{ label: e.label, estado: estadoDeColor(e.color) }}
      etiqueta={etiquetaGasto}
      pdfHref={d.pdfPath && puedeExportar(rol) ? `/api/export/pdf/${d.id}` : null}
      wa={hrefWhatsApp(d.viaje.operadorTelefono)}
      reasignar={puedeReasignar && operadores.length > 0
        ? { operadores: operadores.map((o) => ({ id: o.id, nombre: o.nombre })), actual: d.operadorId, accion: reasignar }
        : null}
      reabrir={puedeReabrir ? reabrir : null}
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
function etiquetaGasto(g: { concepto: string; ocrExtra?: Record<string, unknown> }): string {
  const delMotor = etiquetaConcepto(g.concepto, g.ocrExtra);
  return delMotor === g.concepto ? (CONCEPTO[g.concepto] ?? g.concepto) : delMotor;
}
