import { getT } from '@/lib/i18n/servidor';
import { datosParaProveedor } from '@/lib/i18n/servidor';
import { IdiomaProvider } from '@/lib/i18n/proveedor';
import { type Tr } from '@/lib/i18n/dinero_tr';
import { rico } from '@/lib/i18n/rico';
import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { FileQuestion } from 'lucide-react';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { resolverTenantAtadoOLanza } from '@/lib/auth/tenant-atado';
import { puedeVerRuta, puedeVerArea } from '@/lib/auth/visibilidad';
import { mensajeParaPantalla } from '@/lib/likida/administracion';
import { estadoDescargaSat } from '@/lib/likida/sat_descarga';
import { leerDescargaSat, type VistaDescargaSat } from '@/lib/likida/sat_descarga/lectura';
import {
  leerBandeja, buscarGastosParaLigar, interpretarImporteBusqueda, esEstatusCfdi, paginaPedida,
  POR_PAGINA, PAGINA_MAX, ESTATUS_CFDI,
  type EstatusCfdi, type PaginaBandeja, type ResultadoBusquedaGastos,
} from '@/lib/likida/sat_descarga/bandeja';
import {
  ligarComprobante, ignorarComprobante, revertirResolucion,
} from '@/lib/likida/sat_descarga/resolucion';
import { numero } from '@/lib/formato';
import { sufijoTenant } from '../../sufijo';
import { FilaComprobante, type ResultadoFila } from './fila';
import { EnlacePagina, NavPaginas } from '../../paginador';
import { Aviso, AvisoCompacto, BarraPeriodo, Chip, EstadoVacio, Tarjeta } from '@/app/ui-v2/componentes';
import type { PropsCifra } from '@/app/ui-v2/graficas';
import { EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import '../descarga-sat.css';

/**
 * LA BANDEJA DE CONCILIACIÓN DEL SAT (0243) — donde el contralor decide.
 *
 * LO QUE ESTA PANTALLA TIENE QUE DECIR, EN ESTE ORDEN:
 *
 *  1. QUÉ HAY QUE HACER, POR ESTATUS. 'ambiguo' es «elige cuál de estos
 *     gastos», 'disponible' es «nadie reportó este gasto», 'casado' es la
 *     memoria de lo cerrado y 'ignorado' el archivo. Cuatro colas, cuatro
 *     trabajos: mezclarlas daría una lista sin acción común.
 *  2. CUÁNTOS HAY DE VERDAD, y si la lista llega hasta el final o no. Una
 *     lista truncada que no se declara truncada es una lista inventada.
 *  3. QUÉ FALTA PARA TENER DATOS, cuando no los hay. En producción esta tabla
 *     tiene CERO filas: la descarga no se ha activado. Una bandeja vacía que
 *     solo dice «no hay nada» hace creer que el buzón está limpio.
 *
 * `null` NUNCA se pinta como 0 y «no se pudo leer» nunca como «no hay».
 */

const t = (v: FormDataEntryValue | null): string => String(v ?? '').trim();

/** Los rótulos de cada cola, y lo que se hace en ella. El rótulo es una
 *  promesa: si dice «esperan que tú decidas», tiene que haber dónde decidir. */
const colas = (tr: Tr): Record<EstatusCfdi, { titulo: string; explica: string; vacio: string }> => ({
  ambiguo: {
    titulo: tr('descargaSat.bandeja.vista.esperanQueTuDecidas'),
    explica: tr('descargaSat.bandeja.vista.variosGastosEmpataronCon'),
    vacio: tr('descargaSat.bandeja.vista.ningunComprobanteTieneVarios'),
  },
  disponible: {
    titulo: tr('descargaSat.bandeja.vista.sinGastoQueLes'),
    explica: tr('descargaSat.bandeja.vista.bajaronDelSatY'),
    vacio: tr('descargaSat.bandeja.vista.todoLoQueBajo'),
  },
  casado: {
    titulo: tr('descargaSat.bandeja.vista.cuadraronConUnGasto'),
    explica: tr('descargaSat.bandeja.vista.quedaronFacturadosSinQue'),
    vacio: tr('descargaSat.bandeja.vista.todaviaNoHaCuadrado'),
  },
  ignorado: {
    titulo: tr('descargaSat.bandeja.vista.archivados'),
    explica: tr('descargaSat.bandeja.vista.losQueAlguienDescarto'),
    vacio: tr('descargaSat.bandeja.vista.noHayNadaArchivado'),
  },
});

interface Params {
  vista?: string; tenant?: string; rol?: string;
  estatus?: string; pag?: string;
  buscar?: string; bimporte?: string; bdesde?: string; bhasta?: string; btexto?: string;
}

/** Arma un enlace de esta pantalla conservando los parámetros de sesión del
 *  superadmin (`?tenant=`/`?vista=`/`?rol=`): perderlos aquí sacaría al
 *  superadmin del "ver como" en medio de una decisión sobre dinero ajeno. */
function enlace(sp: Params, cambios: Record<string, string | null>): string {
  const qs = new URLSearchParams();
  for (const k of ['vista', 'tenant', 'rol', 'estatus', 'pag', 'buscar', 'bimporte', 'bdesde', 'bhasta', 'btexto'] as const) {
    const v = sp[k];
    if (v) qs.set(k, v);
  }
  for (const [k, v] of Object.entries(cambios)) {
    if (v === null) qs.delete(k); else qs.set(k, v);
  }
  const s = qs.toString();
  return `/dashboard/descarga-sat/bandeja${s ? `?${s}` : ''}`;
}

/** Los campos ocultos que el formulario GET del buscador tiene que reenviar
 *  para no perder la sesión ni la página en la que está el contralor. */
function camposDeContexto(sp: Params): Array<{ nombre: string; valor: string }> {
  const salida: Array<{ nombre: string; valor: string }> = [];
  for (const k of ['vista', 'tenant', 'rol', 'estatus', 'pag'] as const) {
    const v = sp[k];
    if (v) salida.push({ nombre: k, valor: v });
  }
  return salida;
}

function sumarDias(dia: string, dias: number): string {
  const t0 = Date.parse(`${dia}T00:00:00Z`);
  if (!Number.isFinite(t0)) return dia;
  return new Date(t0 + dias * 86_400_000).toISOString().slice(0, 10);
}

/**
 * La pantalla, YA CON SUS DATOS. Está separada de quien los va a buscar por la
 * misma razón que `Contenido({ tenantId })` en el resto del panel: para que el
 * preview headless pueda montar el componente REAL —no una copia— y se pueda
 * MIRAR el render sin una sesión de navegador. No autoriza nada: recibe un
 * `tenantId` que solo un llamador ya gateado puede darle, y su server action
 * vuelve a resolver la sesión y a gatear por su cuenta.
 */
export async function PanelBandeja({
  searchParams, tenantId, datos, bandeja, busqueda, prefill,
}: {
  searchParams: Params;
  /** La flota que esta pantalla pinta: la acción de abajo solo escribe en ella (MX-002). */
  tenantId: string;
  datos: VistaDescargaSat;
  bandeja: PaginaBandeja;
  busqueda: ResultadoBusquedaGastos | null;
  prefill: { importe: string; desde: string; hasta: string; texto: string };
}) {
  const { t: tr } = await getT('dinero');
  const proveedor = estadoDescargaSat();
  const estatus = bandeja.estatus;
  const cfdiBuscando = (searchParams.buscar ?? '').trim();
  const filaBuscando = cfdiBuscando === ''
    ? null
    : bandeja.filas.find((f) => f.id === cfdiBuscando && f.estatus === 'disponible') ?? null;

  /**
   * LA ACCIÓN, CON SU PROPIO GUARDA.
   *
   * El rol del RENDER no es el de la acción (mismo criterio que Políticas, el
   * estímulo de peaje y la pantalla de configuración de descarga): se vuelve a
   * resolver la sesión adentro y se gatea dos veces —la RUTA y el ÁREA—. El
   * guarda de área es el molde de `api/export/poliza/route.ts:85`, que se
   * agregó por el hallazgo SEG-19-1 justamente porque las dos preguntas son
   * distintas: `puedeVerRuta` dice si esta pantalla existe para ese rol,
   * `puedeVerArea(rol, 'dinero')` dice si ese rol puede tocar las cifras de
   * dinero de la flota. Aquí no solo se miran: se DECIDE una deducción.
   */
  async function resolver(_p: ResultadoFila, fd: FormData): Promise<ResultadoFila> {
    'use server';
    const { t: tr } = await getT('dinero');
    const s = await resolverTenantAtadoOLanza('/dashboard/descarga-sat/bandeja', searchParams, tenantId);
    if (!puedeVerRuta(s.rol, '/dashboard/descarga-sat/bandeja') || !puedeVerArea(s.rol, 'dinero')) {
      return { error: tr('descargaSat.bandeja.vista.tuRolNoPuede') };
    }
    const cfdiId = t(fd.get('cfdi'));
    const operacion = t(fd.get('operacion'));
    if (cfdiId === '') return { error: tr('descargaSat.bandeja.vista.faltaDecirSobreQue') };
    try {
      if (operacion.startsWith('ligar:')) {
        const r = await ligarComprobante(s.tenantId, cfdiId, operacion.slice('ligar:'.length), { id: s.userId });
        revalidatePath('/dashboard/descarga-sat/bandeja');
        return r.ok ? { ok: r.mensaje } : { error: r.mensaje };
      }
      if (operacion === 'ignorar') {
        const r = await ignorarComprobante(s.tenantId, cfdiId, t(fd.get('motivo')), { id: s.userId });
        revalidatePath('/dashboard/descarga-sat/bandeja');
        return r.ok ? { ok: r.mensaje } : { error: r.mensaje };
      }
      if (operacion === 'revertir') {
        const r = await revertirResolucion(s.tenantId, cfdiId, t(fd.get('motivo')), { id: s.userId });
        revalidatePath('/dashboard/descarga-sat/bandeja');
        return r.ok ? { ok: r.mensaje } : { error: r.mensaje };
      }
      return { error: tr('descargaSat.bandeja.vista.esaOperacionNoExiste') };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'resolver el comprobante') };
    }
  }

  const c = datos.conteos;
  const desde = (bandeja.pagina - 1) * bandeja.porPagina;
  const hasta = desde + bandeja.filas.length;
  const paginas = bandeja.total === null
    ? null
    : Math.min(Math.max(1, Math.ceil(bandeja.total / bandeja.porPagina)), PAGINA_MAX);
  const cola = colas(tr)[estatus];

  const avisoFalta = (!proveedor.configurado || datos.config === null) ? (
        <Aviso tono="warn" titulo={tr('descargaSat.bandeja.vista.todaviaNoHayDe')}>
          {/* Solo el estado: el motivo técnico (variables de entorno, quién lo destraba) es del equipo de Likida, no del contador. */}
          {!proveedor.configurado && <>{tr('descargaSat.panel.proveedorPendiente')} </>}
          {datos.config === null && (
            <>{rico(tr('descargaSat.bandeja.vista.noHasDeclaradoDe'), { link: (c) => <Link href={`/dashboard/descarga-sat${sufijoTenant(searchParams)}`} className="rv-sat__enlace">{c}</Link> })} </>
          )}
          {datos.config !== null && datos.config.certificadoNumero === null && (
            datos.config.verificadaEn === null
              ? tr('descargaSat.bandeja.vista.noSeHaVerificado')
              : tr('descargaSat.bandeja.vista.tuEFirmaNo')
          )}
        </Aviso>
      ) : null;

  const idiomaDatos = await datosParaProveedor(['shell', 'dinero']);
  return (
    <IdiomaProvider idioma={idiomaDatos.idioma} diccionarios={idiomaDatos.diccionarios}>
    <EsqueletoTablaMaestra
      titulo="SAT"
      apoyo={tr('descargaSat.bandeja.vista.loQueBajoDel')}
      filtros={(
        <BarraPeriodo
          etiqueta={tr('descargaSat.bandeja.vista.queBajoDelBuzon')}
          periodo={{
            etiqueta: tr('descargaSat.bandeja.vista.queBajoDelBuzon'),
            valor: estatus,
            opciones: ESTATUS_CFDI.map((e) => ({ valor: e, etiqueta: colas(tr)[e].titulo, href: enlace(searchParams, { estatus: e, pag: null, buscar: null }) })),
          }}
        />
      )}
      avisos={(
        <>
          {c === null && <AvisoCompacto tono="warn" resumen={tr('descargaSat.bandeja.vista.losConteosDeArriba')} />}
          {avisoFalta}
        </>
      )}
      // La tira resume cifras DISTINTAS a las del segmentado (que ya filtra por cada cola): el total bajado y cuánto falta vs. cuánto ya se resolvió.
      // `null` = la consulta de conteos se cayó: «—», nunca un 0 que nadie midió.
      cifras={([
        { etiqueta: tr('descargaSat.bandeja.vista.cifraDescargados'), valor: c === null ? null : c.descargados, nota: tr('descargaSat.bandeja.vista.cifraDescargadosNota') },
        { etiqueta: tr('descargaSat.bandeja.vista.cifraPorResolver'), valor: c === null ? null : c.ambiguos + c.disponibles, nota: tr('descargaSat.bandeja.vista.cifraPorResolverNota') },
        { etiqueta: tr('descargaSat.bandeja.vista.cifraResueltos'), valor: c === null ? null : c.casados + c.ignorados, nota: tr('descargaSat.bandeja.vista.cifraResueltosNota') },
      ] as PropsCifra[]).map((x): PropsCifra => ({
        ...x, formato: 'entero', matiz: 8,
        ...(x.valor === null ? { estado: 'vacio' as const, mensaje: tr('descargaSat.bandeja.vista.noSePudoLeer', { error: '' }) } : {}),
      }))}
      etiquetaCifras={tr('descargaSat.bandeja.vista.queBajoDelBuzon')}
    >
      {/* ── LA LISTA ───────────────────────────────────────────────── */}
      <Tarjeta titulo={cola.titulo} acciones={bandeja.total !== null ? <Chip>{numero(bandeja.total)}</Chip> : undefined}>
        <p className="rv-sat__texto">{cola.explica}</p>
        {bandeja.incompleta && (
          <AvisoCompacto tono="warn" resumen={tr('descargaSat.bandeja.vista.losComprobantesEstanPero')} />
        )}

        {bandeja.error !== null ? (
          // NUNCA se pinta como bandeja limpia: no se pudo preguntar.
          <AvisoCompacto tono="error" resumen={tr('descargaSat.bandeja.vista.noSePudoLeer', { error: bandeja.error })} />
        ) : bandeja.filas.length === 0 ? (
          <EstadoVacio titulo={c !== null && c.descargados === 0 ? tr('descargaSat.bandeja.vista.aunNoBajaNada') : tr('descargaSat.bandeja.vista.colaVacia')} icono={FileQuestion} contenido>
            {/* CERO COMPROBANTES EN TOTAL no es lo mismo que cero en esta cola, y decirlo igual haría creer que el buzón está limpio cuando lo que pasa es que todavía no se ha descargado nada. */}
            {c !== null && c.descargados === 0
              ? tr('descargaSat.bandeja.vista.todaviaNoHaBajado')
              : cola.vacio}
          </EstadoVacio>
        ) : (
          <>
            <ul className="rv-sat__lista">
              {bandeja.filas.map((f) => (
                <FilaComprobante
                  key={f.id}
                  fila={f}
                  accion={resolver}
                  hrefBuscar={f.estatus === 'disponible' ? enlace(searchParams, { buscar: f.id, bimporte: null, bdesde: null, bhasta: null, btexto: null }) : null}
                  hrefCerrarBusqueda={enlace(searchParams, { buscar: null, bimporte: null, bdesde: null, bhasta: null, btexto: null })}
                  busqueda={filaBuscando !== null && filaBuscando.id === f.id && busqueda !== null
                    ? { ...busqueda, ...prefill, campoPagina: camposDeContexto(searchParams) }
                    : null}
                />
              ))}
            </ul>

            {/* ── EL PIE: cuántos se están viendo, de cuántos ───────── */}
            <div className="rv-sat__pie">
              <span>
                {/* Las cifras del pie salen de `count: 'exact'` en la misma consulta que trajo las filas — no de contar en JS. */}
                {tr('descargaSat.bandeja.vista.rangoDe', { desde: numero(desde + 1), hasta: numero(hasta), total: bandeja.total === null ? tr('descargaSat.bandeja.vista.noSePudoContar') : numero(bandeja.total) })}
                {paginas !== null && ' ' + tr('descargaSat.bandeja.vista.paginaDe', { v: numero(bandeja.pagina), v2: numero(paginas) })}
              </span>
              <NavPaginas>
                {bandeja.pagina > 1 && <EnlacePagina href={enlace(searchParams, { pag: String(bandeja.pagina - 1), buscar: null })} direccion="anterior" />}
                {paginas !== null && bandeja.pagina < paginas && <EnlacePagina href={enlace(searchParams, { pag: String(bandeja.pagina + 1), buscar: null })} direccion="siguiente" />}
              </NavPaginas>
            </div>

            {bandeja.truncada && (
              <AvisoCompacto tono="warn" resumen={tr('descargaSat.bandeja.vista.estaListaLlegaHasta', { v: numero(PAGINA_MAX), v2: numero(PAGINA_MAX * POR_PAGINA), v3: numero(bandeja.total ?? 0) })}
                mas={tr('descargaSat.bandeja.vista.laColaSeVacia')} />
            )}

            {/* D-1 (auditoría E.28): el expediente de esta página se cortó en su propio tope, no en el silencioso de PostgREST — y se dice, en vez de pintar cada renglón como si trajera todo. */}
            {bandeja.historialTruncado && (
              <AvisoCompacto tono="warn" resumen={tr('descargaSat.bandeja.vista.elExpedienteDeEstos', { v: numero(bandeja.historialTotal ?? 0) })}
                mas={tr('descargaSat.bandeja.vista.algunosRenglonesMasViejos')} />
            )}
          </>
        )}
        <p className="rv-sat__nota"><strong>{tr('descargaSat.bandeja.vista.nadaDeEstoBorra')}.</strong> {tr('descargaSat.bandeja.vista.archivarYDeshacerDejan')}</p>
      </Tarjeta>
    </EsqueletoTablaMaestra>
    </IdiomaProvider>
  );
}


