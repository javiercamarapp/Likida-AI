import Link from 'next/link';
import { Inbox, ArrowRight } from 'lucide-react';
import './liquidacion.css';
import { mxn, numero, fechaCorta } from '@/lib/formato';
import { BarraFiltros, EstadoVacio, FiltroCampo, FiltroFecha, FiltroOpciones, Icono, StatusChip, Tarjeta } from '@/app/ui-v2/componentes';
import { ComboCatalogo, type BuscarCatalogo } from '../../combo-catalogo';
import {
  ESTADOS_CUADRE, REVISIONES, hayFiltrosCola,
  type FiltrosCola, type PaginaCola, type FilaCola, type RevisionLiquidacion,
} from '@/lib/likida/revision';
import { EnlacePagina, NavPaginas } from '../../paginador';
import { SelloDato, TablaLista, chipsActivos, type ColumnaTabla } from '@/app/ui-v2/datos';
import { ahoraMs } from '@/lib/saludo';
import { fechaMx } from '@/lib/formato';
import { getT } from '@/lib/i18n/servidor';
import { type TAgentes, type TrAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';

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
const rotuloEstado = (tx: TAgentes = TR_ES.t): Record<string, { rotulo: string; fg: string; bg: string; tono: 'ok' | 'warn' | 'bad' }> => ({
  cuadrada: { rotulo: tx('rest.cuadrada'), fg: 'var(--ok)', bg: 'var(--okbg)', tono: 'ok' },
  con_diferencias: { rotulo: tx('liquidacion.vista.con_diferencias'), fg: 'var(--warn)', bg: 'var(--warnbg)', tono: 'warn' },
  revisar: { rotulo: tx('rest.revisar'), fg: 'var(--bad)', bg: 'var(--badbg)', tono: 'bad' },
});

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
export function rotuloCola(p: PaginaCola, f: FiltrosCola, tx: TAgentes = TR_ES.t): string {
  // El `??` no es adorno: si un día se agrega un estado de revisión y falta su
  // rótulo, la cola tiene que seguir diciendo la verdad en crudo, no reventar
  // la pantalla donde se firma.
  const que = (ROTULO_REVISION[f.revision] ?? f.revision).toLowerCase();
  if (p.total === 0) return ROTULO_VACIO[f.revision] ?? `Ninguna en «${que}»`;
  if (p.filas.length >= p.total) {
    return `${numero(p.total)} ${p.total === 1 ? tx('rest.liquidacion') : 'liquidaciones'} — ${que}`;
  }
  return tx('rest.de_las_que_mas_llevan_esperando', { numero: numero(p.filas.length), numero2: numero(p.total), que });
}

export async function SeccionCola({ cola, filtros, terminales, buscar, contexto, sufijo }: ColaProps) {
  const { t: tx } = await getT('agentes');
  const [pagina, terms] = await Promise.all([cola, terminales]);
  const conFiltros = hayFiltrosCola(filtros);

  return (
    <Tarjeta titulo={tx('rest.esperan_tu_revision')} acciones={<span className="rv-liq-sub">{rotuloCola(pagina, filtros)}</span>}>

      <FormaFiltros filtros={filtros} terminales={terms} buscar={buscar} contexto={contexto} conFiltros={conFiltros}
        nombres={Object.fromEntries(chipsDeCola(pagina, filtros, terms, contexto).map((c) => [c.id, c.valor]))} />


      {pagina.filas.length === 0 ? (
        <EstadoVacio icono={Inbox} titulo={conFiltros ? tx('rest.ningun_resultado_con_ese_filtro') : tx('rest.nada_espera_tu_firma')}>
          {conFiltros
            ? tx('rest.ninguna_liquidacion_cae_en_ese_filtro')
            : tx('rest.no_hay_liquidaciones_esperando_a_un')}
        </EstadoVacio>
      ) : (
        <TablaLista<FilaCola>
          etiqueta={tx('rest.cola_de_revision_de_liquidaciones')}
          columnas={columnasCola(sufijo)}
          filas={pagina.filas}
          idFila={(l) => l.id}
          base=""
          params={{}}
          pie={(
            <div className="rv-tl__sellos">
              <p className="rv-tl__nota">{tx('rest.por_antiguedad_la_firma_se_pone')}</p>
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
    </Tarjeta>
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

function FormaFiltros({ filtros, terminales, buscar, contexto, conFiltros, nombres, tr = TR_ES }: {
  filtros: FiltrosCola;
  terminales: { opciones: Array<{ id: string; nombre: string }>; recortadas: boolean } | null;
  buscar: BuscarCatalogo;
  contexto: Array<[string, string]>;
  conFiltros: boolean;
  /** Nombres legibles de los filtros vigentes (operador, unidad): el combo los muestra, no el id. */
  nombres: Record<string, string>; tr?: TrAgentes;
}) {
  const { t: tx } = tr;
  return (
    /* GET y no server action: un filtro tiene que poder compartirse por chat y
       sobrevivir al botón de atrás. `cursor` NO se conserva — cambiar el filtro
       empieza la cola desde arriba, o la página 3 de otro filtro no significa
       nada. Una sola barra (LF): elegir envía, sin botón «Filtrar». */
    <BarraFiltros accion="?" ocultos={contexto} etiqueta={tx('rest.filtros_de_la_cola')} nActivos={conFiltros ? 1 : 0}
      limpiarHref={`?${new URLSearchParams(contexto).toString()}`} className="mb-3">
      <FiltroOpciones nombre="rev" etiqueta={tx('rest.revision')} valor={filtros.revision} porDefecto="pendiente"
        opciones={REVISIONES.map((r) => ({ valor: r, rotulo: ROTULO_REVISION[r] }))} />
      <FiltroOpciones nombre="estado" etiqueta={tx('rest.cuadre')} valor={filtros.estado ?? ''}
        opciones={[{ valor: '', rotulo: tx('rest.cualquiera') }, ...ESTADOS_CUADRE.map((e) => ({ valor: e, rotulo: rotuloEstado(tx)[e]?.rotulo ?? e }))]} />

      {/* El catálogo NO viaja: el combo pide 20 al escribir (FE-2). */}
      <FiltroCampo etiqueta={tx('conductores.forma.operador')}>
        <ComboCatalogo tipo="operador" name="operador" buscar={buscar} etiquetaVacia="Cualquiera" enBarra
          valorInicial={filtros.operadorId} textoInicial={filtros.operadorId && nombres.operador !== 'elegido' ? nombres.operador : ''} aria-label={tx('rest.filtrar_por_operador')} />
      </FiltroCampo>
      <FiltroCampo etiqueta={tx('rest.unidad')}>
        <ComboCatalogo tipo="unidad" name="unidad" buscar={buscar} etiquetaVacia="Cualquiera" enBarra
          valorInicial={filtros.unidadId} textoInicial={filtros.unidadId && nombres.unidad !== 'elegida' ? nombres.unidad : ''} aria-label={tx('rest.filtrar_por_unidad')} />
      </FiltroCampo>

      {/* Sin terminales legibles NO se pinta el selector: un selector con
          solo «Cualquiera» afirmaría que la flota no tiene sucursales. */}
      {terminales && terminales.opciones.length > 0 && (
        <FiltroOpciones nombre="terminal" valor={filtros.terminalId ?? ''}
          etiqueta={terminales.recortadas ? tx('rest.terminal_primeras_hay_mas', { numero: numero(terminales.opciones.length) }) : tx('rest.terminal')}
          opciones={[{ valor: '', rotulo: tx('rest.cualquiera') }, ...terminales.opciones.map((t) => ({ valor: t.id, rotulo: t.nombre }))]} />
      )}

      <FiltroFecha nombre="desde" etiqueta={tx('cobranza.estrategia.desde')} valor={filtros.desde} />
      <FiltroFecha nombre="hasta" etiqueta={tx('cobranza.estrategia.hasta')} valor={filtros.hasta} />
    </BarraFiltros>
  );
}

/** Las columnas de la cola. El orden es el del servidor (por antigüedad, la que más lleva esperando primero) y NO se ofrece ordenar:
 *  la cola se pagina por cursor, y ordenar solo la página visible escondería a las que más llevan esperando firma. */
function columnasCola(sufijo: string, tx: TAgentes = TR_ES.t): ColumnaTabla<FilaCola>[] {
  return [
    { id: 'viaje', titulo: tx('liquidacion.vista.viaje'), principal: true, celda: (l) => l.folio },
    { id: 'cerrada', titulo: tx('rest.cerrada'), corta: true, celda: (l) => <span className="rv-tl__apagado">{fechaCorta(l.creadoEn)}</span> },
    // Sin nombre no se inventa uno: la ficha del chofer puede estar incompleta y «—» es la verdad.
    { id: 'operador', titulo: tx('conductores.forma.operador'), celda: (l) => <span className="rv-tl__apagado">{l.operadorNombre ?? '—'}</span> },
    { id: 'unidad', titulo: tx('rest.unidad'), corta: true, celda: (l) => <span className="rv-tl__apagado">{l.unidadEco ?? '—'}</span> },
    { id: 'comprobado', titulo: tx('liquidacion.vista.comprobado'), alinear: 'der', celda: (l) => <span className="rv-ag-num">{mxn(l.comprobado)}</span> },
    { id: 'diferencia', titulo: tx('liquidacion.vista.diferencia'), alinear: 'der', celda: (l) => <span className={l.diferencia !== 0 ? 'rv-ag-num rv-tl__bad' : 'rv-ag-num'}>{mxn(l.diferencia)}</span> },
    {
      id: 'cuadre', titulo: tx('rest.cuadre'), corta: true,
      celda: (l) => {
        const e = rotuloEstado(tx)[l.estatus] ?? { rotulo: l.estatus, tono: 'muted' as const };
        return <StatusChip tono={e.tono}>{e.rotulo}</StatusChip>;
      },
    },
    {
      id: 'accion', titulo: tx('rest.revisar'), tituloOculto: true, alinear: 'der',
      celda: (l) => (
        <Link href={`/dashboard/${l.id}${sufijo}`} className="rv-liq-enlace rv-tl__enlace">{tx('rest.revisar')}{' '}<Icono icono={ArrowRight} tam={14} />
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
  contexto: Array<[string, string]>, tx: TAgentes = TR_ES.t,
) {
  const vigentes = Object.fromEntries([...contexto, ...paramsDeFiltros(f)]);
  return chipsActivos('', vigentes, [
    { param: 'rev', etiqueta: tx('rest.revision'), rotuloValor: (v) => ROTULO_REVISION[v as RevisionLiquidacion] ?? v },
    { param: 'estado', etiqueta: tx('rest.cuadre'), rotuloValor: (v) => rotuloEstado(tx)[v]?.rotulo ?? v },
    { param: 'operador', etiqueta: tx('conductores.forma.operador'), rotuloValor: () => unico(pagina.filas.map((x) => x.operadorNombre)) ?? 'elegido' },
    { param: 'unidad', etiqueta: tx('rest.unidad'), rotuloValor: () => unico(pagina.filas.map((x) => x.unidadEco)) ?? 'elegida' },
    { param: 'terminal', etiqueta: tx('rest.terminal'), rotuloValor: (v) => terminales?.opciones.find((t) => t.id === v)?.nombre ?? 'elegida' },
    { param: 'desde', etiqueta: tx('cobranza.estrategia.desde'), rotuloValor: (v) => fechaMx(v) },
    { param: 'hasta', etiqueta: tx('cobranza.estrategia.hasta'), rotuloValor: (v) => fechaMx(v) },
  ], ['cursor', 'c', 'pag']);
}
