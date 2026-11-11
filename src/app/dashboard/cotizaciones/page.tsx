import { getT } from '@/lib/i18n/servidor';
import { datosParaProveedor } from '@/lib/i18n/servidor';
import { IdiomaProvider } from '@/lib/i18n/proveedor';
import { trEs, type Tr } from '@/lib/i18n/dinero_tr';
import {
  Aviso, BotonEnlace, CamposSistema, CampoFecha, CampoSelect, CampoTexto, Disclosure, EstadoError, EstadoVacio, Fieldset, FormaConAviso, Icono, StatusChip, TablaBase,
  type AccionDeForma, type ColumnaBase, type ResultadoAccion, type TonoEstado,
} from '@/app/ui-v2/componentes';
import { EsqueletoTablaMaestra, CajonVistaRapida } from '@/app/ui-v2/esqueletos';
import type { PropsCifra } from '@/app/ui-v2/graficas';
import { CajonAlta } from '../clientes/forma';
import { sufijoTenant } from '../sufijo';
import { urlRegistro } from '../paginar-registro';
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
  searchParams: Promise<{ tenant?: string; rol?: string; vista?: string; ver?: string; nuevo?: string }>;
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

  const sufijo = sufijoTenant(sp);
  const hrefNuevo = (que: 'cotizacion' | 'costos') => urlRegistro(RUTA, sufijo, { nuevo: que });
  const hrefSinNuevo = urlRegistro(RUTA, sufijo, { nuevo: null });
  const hrefVer = (id: string) => urlRegistro(RUTA, sufijo, { ver: id });
  const hrefSinVer = urlRegistro(RUTA, sufijo, { ver: null });
  const cot = panel?.cotizaciones ?? [];
  const elegida = sp.ver ? cot.find((q) => q.id === sp.ver) : undefined;

  // Cifras solo de lo que se puede afirmar: la ganancia exige precio Y costo completo (`gananciaReal` devuelve null si falta uno).
  const ganancias = cot.map((q) => gananciaReal(q.precio, q.costoEstimado));
  const dejan = ganancias.filter((g) => g !== null && g.pesos >= 0).length;
  const pierden = ganancias.filter((g) => g !== null && g.pesos < 0).length;
  const sinCalcular = ganancias.filter((g) => g === null).length;
  const cifras: PropsCifra[] | undefined = panel && cot.length > 0 ? [
    { etiqueta: tr('cotizaciones.page.k.total'), valor: cot.length, formato: 'entero', nota: tr('cotizaciones.page.k.total.nota') },
    { etiqueta: tr('cotizaciones.page.k.vivas'), valor: cot.filter((q) => q.estado === 'borrador' || q.estado === 'enviada').length, formato: 'entero', nota: tr('cotizaciones.page.k.vivas.nota') },
    { etiqueta: tr('cotizaciones.page.k.dejan'), valor: dejan, formato: 'entero', nota: sinCalcular > 0 ? tr('cotizaciones.page.k.sincalcular', { n: numero(sinCalcular) }) : tr('cotizaciones.page.k.dejan.nota') },
    { etiqueta: tr('cotizaciones.page.k.pierden'), valor: pierden, formato: 'entero', nota: tr('cotizaciones.page.k.pierden.nota'), ...(pierden > 0 ? { tono: 'bad' as const } : {}) },
  ] : undefined;

  const columnas: ColumnaBase<CotizacionRow>[] = [
    {
      id: 'ruta', titulo: tr('cotizaciones.page.col.ruta'), principal: true,
      celda: (q) => (
        <>
          <strong>{q.origen} → {q.destino}</strong>
          <span className="rv-cot__tenue">{q.clienteNombre ?? tr('cotizaciones.page.sinCliente')}{q.folio ? ` · ${q.folio}` : ''}{q.km !== null ? ` · ${numero(q.km)} ${tr('cotizaciones.page.km')}` : ''}</span>
        </>
      ),
    },
    { id: 'costo', titulo: tr('cotizaciones.page.col.costo'), alinear: 'der', celda: (q) => (q.costoEstimado !== null ? mxn(q.costoEstimado) : <span className="rv-cot__tenue">{tr('cotizaciones.page.incompleto')}</span>) },
    { id: 'precio', titulo: tr('cotizaciones.page.col.precio'), alinear: 'der', celda: (q) => (q.precio !== null ? mxn(q.precio) : <span className="rv-cot__tenue">{tr('cotizaciones.page.aMediasSinPrecio')}</span>) },
    {
      id: 'ganancia', titulo: tr('cotizaciones.page.col.ganancia'), alinear: 'der',
      // `null` = todavía no se puede afirmar; nunca «$0.00», que se leería como un viaje que sale a mano.
      celda: (q) => {
        const g = gananciaReal(q.precio, q.costoEstimado);
        if (g === null) return <span className="rv-cot__tenue">{q.precio === null ? tr('cotizaciones.page.faltaElPrecio') : tr('cotizaciones.page.faltaUnDatoDel')}</span>;
        return (
          <>
            {mxn(g.pesos)}
            <StatusChip tono={g.pesos < 0 ? 'bad' : 'ok'}>{g.pesos < 0 ? tr('cotizaciones.page.pierdeDinero') : tr('cotizaciones.page.dejaGanancia')}</StatusChip>
          </>
        );
      },
    },
    { id: 'estado', titulo: tr('cotizaciones.page.col.estado'), celda: (q) => <StatusChip tono={TONO_ESTADO[q.estado] ?? 'neutral'}>{q.estado}</StatusChip> },
    {
      id: 'acciones', titulo: tr('cotizaciones.page.col.acciones'), alinear: 'der',
      celda: (q) => (
        <span className="rv-cot__acciones-fila">
          {(q.estado === 'borrador' || q.estado === 'enviada') && (
            <FilaAccionesCotizacion
              id={q.id} puedeEnviar={q.estado === 'borrador'} puedeCrearViaje={puedeAsignar(rol)} precio={q.precio}
              enviada={accionEnviada} convertir={accionConvertir} perdida={accionPerdida}
            />
          )}
          <BotonEnlace href={hrefVer(q.id)} variante="ghost" tamano="sm">{tr('cotizaciones.page.vistaRapida')}</BotonEnlace>
        </span>
      ),
    },
  ];

  const idiomaDatos = await datosParaProveedor(['shell', 'dinero']);
  return (
    <IdiomaProvider idioma={idiomaDatos.idioma} diccionarios={idiomaDatos.diccionarios}>
    <EsqueletoTablaMaestra
      titulo={tr('cotizaciones.page.margenYCostos')}
      apoyo={tr('cotizaciones.page.laGananciaRealDel')}
      acciones={panel ? (
        <>
          <BotonEnlace href={hrefNuevo('costos')} variante="secondary" tamano="sm">{tr('cotizaciones.page.costosDeclaradosDeLa')}</BotonEnlace>
          <BotonEnlace href={hrefNuevo('cotizacion')} variante="primary" tamano="sm">{tr('cotizaciones.page.nuevaCotizacion')}</BotonEnlace>
        </>
      ) : undefined}
      avisos={panel && costosSinDeclarar > 0 ? (
        <Aviso tono="warn" acciones={<BotonEnlace href={hrefNuevo('costos')} variante="secondary" tamano="sm">{tr('cotizaciones.page.costosDeLaFlota')}</BotonEnlace>}>
          {tr('cotizaciones.page.sinDeclarar', { costosSinDeclarar })}. {tr('cotizaciones.page.loQueTuDeclaras')}
        </Aviso>
      ) : undefined}
      cifras={cifras}
      etiquetaCifras={tr('cotizaciones.page.cotizaciones')}
      pie={panel && cot.length > 0 ? tr('cotizaciones.page.pie', { n: numero(cot.length) }) : undefined}
    >
      {!panel ? (
        <EstadoError reintentar>{tr('cotizaciones.page.noSePudoLeer')}</EstadoError>
      ) : (
        <TablaCotizaciones
          columnas={columnas} filas={cot} etiqueta={tr('cotizaciones.page.cotizaciones')}
          vacio={{ titulo: tr('cotizaciones.page.sinCotizaciones'), texto: tr('cotizaciones.page.laPrimeraSeArma') }}
          puedeCrearViaje={puedeAsignar(rol)} enviada={accionEnviada} perdida={accionPerdida} convertir={accionConvertir}
        />
      )}

      {panel && elegida && (() => {
        const g = gananciaReal(elegida.precio, elegida.costoEstimado);
        return (
          <CajonVistaRapida
            titulo={`${elegida.origen} → ${elegida.destino}`}
            subtitulo={`${elegida.clienteNombre ?? tr('cotizaciones.page.sinCliente')}${elegida.folio ? ` · ${elegida.folio}` : ''}`}
            hrefCerrar={hrefSinVer}
            cifras={[
              { etiqueta: tr('cotizaciones.page.col.costo'), valor: elegida.costoEstimado !== null ? mxn(elegida.costoEstimado) : '—' },
              { etiqueta: tr('cotizaciones.page.col.precio'), valor: elegida.precio !== null ? mxn(elegida.precio) : '—' },
              { etiqueta: tr('cotizaciones.page.col.ganancia'), valor: g === null ? '—' : mxn(g.pesos) },
              { etiqueta: tr('cotizaciones.page.col.margen'), valor: g === null || g.margenPct === null ? '—' : porcentaje(g.margenPct) },
            ]}
          >
            <DetalleCotizacion tr={tr} q={elegida} />
          </CajonVistaRapida>
        );
      })()}

      {panel && sp.nuevo === 'costos' && (
        <CajonAlta titulo={tr('cotizaciones.page.costosDeclaradosDeLa')} hrefCerrar={hrefSinNuevo}>
          <p className="rv-cot__nota">{tr('cotizaciones.page.loQueTuDeclaras')}</p>
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
        </CajonAlta>
      )}

      {panel && sp.nuevo === 'cotizacion' && (
        <CajonAlta titulo={tr('cotizaciones.page.nuevaCotizacion')} hrefCerrar={hrefSinNuevo} ancho="xl">
          <p className="rv-cot__nota">{tr('cotizaciones.page.siEstaRutaTiene')}</p>
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
        </CajonAlta>
      )}
    </EsqueletoTablaMaestra>
    </IdiomaProvider>
  );
}