/**
 * LA PANTALLA, con su sesión resuelta y sus datos ya buscados.
 *
 * Las lecturas caen POR SU LADO (`leerDescargaSat` ya lo hace por dentro): que
 * los conteos de las pestañas no respondan no puede esconder la lista, ni al
 * revés. El buscador de gastos se resuelve SOLO para la fila que lo tiene
 * abierto — una búsqueda por cada `disponible` de la página serían 25
 * consultas por render.
 */
export async function VistaBandejaSat({ searchParams, tenantExiste = true }: {
  searchParams: Params;
  tenantExiste?: boolean;
}) {
  const { tenantId } = await resolverTenantEfectivo('/dashboard/descarga-sat/bandeja', searchParams);

  const estatus: EstatusCfdi = esEstatusCfdi(searchParams.estatus) ? searchParams.estatus : 'ambiguo';
  const pagina = paginaPedida(searchParams.pag);

  const [datos, bandeja] = tenantExiste
    ? await Promise.all([leerDescargaSat(tenantId), leerBandeja(tenantId, estatus, pagina)])
    : [
      // Flota inexistente (`DEMO_TENANT_ID` colgando): cero filas de una flota
      // que NO EXISTE no es un dato sobre el negocio de nadie, así que los
      // conteos van en `null` y la pantalla dice «no se pudo leer».
      { config: null, solicitudes: [], conteos: null, incompleta: false } as VistaDescargaSat,
      {
        filas: [], estatus, pagina, porPagina: POR_PAGINA, total: null,
        paginaMax: PAGINA_MAX, truncada: false, incompleta: false,
        historialTotal: null, historialTruncado: false, error: null,
      } as PaginaBandeja,
    ];

  const cfdiBuscando = (searchParams.buscar ?? '').trim();
  const filaBuscando = cfdiBuscando === ''
    ? null
    : bandeja.filas.find((f) => f.id === cfdiBuscando && f.estatus === 'disponible') ?? null;

  let busqueda: ResultadoBusquedaGastos | null = null;
  let prefill = { importe: '', desde: '', hasta: '', texto: '' };
  if (filaBuscando !== null) {
    // Prellenado con lo que el CFDI ya dice: el importe exacto y una ventana de
    // ±3 días alrededor de su fecha (la del ticket y la del timbrado no siempre
    // coinciden — la misma holgura que usa el cruce automático).
    const impDefecto = filaBuscando.total === null ? '' : String(filaBuscando.total);
    const f = filaBuscando.fecha;
    prefill = {
      importe: searchParams.bimporte ?? impDefecto,
      desde: searchParams.bdesde ?? (f ? sumarDias(f, -3) : ''),
      hasta: searchParams.bhasta ?? (f ? sumarDias(f, 3) : ''),
      texto: searchParams.btexto ?? '',
    };
    // A37-S17-05: un importe ilegible NO quita el filtro ni se lee como 1;
    // se avisa y no se busca (la pantalla no sugiere archivar).
    const imp = interpretarImporteBusqueda(prefill.importe);
    busqueda = imp.error !== null
      ? { gastos: [], truncada: false, error: imp.error }
      : await buscarGastosParaLigar(tenantId, {
        importe: imp.importe,
        desde: prefill.desde || null,
        hasta: prefill.hasta || null,
        texto: prefill.texto || null,
      });
  }

  return (
    <PanelBandeja
      searchParams={searchParams}
      tenantId={tenantId}
      datos={datos}
      bandeja={bandeja}
      busqueda={busqueda}
      prefill={prefill}
    />
  );
}
