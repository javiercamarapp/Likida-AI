import { CamposSistema, CampoFecha, CampoSelect, CampoTexto, Disclosure, EstadoError, Fieldset, MarcoPagina, TituloRecuadro } from '@/app/ui-v2/componentes';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { TriangleAlert } from 'lucide-react';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { resolverTenantAtadoOLanza } from '@/lib/auth/tenant-atado';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeAsignar } from '@/lib/auth/permisos';
import { logger } from '@/lib/logger';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { parsearImporteMx, mxn, porcentaje, fechaHoraMx, fechaMx, numero } from '@/lib/formato';
import { gananciaReal } from '@/lib/likida/cotizador/motor';
import {
  getPanelCotizador, guardarConfigCotizador, crearCotizacion, marcarEnviada, marcarPerdida,
  convertirEnViaje, type PanelCotizador, type CotizacionRow,
} from '@/lib/likida/cotizador/lector';
import { FormaConAviso, type ResultadoAccion, type AccionDeForma } from '../../admin/ui/forma';
import { FilaAccionesCotizacion } from './acciones';
import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Cotizador' };

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/cotizaciones';

/**
 * EL COTIZADOR DE GANANCIA REAL (0225, A8 del plan; decisión de Javier del
 * 27-ago-2026) — la etapa 1 del ciclo: saber si el viaje deja dinero ANTES
 * de aceptarlo.
 *
 * ── LA PUERTA ─────────────────────────────────────────────────────────────
 * Área `dinero` (`puedeVerRuta`), espejo de la RLS `ve_finanzas()` que la
 * 0051 le puso a `cotizacion`: aquí viven costos y márgenes. Todo corre con
 * `supabaseAdmin()`, así que ESTA es la puerta — y cada server action la
 * re-resuelve adentro, no confía en que la página ya la pasó.
 *
 * ── LO QUE ESTA PANTALLA NO HACE ──────────────────────────────────────────
 * No inventa precio: el sugerido sale de costos DECLARADOS y trae cada
 * supuesto en la línea (el que falta, se dice). No convierte sola: la
 * cotización se vuelve viaje con un clic HUMANO, y el doble clic lo
 * resuelve la base (claim en `decidida_en`, 0225).
 */