/** La tabla de cotizaciones. Es un componente (y no un `TablaBase` suelto en la página) para que las tres acciones de servidor sigan viajando
 *  como props visibles de un elemento: la prueba de la puerta de «Crear viaje» las lee de aquí. */
function TablaCotizaciones({ columnas, filas, etiqueta, vacio }: {
  columnas: readonly ColumnaBase<CotizacionRow>[];
  filas: readonly CotizacionRow[];
  etiqueta: string;
  vacio: { titulo: string; texto: string };
  puedeCrearViaje: boolean;
  enviada: AccionDeForma;
  perdida: AccionDeForma;
  convertir: AccionDeForma;
}) {
  return <TablaBase<CotizacionRow> etiqueta={etiqueta} columnas={columnas} filas={filas} idFila={(q) => q.id} vacio={vacio} tarjetaMovil />;
}

const TONO_ESTADO: Record<string, TonoEstado> = {
  borrador: 'neutral', enviada: 'info', aceptada: 'ok', convertida: 'ok', perdida: 'bad', vencida: 'warn',
};

function DetalleCotizacion({ q, tr = trEs }: { q: CotizacionRow; tr?: Tr }) {
  return (
    <div className="rv-cot__detalle">
      {q.desglose && (
        <>
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
        </>
      )}

      <div className="rv-cot__pie">
        <span>{tr('cotizaciones.page.creada', { v: fechaHoraMx(q.creadaEn) })}</span>
        {q.vigenteHasta && <span>{tr('cotizaciones.page.vigenteHasta2', { v: fechaMx(q.vigenteHasta) })}</span>}
        {q.viajeId && <span>{tr('cotizaciones.page.viajeCreado')}</span>}
      </div>
    </div>
  );
}
