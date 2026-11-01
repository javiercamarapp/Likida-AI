import Link from 'next/link';
import { Inbox, ArrowRight } from 'lucide-react';
import { mxn, numero, fechaCorta } from '@/lib/formato';
import { EstadoVacio } from '../../estados';
import { BarraFiltros, FiltroCampo, FiltroFecha, FiltroOpciones } from '@/app/ui-v2/componentes';
import { ComboCatalogo, type BuscarCatalogo } from '../../combo-catalogo';
import {
  ESTADOS_CUADRE, REVISIONES, hayFiltrosCola,
  type FiltrosCola, type PaginaCola, type FilaCola, type RevisionLiquidacion,
} from '@/lib/likida/revision';
import { EnlacePagina, NavPaginas } from '../../paginador';
import { SelloDato, TablaLista, chipsActivos, type ColumnaTabla } from '@/app/ui-v2/datos';
import { ahoraMs } from '@/lib/saludo';
import { fechaMx } from '@/lib/formato';

// ═══════════════════════════════════════════════════════════════════════════
// «ESPERAN TU REVISIÓN» — LA COLA DE VERDAD (auditoría 24, FE-5 · BLOQ-6).
//
// Antes esta tabla era un FILTRO EN MEMORIA sobre las 50 liquidaciones más
// recientes (`getLiquidaciones`, `order created_at desc limit 50`). A ~500
// cierres/día, 50 filas son 2.4 horas: la liquidación que lleva desde la
// mañana esperando firma —justo la que hay que atender— no estaba en la única
// pantalla donde se firma, y el pie mandaba al Registro de Viajes, que no
// filtra por revisión.
//
// Ahora la cola es su propia consulta: `revision='pendiente'` ordenada por
// ANTIGÜEDAD (la que más lleva esperando, primero), por llave `(created_at,
// id)` y con `count` real de la base. El rótulo dice «N de M» con la M
// contada, no con el largo de una lista topada.
//
// Los filtros son los que un contralor usa de verdad: por terminal (la
// sucursal que le toca), por operador, por unidad, por el estado del cuadre y
// por fechas. Van en la URL —`<form method="get">`— para que un filtro se
// pueda compartir por chat y para que el botón de atrás funcione.
// ═══════════════════════════════════════════════════════════════════════════

const ROTULO_REVISION: Record<RevisionLiquidacion, string> = {
  pendiente: 'Esperan firma',
  aprobada: 'Aprobadas',
  ajustada: 'Ajustadas',
  rechazada: 'Rechazadas',
};

/** Cómo se dice el CERO MEDIDO de cada filtro. Cero contado por la base es un
 *  dato, y se pinta como tal. */
const ROTULO_VACIO: Record<RevisionLiquidacion, string> = {
  pendiente: 'Ninguna espera tu firma',
  aprobada: 'Ninguna aprobada',
  ajustada: 'Ninguna ajustada',
  rechazada: 'Ninguna rechazada',
};

// `fg`/`bg` los lee `etiquetas_sincronizadas.test.ts` (las tres copias del estatus coinciden en severidad); la pastilla se pinta con `tono` por clase.
const ROTULO_ESTADO: Record<string, { rotulo: string; fg: string; bg: string; tono: 'ok' | 'warn' | 'bad' }> = {
  cuadrada: { rotulo: 'Cuadrada', fg: 'var(--ok)', bg: 'var(--okbg)', tono: 'ok' },
  con_diferencias: { rotulo: 'Con diferencias', fg: 'var(--warn)', bg: 'var(--warnbg)', tono: 'warn' },
  revisar: { rotulo: 'Revisar', fg: 'var(--bad)', bg: 'var(--badbg)', tono: 'bad' },
};

export interface ColaProps {
  cola: Promise<PaginaCola>;
  filtros: FiltrosCola;
  /** Las terminales de la flota para el selector. `null` = no se pudieron
   *  leer, y entonces el selector no se pinta (no se afirma «no hay»). */
  terminales: Promise<{ opciones: Array<{ id: string; nombre: string }>; recortadas: boolean } | null>;
  /** Buscador de catálogo (server action del host) para operador y unidad. */
  buscar: BuscarCatalogo;
  /** Los campos de la query que hay que conservar en cada link/submit
   *  (`tenant`, `vista`, `rol`): el mismo contrato de sufijo del panel. */
  contexto: Array<[string, string]>;
  sufijo: string;
}