export default async function PaginaCotizaciones({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; rol?: string; vista?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  let panel: PanelCotizador | null = null;
  try {
    panel = await getPanelCotizador(tenantId);
  } catch (e) {
    logger.warn('cotizador.no_leido', { tenantId, err: e instanceof Error ? e.message : String(e) });
  }

  // '' = no declarado (null). Number('') sería 0, y un costo de $0 inventado
  // es exactamente la cotización que pierde dinero con cara de ganancia.
  const perilla = (v: FormDataEntryValue | null): number | null => {
    const s = String(v ?? '').trim();
    return s === '' ? null : parsearImporteMx(s);
  };

  async function guardarConfig(_p: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
    if (!puedeVerRuta(s.rol, RUTA)) return { error: 'Tu rol no puede declarar costos.' };
    try {
      await guardarConfigCotizador(s.tenantId, {
        dieselPorKm: perilla(fd.get('dieselPorKm')),
        salarioDia: perilla(fd.get('salarioDia')),
        viaticosDia: perilla(fd.get('viaticosDia')),
        fijosPorKm: perilla(fd.get('fijosPorKm')),
        factorRegresoVacio: perilla(fd.get('factorRegresoVacio')),
        margenObjetivoPct: perilla(fd.get('margenObjetivoPct')),
      }, s.userId ?? null);
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'guardar los costos declarados') };
    }
    revalidatePath(RUTA);
    return { ok: 'Costos declarados. Las cotizaciones NUEVAS ya se arman con ellos (las viejas conservan su desglose).' };
  }

  async function cotizar(_p: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
    if (!puedeVerRuta(s.rol, RUTA)) return { error: 'Tu rol no puede cotizar.' };
    try {
      await crearCotizacion(s.tenantId, {
        clienteId: String(fd.get('clienteId') ?? '') || null,
        origen: String(fd.get('origen') ?? ''),
        destino: String(fd.get('destino') ?? ''),
        km: perilla(fd.get('km')),
        dias: perilla(fd.get('dias')),
        casetasManual: perilla(fd.get('casetasManual')),
        precio: perilla(fd.get('precio')),
        folio: String(fd.get('folio') ?? '') || null,
        vigenteHasta: String(fd.get('vigenteHasta') ?? '') || null,
      }, s.userId ?? null);
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'crear la cotización') };
    }
    revalidatePath(RUTA);
    return { ok: 'Cotización creada con su desglose citable. Revísala abajo.' };
  }

  // FE-13b: las tres eran `(fd) => Promise<void>` — sin `useActionState` no
  // hay estado `pending` (doble clic manda dos veces) y el `catch` se tragaba
  // el error en el log; el humano solo veía la fila SIN cambiar tras el
  // `revalidatePath` y no sabía si su clic hizo algo. Ahora todas devuelven
  // `ResultadoAccion`, como el resto de las forms del panel.
  async function accionEnviada(_prev: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
    if (!puedeVerRuta(s.rol, RUTA)) return { error: 'Tu rol no puede editar cotizaciones.' };
    try {
      await marcarEnviada(s.tenantId, String(fd.get('id') ?? ''));
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'marcar la cotización como enviada') };
    }
    revalidatePath(RUTA);
    return { ok: 'Marcada como enviada.' };
  }

  async function accionPerdida(_prev: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
    if (!puedeVerRuta(s.rol, RUTA)) return { error: 'Tu rol no puede editar cotizaciones.' };
    const como = String(fd.get('como')) === 'vencida' ? 'vencida' : 'perdida';
    try {
      await marcarPerdida(s.tenantId, String(fd.get('id') ?? ''), como, s.userId ?? null);
    } catch (e) {
      return { error: mensajeParaPantalla(e, como === 'vencida' ? 'marcar como vencida' : 'marcar como perdida') };
    }
    revalidatePath(RUTA);
    return { ok: como === 'vencida' ? 'Marcada como vencida.' : 'Marcada como perdida.' };
  }

  async function accionConvertir(_prev: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const s = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
    // A37-S17-10: crear un viaje es una escritura OPERATIVA (aparece en «viajes
    // sin asignar» del tráfico): lleva el mismo permiso que despachar, no solo el
    // área dinero con la que se ve el cotizador.
    if (!puedeVerRuta(s.rol, RUTA) || !puedeAsignar(s.rol)) return { error: 'Tu rol no puede crear viajes desde aquí.' };
    try {
      await convertirEnViaje(s.tenantId, String(fd.get('id') ?? ''), s.userId ?? null);
    } catch (e) {
      // El motivo honesto (sin precio, ya decidida…) ahora también llega a
      // pantalla, no solo al log.
      return { error: mensajeParaPantalla(e, 'crear el viaje desde esta cotización') };
    }
    revalidatePath(RUTA);
    return { ok: 'Viaje creado desde esta cotización.' };
  }

  const c = panel?.config;
  const vInicial = (x: number | null | undefined): string => (x === null || x === undefined ? '' : String(x));
  const costosSinDeclarar = c ? [c.dieselPorKm, c.fijosPorKm, c.salarioDia, c.viaticosDia, c.factorRegresoVacio, c.margenObjetivoPct].filter((x) => x === null || x === undefined).length : 6;
  const opcionesCliente = [
    { valor: '', texto: '— sin cliente (prospecto) —' },
    ...(panel?.clientes ?? []).map((x) => ({ valor: x.id, texto: x.nombre })),
  ];

  return (
<MarcoPagina titulo="Cotizador" apoyo="La ganancia real del viaje antes de aceptarlo: costos declarados, casetas medidas en tus viajes liquidados y cada supuesto a la vista.">
      {!panel && (
        <EstadoError>No se pudo leer el cotizador. No es que no haya cotizaciones: la lectura falló. Recarga; si sigue, es cosa nuestra.</EstadoError>
      )}

      {panel && (
        <>
          <section className="space-y-2">
            <TituloRecuadro info="cotizaciones.costos">Costos declarados de la flota</TituloRecuadro>
            <Disclosure titulo="Costos de la flota" resumen={costosSinDeclarar === 0 ? 'completos' : `${costosSinDeclarar} sin declarar`} abierto={costosSinDeclarar > 0}>
              <p className="mb-3 text-sm" style={{ color: 'var(--muted)' }}>
                Lo que TÚ declaras — nada se supone. Un campo vacío = sin declarar, y el
                cotizador entonces no sugiere precio: dice qué falta.
              </p>
              <FormaConAviso accion={guardarConfig} boton="Guardar costos" columnas="md:grid-cols-1">
                <Fieldset leyenda="Por kilómetro">
                  <div className="rv-forma__rejilla">
                    <CampoTexto id="dieselPorKm" name="dieselPorKm" etiqueta="Diésel ($/km)" defaultValue={vInicial(c?.dieselPorKm)} ayuda="combustible por km, como lo calcules" />
                    <CampoTexto id="fijosPorKm" name="fijosPorKm" etiqueta="Fijos ($/km)" defaultValue={vInicial(c?.fijosPorKm)} ayuda="seguros, admin, depreciación prorrateados" />
                  </div>
                </Fieldset>
                <Fieldset leyenda="Operador">
                  <div className="rv-forma__rejilla">
                    <CampoTexto id="salarioDia" name="salarioDia" etiqueta="Salario operador ($/día)" defaultValue={vInicial(c?.salarioDia)} />
                    <CampoTexto id="viaticosDia" name="viaticosDia" etiqueta="Viáticos ($/día)" defaultValue={vInicial(c?.viaticosDia)} ayuda="si no pagas viáticos, declara 0 — no lo dejes vacío" />
                  </div>
                </Fieldset>
                <Fieldset leyenda="Regreso y markup">
                  <div className="rv-forma__rejilla">
                    <CampoTexto id="factorRegresoVacio" name="factorRegresoVacio" etiqueta="Factor de regreso (1–3)" defaultValue={vInicial(c?.factorRegresoVacio)} ayuda="1 = regreso cargado; 2 = la ruta se cobra redonda" />
                    <CampoTexto id="margenObjetivoPct" name="margenObjetivoPct" etiqueta="Markup objetivo sobre el costo (%)" defaultValue={vInicial(c?.margenObjetivoPct)} ayuda="precio sugerido = costo × (1 + markup), 0–90; la ganancia de abajo se muestra como margen sobre el precio, por eso es menor" />
                  </div>
                </Fieldset>
              </FormaConAviso>
            </Disclosure>
          </section>

          <section className="rounded-lg border p-4">
            <TituloRecuadro info="cotizaciones.nueva" className="mb-1">Nueva cotización</TituloRecuadro>
            <p className="mb-3 text-sm" style={{ color: 'var(--muted)' }}>
              Si esta ruta tiene viajes liquidados, las casetas salen MEDIDAS de ahí (y la
              captura manual se ignora — la medición gana y el desglose lo dice).
            </p>
            <FormaConAviso accion={cotizar} boton="Cotizar" columnas="md:grid-cols-1">
              <Fieldset leyenda="Ruta">
                <div className="rv-forma__rejilla">
                  <CampoSelect id="clienteId" name="clienteId" etiqueta="Cliente" defaultValue="">
                    {opcionesCliente.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
                  </CampoSelect>
                  <CampoTexto id="origen" name="origen" etiqueta="Origen" obligatorio />
                  <CampoTexto id="destino" name="destino" etiqueta="Destino" obligatorio />
                  <CampoTexto id="km" name="km" etiqueta="Km de la ruta" ayuda="de ida; el factor de regreso hace el resto" />
                  <CampoTexto id="dias" name="dias" etiqueta="Días de viaje" ayuda="los declara quien cotiza; el desglose los cita" />
                </div>
              </Fieldset>
              <Fieldset leyenda="Precio y vigencia">
                <div className="rv-forma__rejilla">
                  <CampoTexto id="casetasManual" name="casetasManual" etiqueta="Casetas ($, si no hay medición)" />
                  <CampoTexto id="precio" name="precio" etiqueta="Precio a cotizar ($)" ayuda="tu decisión — el sugerido es referencia, no captura sola" />
                  <CampoTexto id="folio" name="folio" etiqueta="Folio" />
                  <CampoFecha id="vigenteHasta" name="vigenteHasta" etiqueta="Vigente hasta" />
                </div>
              </Fieldset>
            </FormaConAviso>
          </section>

          <section className="rounded-lg border p-4">
            <TituloRecuadro info="cotizaciones.lista" className="mb-3">
              Cotizaciones ({panel.cotizaciones.length})
            </TituloRecuadro>
            {panel.cotizaciones.length === 0 && (
              <p className="text-sm" style={{ color: 'var(--muted)' }}>
                Aún no hay cotizaciones. La primera se arma arriba — con los costos
                declarados y, si la ruta ya se corrió, con las casetas medidas.
              </p>
            )}
            <ul className="space-y-3">
              {panel.cotizaciones.map((q) => <Fila key={q.id} q={q} puedeCrearViaje={puedeAsignar(rol)} enviada={accionEnviada} perdida={accionPerdida} convertir={accionConvertir} />)}
            </ul>
          </section>
        </>
      )}
</MarcoPagina>
  );
}

