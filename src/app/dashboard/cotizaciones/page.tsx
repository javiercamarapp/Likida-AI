import { getT } from '@/lib/i18n/servidor';
import { datosParaProveedor } from '@/lib/i18n/servidor';
import { IdiomaProvider } from '@/lib/i18n/proveedor';
import { trEs, type Tr } from '@/lib/i18n/dinero_tr';
import {
  CamposSistema, CampoFecha, CampoSelect, CampoTexto, Disclosure, EstadoError, EstadoVacio, Fieldset, FormaConAviso, Icono, MarcoPagina, StatusChip, Tarjeta,
  type AccionDeForma, type ResultadoAccion, type TonoEstado,
} from '@/app/ui-v2/componentes';
import './cotizaciones.css';
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
import { FilaAccionesCotizacion } from './acciones';
import type { Metadata } from 'next';
export async function generateMetadata(): Promise<Metadata> {
  const { t: tr } = await getT('dinero');
  return { title: tr('meta.cotizaciones') };
}

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
  const { t: tr } = await getT('dinero');
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
    const { t: tr } = await getT('dinero');
    const s = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
    if (!puedeVerRuta(s.rol, RUTA)) return { error: tr('cotizaciones.page.tuRolNoPuede') };
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
    return { ok: tr('cotizaciones.page.costosDeclaradosLasCotizacio') };
  }

  async function cotizar(_p: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
    if (!puedeVerRuta(s.rol, RUTA)) return { error: tr('cotizaciones.page.tuRolNoPuede2') };
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
    return { ok: tr('cotizaciones.page.cotizacionCreadaConSu') };
  }

  // FE-13b: las tres eran `(fd) => Promise<void>` — sin `useActionState` no
  // hay estado `pending` (doble clic manda dos veces) y el `catch` se tragaba
  // el error en el log; el humano solo veía la fila SIN cambiar tras el
  // `revalidatePath` y no sabía si su clic hizo algo. Ahora todas devuelven
  // `ResultadoAccion`, como el resto de las forms del panel.
  async function accionEnviada(_prev: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
    if (!puedeVerRuta(s.rol, RUTA)) return { error: tr('cotizaciones.page.tuRolNoPuede3') };
    try {
      await marcarEnviada(s.tenantId, String(fd.get('id') ?? ''));
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'marcar la cotización como enviada') };
    }
    revalidatePath(RUTA);
    return { ok: tr('cotizaciones.page.marcadaComoEnviada') };
  }

  async function accionPerdida(_prev: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
    if (!puedeVerRuta(s.rol, RUTA)) return { error: tr('cotizaciones.page.tuRolNoPuede3') };
    const como = String(fd.get('como')) === 'vencida' ? 'vencida' : 'perdida';
    try {
      await marcarPerdida(s.tenantId, String(fd.get('id') ?? ''), como, s.userId ?? null);
    } catch (e) {
      return { error: mensajeParaPantalla(e, como === 'vencida' ? 'marcar como vencida' : 'marcar como perdida') };
    }
    revalidatePath(RUTA);
    return { ok: como === 'vencida' ? tr('cotizaciones.page.marcadaVencida') : tr('cotizaciones.page.marcadaPerdida') };
  }

  async function accionConvertir(_prev: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
    // A37-S17-10: crear un viaje es una escritura OPERATIVA (aparece en «viajes
    // sin asignar» del tráfico): lleva el mismo permiso que despachar, no solo el
    // área dinero con la que se ve el cotizador.
    if (!puedeVerRuta(s.rol, RUTA) || !puedeAsignar(s.rol)) return { error: tr('cotizaciones.page.tuRolNoPuede4') };
    try {
      await convertirEnViaje(s.tenantId, String(fd.get('id') ?? ''), s.userId ?? null);
    } catch (e) {
      // El motivo honesto (sin precio, ya decidida…) ahora también llega a
      // pantalla, no solo al log.
      return { error: mensajeParaPantalla(e, 'crear el viaje desde esta cotización') };
    }
    revalidatePath(RUTA);
    return { ok: tr('cotizaciones.page.viajeCreadoDesdeEsta') };
  }

  const c = panel?.config;
  const vInicial = (x: number | null | undefined): string => (x === null || x === undefined ? '' : String(x));
  const costosSinDeclarar = c ? [c.dieselPorKm, c.fijosPorKm, c.salarioDia, c.viaticosDia, c.factorRegresoVacio, c.margenObjetivoPct].filter((x) => x === null || x === undefined).length : 6;
  const opcionesCliente = [
    { valor: '', texto: tr('cotizaciones.page.sinClienteProspecto') },
    ...(panel?.clientes ?? []).map((x) => ({ valor: x.id, texto: x.nombre })),
  ];

  const idiomaDatos = await datosParaProveedor(['shell', 'dinero']);
  return (
    <IdiomaProvider idioma={idiomaDatos.idioma} diccionarios={idiomaDatos.diccionarios}>
    <MarcoPagina titulo={tr('cotizaciones.page.margenYCostos')} apoyo={tr('cotizaciones.page.laGananciaRealDel')}>
      {!panel && (
        <EstadoError reintentar>{tr('cotizaciones.page.noSePudoLeer')}</EstadoError>
      )}

      {panel && (
        <>
          <Tarjeta titulo={tr('cotizaciones.page.costosDeclaradosDeLa')} info="cotizaciones.costos">
            <Disclosure titulo={tr('cotizaciones.page.costosDeLaFlota')} resumen={costosSinDeclarar === 0 ? tr('cotizaciones.page.completos') : tr('cotizaciones.page.sinDeclarar', { costosSinDeclarar })} abierto={costosSinDeclarar > 0}>
              <p className="rv-cot__nota">
                {tr('cotizaciones.page.loQueTuDeclaras')}
              </p>
              <FormaConAviso accion={guardarConfig} boton="Guardar costos" columnas="md:grid-cols-1">
                <Fieldset leyenda={tr('cotizaciones.page.porKilometro')}>
                  <div className="rv-forma__rejilla">
                    <CampoTexto id="dieselPorKm" name="dieselPorKm" etiqueta={tr('cotizaciones.page.dieselKm')} defaultValue={vInicial(c?.dieselPorKm)} ayuda={tr('cotizaciones.page.combustiblePorKmComo')} />
                    <CampoTexto id="fijosPorKm" name="fijosPorKm" etiqueta={tr('cotizaciones.page.fijosKm')} defaultValue={vInicial(c?.fijosPorKm)} ayuda={tr('cotizaciones.page.segurosAdminDepreciacionPror')} />
                  </div>
                </Fieldset>
                <Fieldset leyenda={tr('cotizaciones.page.operador')}>
                  <div className="rv-forma__rejilla">
                    <CampoTexto id="salarioDia" name="salarioDia" etiqueta={tr('cotizaciones.page.salarioOperadorDia')} defaultValue={vInicial(c?.salarioDia)} />
                    <CampoTexto id="viaticosDia" name="viaticosDia" etiqueta={tr('cotizaciones.page.viaticosDia')} defaultValue={vInicial(c?.viaticosDia)} ayuda={tr('cotizaciones.page.siNoPagasViaticos')} />
                  </div>
                </Fieldset>
                <Fieldset leyenda={tr('cotizaciones.page.regresoYMarkup')}>
                  <div className="rv-forma__rejilla">
                    <CampoTexto id="factorRegresoVacio" name="factorRegresoVacio" etiqueta={tr('cotizaciones.page.factorDeRegreso1')} defaultValue={vInicial(c?.factorRegresoVacio)} ayuda={tr('cotizaciones.page.1RegresoCargado2')} />
                    <CampoTexto id="margenObjetivoPct" name="margenObjetivoPct" etiqueta={tr('cotizaciones.page.markupObjetivoSobreEl')} defaultValue={vInicial(c?.margenObjetivoPct)} ayuda={tr('cotizaciones.page.precioSugeridoCosto1')} />
                  </div>
                </Fieldset>
              </FormaConAviso>
            </Disclosure>
          </Tarjeta>

          <Tarjeta titulo={tr('cotizaciones.page.nuevaCotizacion')} info="cotizaciones.nueva">
            <p className="rv-cot__nota">
              {tr('cotizaciones.page.siEstaRutaTiene')}
            </p>
            <FormaConAviso accion={cotizar} boton="Cotizar" columnas="md:grid-cols-1">
              <Fieldset leyenda={tr('cotizaciones.page.ruta')}>
                <div className="rv-forma__rejilla">
                  <CampoSelect id="clienteId" name="clienteId" etiqueta={tr('cotizaciones.page.cliente')} defaultValue="">
                    {opcionesCliente.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
                  </CampoSelect>
                  <CampoTexto id="origen" name="origen" etiqueta={tr('cotizaciones.page.origen')} obligatorio />
                  <CampoTexto id="destino" name="destino" etiqueta={tr('cotizaciones.page.destino')} obligatorio />
                  <CampoTexto id="km" name="km" etiqueta={tr('cotizaciones.page.kmDeLaRuta')} ayuda={tr('cotizaciones.page.deIdaElFactor')} />
                  <CampoTexto id="dias" name="dias" etiqueta={tr('cotizaciones.page.diasDeViaje')} ayuda={tr('cotizaciones.page.losDeclaraQuienCotiza')} />
                </div>
              </Fieldset>
              <Fieldset leyenda={tr('cotizaciones.page.precioYVigencia')}>
                <div className="rv-forma__rejilla">
                  <CampoTexto id="casetasManual" name="casetasManual" etiqueta={tr('cotizaciones.page.casetasSiNoHay')} />
                  <CampoTexto id="precio" name="precio" etiqueta={tr('cotizaciones.page.precioACotizar')} ayuda={tr('cotizaciones.page.tuDecisionElSugerido')} />
                  <CampoTexto id="folio" name="folio" etiqueta={tr('cotizaciones.page.folio')} />
                  <CampoFecha id="vigenteHasta" name="vigenteHasta" etiqueta={tr('cotizaciones.page.vigenteHasta')} />
                </div>
              </Fieldset>
            </FormaConAviso>
          </Tarjeta>

          <Tarjeta titulo={`Cotizaciones (${panel.cotizaciones.length})`} info="cotizaciones.lista">
            {panel.cotizaciones.length === 0 && (
              <EstadoVacio titulo={tr('cotizaciones.page.sinCotizaciones')} contenido>
                {tr('cotizaciones.page.laPrimeraSeArma')}
              </EstadoVacio>
            )}
            <ul className="rv-cot__lista">
              {panel.cotizaciones.map((q) => <Fila tr={tr} key={q.id} q={q} puedeCrearViaje={puedeAsignar(rol)} enviada={accionEnviada} perdida={accionPerdida} convertir={accionConvertir} />)}
            </ul>
          </Tarjeta>
        </>
      )}
    </MarcoPagina>
    </IdiomaProvider>
  );
}

