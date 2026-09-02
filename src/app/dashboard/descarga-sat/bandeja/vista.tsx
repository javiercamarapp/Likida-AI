import { revalidatePath } from 'next/cache';
import Link from 'next/link';
import { CloudDownload, FileQuestion, Scale3d } from 'lucide-react';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta, puedeVerArea } from '@/lib/auth/visibilidad';
import { mensajeParaPantalla } from '@/lib/likida/administracion';
import { estadoDescargaSat } from '@/lib/likida/sat_descarga';
import { leerDescargaSat, type VistaDescargaSat } from '@/lib/likida/sat_descarga/lectura';
import {
  leerBandeja, buscarGastosParaLigar, esEstatusCfdi, paginaPedida,
  POR_PAGINA, PAGINA_MAX, ESTATUS_CFDI,
  type EstatusCfdi, type PaginaBandeja, type ResultadoBusquedaGastos,
} from '@/lib/likida/sat_descarga/bandeja';
import {
  ligarComprobante, ignorarComprobante, revertirResolucion,
} from '@/lib/likida/sat_descarga/resolucion';
import { numero } from '@/lib/formato';
import { sufijoTenant } from '../../sufijo';
import { BarraPagina, TituloSeccion } from '../../resumen-visual';
import { EstadoVacio } from '../../../admin/ui/kit';
import { FilaComprobante, type ResultadoFila } from './fila';

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
const COLAS: Record<EstatusCfdi, { titulo: string; explica: string; vacio: string }> = {
  ambiguo: {
    titulo: 'Esperan que tú decidas',
    explica: 'Varios gastos empataron con el importe de estos comprobantes y Likida se niega a adivinar. Elige cuál era, y el cruce queda firmado con tu correo.',
    vacio: 'Ningún comprobante tiene varios candidatos ahora mismo. Ésta es la cola que debe verse vacía casi siempre.',
  },
  disponible: {
    titulo: 'Sin gasto que les corresponda',
    explica: 'Bajaron del SAT y ningún gasto los reclama. Eso TAMBIÉN es un hallazgo: alguien gastó y nadie lo reportó. Ligalos al gasto que les toque, o archívalos con motivo.',
    vacio: 'Todo lo que bajó encontró su gasto o ya se archivó. Nada que reclamar.',
  },
  casado: {
    titulo: 'Cuadraron con un gasto',
    explica: 'Quedaron facturados sin que nadie entrara a un portal. Si alguno está mal, se deshace desde aquí — y la reversión se anota, no se borra.',
    vacio: 'Todavía no ha cuadrado ningún comprobante con un gasto.',
  },
  ignorado: {
    titulo: 'Archivados',
    explica: 'Los que alguien descartó con motivo, y los consolidados de monedero que ya entraron línea por línea por su propio camino. No se borraron: se pueden devolver a la bandeja.',
    vacio: 'No hay nada archivado.',
  },
};

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
  searchParams, datos, bandeja, busqueda, prefill,
}: {
  searchParams: Params;
  datos: VistaDescargaSat;
  bandeja: PaginaBandeja;
  busqueda: ResultadoBusquedaGastos | null;
  prefill: { importe: string; desde: string; hasta: string; texto: string };
}) {
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
    const s = await resolverTenantEfectivo('/dashboard/descarga-sat/bandeja', searchParams);
    if (!puedeVerRuta(s.rol, '/dashboard/descarga-sat/bandeja') || !puedeVerArea(s.rol, 'dinero')) {
      return { error: 'Tu rol no puede resolver comprobantes del SAT: esto mueve dinero deducible de la flota.' };
    }
    const cfdiId = t(fd.get('cfdi'));
    const operacion = t(fd.get('operacion'));
    if (cfdiId === '') return { error: 'Falta decir sobre qué comprobante se está decidiendo.' };
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
      return { error: 'Esa operación no existe: ligar, archivar o deshacer, ni una más.' };
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
  const cola = COLAS[estatus];

  return (
    <main className="h-full">
      <div className="rounded-2xl overflow-hidden min-h-full flex flex-col hairline" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Scale3d width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Conciliación del SAT"
        />

        <div className="px-5 pb-5 pt-3 space-y-3">
          {/* ── LAS CUATRO COLAS, con su conteo EXACTO de la base ──────── */}
          <section className="card p-3">
            <TituloSeccion>Qué bajó del buzón, y en qué está</TituloSeccion>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              {ESTATUS_CFDI.map((e) => {
                const activo = e === estatus;
                // `null` = la consulta de conteos se cayó. La pestaña no pinta
                // un 0 que nadie midió: pinta un guion.
                const n = c === null ? null
                  : e === 'ambiguo' ? c.ambiguos
                    : e === 'disponible' ? c.disponibles
                      : e === 'casado' ? c.casados : c.ignorados;
                return (
                  <Link key={e} href={enlace(searchParams, { estatus: e, pag: null, buscar: null })}
                    aria-current={activo ? 'page' : undefined}
                    className="inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-full hairline transition-opacity hover:opacity-80"
                    style={activo
                      ? { background: 'var(--ink)', color: 'var(--surface)' }
                      : { background: 'var(--surface)' }}>
                    {COLAS[e].titulo}
                    <span className="cifra-mono text-[11px]" style={{ opacity: 0.75 }}>
                      {n === null ? '—' : numero(n)}
                    </span>
                  </Link>
                );
              })}
            </div>
            {c === null && (
              <p className="text-[12px] mt-2 mb-0" style={{ color: 'var(--warn)' }}>
                Los conteos de arriba no se pudieron leer — el guion NO quiere decir cero.
                La lista de abajo sí se pidió por su cuenta.
              </p>
            )}
            <p className="text-[12.5px] mt-2 mb-0" style={{ color: 'var(--muted)' }}>{cola.explica}</p>
          </section>

          {/* ── QUÉ FALTA PARA QUE HAYA ALGO QUE CONCILIAR ─────────────── */}
          {(!proveedor.configurado || datos.config === null) && (
            <section className="card p-4" style={{ borderColor: 'var(--warn)' }}>
              <TituloSeccion>Todavía no hay de dónde bajar comprobantes</TituloSeccion>
              <ul className="mt-2 space-y-1.5 text-[12.5px] m-0 pl-4">
                {!proveedor.configurado && (
                  <li style={{ color: 'var(--muted)' }}>
                    {proveedor.motivo} <span style={{ color: 'var(--faint)' }}>— lo destraba Likida, no tu flota.</span>
                  </li>
                )}
                {datos.config === null && (
                  <li style={{ color: 'var(--muted)' }}>
                    No has declarado de qué RFC se descarga el buzón.{' '}
                    <Link href={`/dashboard/descarga-sat${sufijoTenant(searchParams)}`} className="underline">Decláralo aquí</Link> — sin eso
                    no se pide nada, y Likida jamás adivina un RFC.
                  </li>
                )}
                {datos.config !== null && datos.config.certificadoNumero === null && (
                  <li style={{ color: 'var(--muted)' }}>
                    {datos.config.verificadaEn === null
                      ? 'No se ha verificado que tu e.firma esté cargada en la bóveda del PAC.'
                      : 'Tu e.firma NO se encontró en la bóveda del PAC — la sube tu contador en el portal del PAC.'}
                  </li>
                )}
              </ul>
            </section>
          )}

          {/* ── LA LISTA ───────────────────────────────────────────────── */}
          <section className="card p-3">
            <div className="flex items-center gap-2 flex-wrap">
              <TituloSeccion>{cola.titulo}</TituloSeccion>
              {bandeja.total !== null && (
                <span className="cifra-mono text-[11px] px-1.5 py-0.5 rounded-full"
                  style={{ background: 'var(--canvas)', color: 'var(--muted)' }}>
                  {numero(bandeja.total)}
                </span>
              )}
            </div>

            {bandeja.incompleta && (
              <p className="text-[12px] mt-2 mb-0" style={{ color: 'var(--warn)' }}>
                Los comprobantes están, pero algo de lo que cuelga de ellos —los candidatos o el
                expediente— no se pudo leer. Reintenta antes de decidir sobre esta pantalla.
              </p>
            )}

            {bandeja.error !== null ? (
              // NUNCA se pinta como bandeja limpia: no se pudo preguntar.
              <p className="text-[12.5px] mt-2 mb-0" style={{ color: 'var(--bad)' }}>
                No se pudo leer esta lista, así que NO significa que esté vacía: {bandeja.error}
              </p>
            ) : bandeja.filas.length === 0 ? (
              <div className="mt-2">
                <EstadoVacio icono={<FileQuestion width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                  {/* CERO COMPROBANTES EN TOTAL no es lo mismo que cero en esta
                      cola, y decirlo igual haría creer que el buzón está limpio
                      cuando lo que pasa es que todavía no se ha descargado nada. */}
                  {c !== null && c.descargados === 0
                    ? 'Todavía no ha bajado ni un comprobante del buzón del SAT. No es que esté todo cuadrado: es que la descarga no ha traído nada. Arriba está lo que falta para que empiece.'
                    : cola.vacio}
                </EstadoVacio>
              </div>
            ) : (
              <>
                <ul className="mt-2.5 space-y-2 m-0 p-0">
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
                <div className="mt-3 flex items-center gap-3 flex-wrap text-[12px]" style={{ color: 'var(--muted)' }}>
                  <span>
                    {/* Las cifras del pie salen de `count: 'exact'` en la misma
                        consulta que trajo las filas — no de contar en JS. */}
                    {numero(desde + 1)}–{numero(hasta)} de{' '}
                    {bandeja.total === null
                      ? <span style={{ color: 'var(--warn)' }}>no se pudo contar</span>
                      : numero(bandeja.total)}
                    {paginas !== null && ` · página ${numero(bandeja.pagina)} de ${numero(paginas)}`}
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    {bandeja.pagina > 1 && (
                      <Link href={enlace(searchParams, { pag: String(bandeja.pagina - 1), buscar: null })}
                        className="px-2.5 py-1 rounded-full hairline hover:opacity-70 transition-opacity">
                        ← Anterior
                      </Link>
                    )}
                    {paginas !== null && bandeja.pagina < paginas && (
                      <Link href={enlace(searchParams, { pag: String(bandeja.pagina + 1), buscar: null })}
                        className="px-2.5 py-1 rounded-full hairline hover:opacity-70 transition-opacity">
                        Siguiente →
                      </Link>
                    )}
                  </span>
                </div>

                {bandeja.truncada && (
                  <p className="text-[12px] mt-2 mb-0" style={{ color: 'var(--warn)' }}>
                    Esta lista llega hasta la página {numero(PAGINA_MAX)} ({numero(PAGINA_MAX * POR_PAGINA)}{' '}
                    comprobantes) y hay {numero(bandeja.total ?? 0)} en esta cola: lo que sigue NO se
                    está enseñando. La cola se vacía por el frente — resuelve lo de arriba y el
                    resto sube.
                  </p>
                )}

                {/* D-1 (auditoría E.28): el expediente de esta página se cortó
                    en su propio tope, no en el silencioso de PostgREST — y se
                    dice, en vez de pintar cada renglón como si trajera todo. */}
                {bandeja.historialTruncado && (
                  <p className="text-[12px] mt-2 mb-0" style={{ color: 'var(--warn)' }}>
                    El expediente de estos comprobantes trae {numero(bandeja.historialTotal ?? 0)} actos en
                    total y aquí se muestran los más recientes: algunos renglones más viejos no caben en
                    esta vista. Abre el expediente de cada comprobante para lo que sí se enseña.
                  </p>
                )}
              </>
            )}
          </section>

          <EstadoVacio icono={<CloudDownload width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
            Nada de esto borra un comprobante. Archivar y deshacer dejan rastro firmado con el
            correo de quien lo hizo —congelado, para que sobreviva a que la cuenta se borre— y el
            expediente de cada fila se abre debajo de ella. El candado es de base, no de esta
            pantalla: `sat_cfdi_descargado_casado_coherente` (0231) hace imposible que un
            comprobante afirme un cruce sin decir con qué gasto.
          </EstadoVacio>
        </div>
      </div>
    </main>
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
    const impNum = Number.parseFloat(prefill.importe);
    busqueda = await buscarGastosParaLigar(tenantId, {
      importe: Number.isFinite(impNum) ? impNum : null,
      desde: prefill.desde || null,
      hasta: prefill.hasta || null,
      texto: prefill.texto || null,
    });
  }

  return (
    <PanelBandeja
      searchParams={searchParams}
      datos={datos}
      bandeja={bandeja}
      busqueda={busqueda}
      prefill={prefill}
    />
  );
}