function Fila({
  q, puedeCrearViaje, enviada, perdida, convertir,
}: {
  q: CotizacionRow;
  enviada: AccionDeForma;
  perdida: AccionDeForma;
  convertir: AccionDeForma;
  puedeCrearViaje: boolean;
}) {
  const viva = q.estado === 'borrador' || q.estado === 'enviada';
  // EL NÚMERO QUE EL TÍTULO DE ESTA PANTALLA PROMETE. `null` = todavía no se
  // puede afirmar (falta el precio o falta un renglón del costo), y entonces
  // se dice eso — nunca "$0.00", que se leería como un viaje que sale a mano.
  const g = gananciaReal(q.precio, q.costoEstimado);
  return (
    <li className="rounded-md border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm">
          <span className="font-medium">{q.origen} → {q.destino}</span>
          {q.folio && <span className="ml-2" style={{ color: 'var(--muted)' }}>({q.folio})</span>}
          <span className="ml-2" style={{ color: 'var(--muted)' }}>{q.clienteNombre ?? 'sin cliente'}</span>
          {q.km !== null && <span className="ml-2" style={{ color: 'var(--muted)' }}>{numero(q.km)} km</span>}
        </div>
        <div className="text-sm">
          <span className="mr-3">costo: {q.costoEstimado !== null ? mxn(q.costoEstimado) : 'incompleto'}</span>
          <span className="mr-3 font-medium">precio: {q.precio !== null ? mxn(q.precio) : 'a medias — sin precio'}</span>
          <span className="mr-3 font-medium">
            ganancia:{' '}
            {g === null ? (
              <span className="font-normal" style={{ color: 'var(--muted)' }}>
                {q.precio === null ? 'falta el precio' : 'falta un dato del costo'}
              </span>
            ) : (
              <span style={{ color: g.pesos < 0 ? 'var(--color-bad)' : 'var(--color-ok)' }}>
                {mxn(g.pesos)}
                {g.margenPct !== null && (
                  <span className="font-normal"> ({porcentaje(g.margenPct)} del precio)</span>
                )}
              </span>
            )}
          </span>
          <span
            className="rounded px-2 py-0.5 text-xs uppercase"
            style={{ background: 'var(--canvas)', color: 'var(--ink2)' }}
          >{q.estado}</span>
        </div>
      </div>

      {q.desglose && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer" style={{ color: 'var(--ink2)' }}>Desglose citable (como se armó)</summary>
          <ul className="mt-2 space-y-1">
            {q.desglose.lineas.map((l, i) => (
              <li key={i} className="flex justify-between gap-4">
                <span>{l.concepto} <span style={{ color: 'var(--muted)' }}>— {l.supuesto}</span></span>
                <span className="whitespace-nowrap">{l.monto !== null ? mxn(l.monto) : '—'}</span>
              </li>
            ))}
          </ul>
          <div className="mt-2">
            <CamposSistema etiqueta="Totales del desglose" campos={[
              { etiqueta: 'Costo total', valor: q.desglose.costoTotal !== null ? mxn(q.desglose.costoTotal) : 'incompleto' },
              { etiqueta: 'Precio sugerido', valor: q.desglose.precioSugerido !== null ? mxn(q.desglose.precioSugerido) : 'sin sugerencia' },
            ]} />
          </div>
          {q.tarifaCatalogo && (
            <p className="mt-2" style={{ color: 'var(--ink2)' }}>
              Tarifa del catálogo: {q.tarifaCatalogo.monto !== null ? mxn(q.tarifaCatalogo.monto) : 'sin monto (falta un dato de la tarifa)'}
              {' '}— {q.tarifaCatalogo.porque}
              {q.tarifaCatalogo.ambigua && (
                // El triángulo del sistema y no el emoji (la documentación interna §2.1: «sin emojis como iconos»).
                <span className="inline-flex items-center gap-1" style={{ color: 'var(--warn)' }}>
                  {' · '}<TriangleAlert aria-hidden width={12} height={12} strokeWidth={1.75} />
                  el catálogo tiene dos verdades para esta ruta
                </span>
              )}
            </p>
          )}
          {q.desglose.faltantes.length > 0 && (
            <p className="mt-2" style={{ color: 'var(--color-warn)' }}>Falta: {q.desglose.faltantes.join(' · ')}</p>
          )}
          {q.desglose.notas.map((nota, i) => (
            <p key={i} className="mt-1" style={{ color: 'var(--muted)' }}>{nota}</p>
          ))}
        </details>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--muted)' }}>
        <span>creada {fechaHoraMx(q.creadaEn)}</span>
        {q.vigenteHasta && <span>· vigente hasta {fechaMx(q.vigenteHasta)}</span>}
        {q.viajeId && <span>· viaje creado</span>}
        {viva && (
          <span className="ml-auto">
            <FilaAccionesCotizacion
              id={q.id} puedeEnviar={q.estado === 'borrador'} puedeCrearViaje={puedeCrearViaje} precio={q.precio}
              enviada={enviada} convertir={convertir} perdida={perdida}
            />
          </span>
        )}
      </div>
    </li>
  );
}