const TONO_ESTADO: Record<string, TonoEstado> = {
  borrador: 'neutral', enviada: 'info', aceptada: 'ok', convertida: 'ok', perdida: 'bad', vencida: 'warn',
};

function Fila({
  q, puedeCrearViaje, enviada, perdida, convertir, tr = trEs,
}: {
  q: CotizacionRow;
  enviada: AccionDeForma;
  perdida: AccionDeForma;
  convertir: AccionDeForma;
  puedeCrearViaje: boolean; tr?: Tr;
}) {
  const viva = q.estado === 'borrador' || q.estado === 'enviada';
  // EL NÚMERO QUE EL TÍTULO DE ESTA PANTALLA PROMETE. `null` = todavía no se
  // puede afirmar (falta el precio o falta un renglón del costo), y entonces
  // se dice eso — nunca "$0.00", que se leería como un viaje que sale a mano.
  const g = gananciaReal(q.precio, q.costoEstimado);
  return (
    <li className="rv-cot__fila">
      <div className="rv-cot__cabeza">
        <div className="rv-cot__ruta">
          <strong>{q.origen} → {q.destino}</strong>
          {q.folio && <span className="rv-cot__tenue">({q.folio})</span>}
          <span className="rv-cot__tenue">{q.clienteNombre ?? tr('cotizaciones.page.sinCliente')}</span>
          {q.km !== null && <span className="rv-cot__tenue">{numero(q.km)} {tr('cotizaciones.page.km')}</span>}
        </div>
        <div className="rv-cot__cifras">
          <span>{tr('cotizaciones.page.costoDosPuntos')} {q.costoEstimado !== null ? mxn(q.costoEstimado) : tr('cotizaciones.page.incompleto')}</span>
          <strong>{tr('cotizaciones.page.precioDosPuntos')} {q.precio !== null ? mxn(q.precio) : tr('cotizaciones.page.aMediasSinPrecio')}</strong>
          <strong>
            {tr('cotizaciones.page.gananciaDosPuntos')}{' '}
            {g === null ? (
              <span className="rv-cot__tenue">
                {q.precio === null ? tr('cotizaciones.page.faltaElPrecio') : tr('cotizaciones.page.faltaUnDatoDel')}
              </span>
            ) : (
              <>
                {mxn(g.pesos)}
                {g.margenPct !== null && (
                  <span className="rv-cot__tenue"> {tr('cotizaciones.page.delPrecio', { v: porcentaje(g.margenPct) })}</span>
                )}
                <StatusChip tono={g.pesos < 0 ? 'bad' : 'ok'}>{g.pesos < 0 ? tr('cotizaciones.page.pierdeDinero') : tr('cotizaciones.page.dejaGanancia')}</StatusChip>
              </>
            )}
          </strong>
          <StatusChip tono={TONO_ESTADO[q.estado] ?? 'neutral'}>{q.estado}</StatusChip>
        </div>
      </div>

      {q.desglose && (
        <Disclosure variante="linea" titulo={tr('cotizaciones.page.desgloseCitableComoSe')}>
          <ul className="rv-cot__desglose">
            {q.desglose.lineas.map((l, i) => (
              <li key={i}>
                <span>{l.concepto} <span className="rv-cot__tenue">— {l.supuesto}</span></span>
                <span className="rv-cot__monto">{l.monto !== null ? mxn(l.monto) : '—'}</span>
              </li>
            ))}
          </ul>
          <CamposSistema etiqueta={tr('cotizaciones.page.totalesDelDesglose')} campos={[
            { etiqueta: 'Costo total', valor: q.desglose.costoTotal !== null ? mxn(q.desglose.costoTotal) : 'incompleto' },
            { etiqueta: tr('cotizaciones.page.precioSugerido'), valor: q.desglose.precioSugerido !== null ? mxn(q.desglose.precioSugerido) : tr('cotizaciones.page.sinSugerencia') },
          ]} />
          {q.tarifaCatalogo && (
            <p className="rv-cot__nota">
              {tr('cotizaciones.page.tarifaDelCatalogo')} {q.tarifaCatalogo.monto !== null ? mxn(q.tarifaCatalogo.monto) : tr('cotizaciones.page.sinMontoFaltaUn')}
              {' '}— {q.tarifaCatalogo.porque}
              {q.tarifaCatalogo.ambigua && (
                <span className="rv-cot__aviso">
                  {' · '}<Icono icono={TriangleAlert} tam={14} />
                  {tr('cotizaciones.page.elCatalogoTieneDos')}
                </span>
              )}
            </p>
          )}
          {q.desglose.faltantes.length > 0 && (
            <p className="rv-cot__nota" data-tono="warn">{tr('cotizaciones.page.faltaDosPuntos')} {q.desglose.faltantes.join(' · ')}</p>
          )}
          {q.desglose.notas.map((nota, i) => (
            <p key={i} className="rv-cot__nota">{nota}</p>
          ))}
        </Disclosure>
      )}

      <div className="rv-cot__pie">
        <span>{tr('cotizaciones.page.creada', { v: fechaHoraMx(q.creadaEn) })}</span>
        {q.vigenteHasta && <span>{tr('cotizaciones.page.vigenteHasta2', { v: fechaMx(q.vigenteHasta) })}</span>}
        {q.viajeId && <span>{tr('cotizaciones.page.viajeCreado')}</span>}
        {viva && (
          <span className="rv-cot__acciones">
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