/** El texto que explica QUÉ ventana se está viendo. Nunca «N liquidaciones» a
 *  secas: siempre cuántas de cuántas, y bajo qué filtro. */
export function rotuloCola(p: PaginaCola, f: FiltrosCola): string {
  // El `??` no es adorno: si un día se agrega un estado de revisión y falta su
  // rótulo, la cola tiene que seguir diciendo la verdad en crudo, no reventar
  // la pantalla donde se firma.
  const que = (ROTULO_REVISION[f.revision] ?? f.revision).toLowerCase();
  if (p.total === 0) return ROTULO_VACIO[f.revision] ?? `Ninguna en «${que}»`;
  if (p.filas.length >= p.total) {
    return `${numero(p.total)} ${p.total === 1 ? 'liquidación' : 'liquidaciones'} — ${que}`;
  }
  return `${numero(p.filas.length)} de ${numero(p.total)} — ${que}, las que más llevan esperando primero`;
}

export async function SeccionCola({ cola, filtros, terminales, buscar, contexto, sufijo }: ColaProps) {
  const [pagina, terms] = await Promise.all([cola, terminales]);
  const conFiltros = hayFiltrosCola(filtros);

  return (
    <section className="card p-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
        <h2 className="font-display text-[15px] font-semibold">Esperan tu revisión</h2>
        <p className="text-[11px]" style={{ color: 'var(--faint)' }}>{rotuloCola(pagina, filtros)}</p>
      </div>

      <FormaFiltros filtros={filtros} terminales={terms} buscar={buscar} contexto={contexto} conFiltros={conFiltros}
        nombres={Object.fromEntries(chipsDeCola(pagina, filtros, terms, contexto).map((c) => [c.id, c.valor]))} />


      {pagina.filas.length === 0 ? (
        <EstadoVacio icono={<Inbox width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
          {conFiltros
            ? 'Ninguna liquidación cae en ese filtro. Quita alguno para ver el resto de la cola.'
            : 'No hay liquidaciones esperando a un humano — cuando el agente no pueda cuadrar una solo, la vas a ver aquí.'}
        </EstadoVacio>
      ) : (
        <TablaLista<FilaCola>
          etiqueta="Cola de revisión de liquidaciones"
          columnas={columnasCola(sufijo)}
          filas={pagina.filas}
          idFila={(l) => l.id}
          base=""
          params={{}}
          pie={(
            <div className="rv-tl__sellos">
              <p className="rv-tl__nota">
                {/* La ventana, DECLARADA. No hay «se muestran las más recientes»
                    que esconda a las viejas: esta cola empieza por las viejas. */}
                Por antigüedad. La firma se pone en el detalle de cada una.
              </p>
              {pagina.siguiente && (
                <NavPaginas>
                  <EnlacePagina
                    href={`?${new URLSearchParams([...contexto, ...paramsDeFiltros(filtros), ['cursor', pagina.siguiente]]).toString()}`}
                    direccion="siguiente"
                  />
                </NavPaginas>
              )}
            </div>
          )}
        />
      )}
      <div className="rv-tl__sellos">
        <SelloDato tipo="observado" fuente="Cola de revisión" leidoEn={ahoraMs()} edad={false} />
      </div>
    </section>
  );
}

/** Los filtros vigentes, en forma de query. Se usa para el link de «siguientes»
 *  (el cursor viaja aparte) y para «limpiar». */
export function paramsDeFiltros(f: FiltrosCola): Array<[string, string]> {
  const p: Array<[string, string]> = [];
  if (f.revision !== 'pendiente') p.push(['rev', f.revision]);
  if (f.estado) p.push(['estado', f.estado]);
  if (f.operadorId) p.push(['operador', f.operadorId]);
  if (f.unidadId) p.push(['unidad', f.unidadId]);
  if (f.terminalId) p.push(['terminal', f.terminalId]);
  if (f.desde) p.push(['desde', f.desde]);
  if (f.hasta) p.push(['hasta', f.hasta]);
  return p;
}

function FormaFiltros({ filtros, terminales, buscar, contexto, conFiltros, nombres }: {
  filtros: FiltrosCola;
  terminales: { opciones: Array<{ id: string; nombre: string }>; recortadas: boolean } | null;
  buscar: BuscarCatalogo;
  contexto: Array<[string, string]>;
  conFiltros: boolean;
  /** Nombres legibles de los filtros vigentes (operador, unidad): el combo los muestra, no el id. */
  nombres: Record<string, string>;
}) {
  return (
    /* GET y no server action: un filtro tiene que poder compartirse por chat y
       sobrevivir al botón de atrás. `cursor` NO se conserva — cambiar el filtro
       empieza la cola desde arriba, o la página 3 de otro filtro no significa
       nada. Una sola barra (LF): elegir envía, sin botón «Filtrar». */
    <BarraFiltros accion="?" ocultos={contexto} etiqueta="Filtros de la cola" nActivos={conFiltros ? 1 : 0}
      limpiarHref={`?${new URLSearchParams(contexto).toString()}`} className="mb-3">
      <FiltroOpciones nombre="rev" etiqueta="Revisión" valor={filtros.revision} porDefecto="pendiente"
        opciones={REVISIONES.map((r) => ({ valor: r, rotulo: ROTULO_REVISION[r] }))} />
      <FiltroOpciones nombre="estado" etiqueta="Cuadre" valor={filtros.estado ?? ''}
        opciones={[{ valor: '', rotulo: 'Cualquiera' }, ...ESTADOS_CUADRE.map((e) => ({ valor: e, rotulo: ROTULO_ESTADO[e]?.rotulo ?? e }))]} />

      {/* El catálogo NO viaja: el combo pide 20 al escribir (FE-2). */}
      <FiltroCampo etiqueta="Operador">
        <ComboCatalogo tipo="operador" name="operador" buscar={buscar} etiquetaVacia="Cualquiera" enBarra
          valorInicial={filtros.operadorId} textoInicial={filtros.operadorId && nombres.operador !== 'elegido' ? nombres.operador : ''} aria-label="Filtrar por operador" />
      </FiltroCampo>
      <FiltroCampo etiqueta="Unidad">
        <ComboCatalogo tipo="unidad" name="unidad" buscar={buscar} etiquetaVacia="Cualquiera" enBarra
          valorInicial={filtros.unidadId} textoInicial={filtros.unidadId && nombres.unidad !== 'elegida' ? nombres.unidad : ''} aria-label="Filtrar por unidad" />
      </FiltroCampo>

      {/* Sin terminales legibles NO se pinta el selector: un selector con
          solo «Cualquiera» afirmaría que la flota no tiene sucursales. */}
      {terminales && terminales.opciones.length > 0 && (
        <FiltroOpciones nombre="terminal" valor={filtros.terminalId ?? ''}
          etiqueta={terminales.recortadas ? `Terminal (primeras ${numero(terminales.opciones.length)}; hay más)` : 'Terminal'}
          opciones={[{ valor: '', rotulo: 'Cualquiera' }, ...terminales.opciones.map((t) => ({ valor: t.id, rotulo: t.nombre }))]} />
      )}

      <FiltroFecha nombre="desde" etiqueta="Desde" valor={filtros.desde} />
      <FiltroFecha nombre="hasta" etiqueta="Hasta" valor={filtros.hasta} />
    </BarraFiltros>
  );
}

/** Las columnas de la cola. El orden es el del servidor (por antigüedad, la que más lleva esperando primero) y NO se ofrece ordenar:
 *  la cola se pagina por cursor, y ordenar solo la página visible escondería a las que más llevan esperando firma. */
function columnasCola(sufijo: string): ColumnaTabla<FilaCola>[] {
  return [
    { id: 'viaje', titulo: 'Viaje', principal: true, celda: (l) => l.folio },
    { id: 'cerrada', titulo: 'Cerrada', corta: true, celda: (l) => <span className="rv-tl__apagado">{fechaCorta(l.creadoEn)}</span> },
    // Sin nombre no se inventa uno: la ficha del chofer puede estar incompleta y «—» es la verdad.
    { id: 'operador', titulo: 'Operador', celda: (l) => <span className="rv-tl__apagado">{l.operadorNombre ?? '—'}</span> },
    { id: 'unidad', titulo: 'Unidad', corta: true, celda: (l) => <span className="rv-tl__apagado">{l.unidadEco ?? '—'}</span> },
    { id: 'comprobado', titulo: 'Comprobado', alinear: 'der', celda: (l) => <span className="cifra-mono">{mxn(l.comprobado)}</span> },
    { id: 'diferencia', titulo: 'Diferencia', alinear: 'der', celda: (l) => <span className={l.diferencia !== 0 ? 'cifra-mono rv-tl__bad' : 'cifra-mono'}>{mxn(l.diferencia)}</span> },
    {
      id: 'cuadre', titulo: 'Cuadre', corta: true,
      celda: (l) => {
        const e = ROTULO_ESTADO[l.estatus] ?? { rotulo: l.estatus, tono: undefined };
        return <span className="rv-tl__pill" data-tono={e.tono}>{e.rotulo}</span>;
      },
    },
    {
      id: 'accion', titulo: 'Revisar', tituloOculto: true, alinear: 'der',
      celda: (l) => (
        <Link href={`/dashboard/${l.id}${sufijo}`} className="inline-flex items-center gap-1 text-[12px] font-medium hover:opacity-70 transition-opacity rv-tl__enlace">
          Revisar <ArrowRight width={12} height={12} strokeWidth={2} aria-hidden />
        </Link>
      ),
    },
  ];
}

/** El nombre solo si es INEQUÍVOCO: todas las filas (ya filtradas por el servidor) traen el mismo nombre. Con nombres distintos, vacíos o
 *  sin filas, null → el chip dice «elegido» y no adivina. */
function unico(nombres: ReadonlyArray<string | null>): string | null {
  if (nombres.length === 0 || nombres.some((n) => !n)) return null;
  return new Set(nombres).size === 1 ? nombres[0] : null;
}

/** Los filtros vigentes de la cola como chips: el nombre de operador, unidad y terminal sale de la propia cola / del catálogo de
 *  terminales (la URL solo trae ids). Si no hay filas que lo nombren, el chip dice que hay un filtro y no inventa el nombre. */
export function chipsDeCola(
  pagina: PaginaCola, f: FiltrosCola,
  terminales: { opciones: Array<{ id: string; nombre: string }> } | null,
  contexto: Array<[string, string]>,
) {
  const vigentes = Object.fromEntries([...contexto, ...paramsDeFiltros(f)]);
  return chipsActivos('', vigentes, [
    { param: 'rev', etiqueta: 'Revisión', rotuloValor: (v) => ROTULO_REVISION[v as RevisionLiquidacion] ?? v },
    { param: 'estado', etiqueta: 'Cuadre', rotuloValor: (v) => ROTULO_ESTADO[v]?.rotulo ?? v },
    { param: 'operador', etiqueta: 'Operador', rotuloValor: () => unico(pagina.filas.map((x) => x.operadorNombre)) ?? 'elegido' },
    { param: 'unidad', etiqueta: 'Unidad', rotuloValor: () => unico(pagina.filas.map((x) => x.unidadEco)) ?? 'elegida' },
    { param: 'terminal', etiqueta: 'Terminal', rotuloValor: (v) => terminales?.opciones.find((t) => t.id === v)?.nombre ?? 'elegida' },
    { param: 'desde', etiqueta: 'Desde', rotuloValor: (v) => fechaMx(v) },
    { param: 'hasta', etiqueta: 'Hasta', rotuloValor: (v) => fechaMx(v) },
  ], ['cursor', 'c', 'pag']);
}
