import Link from 'next/link';
import { ArrowRight, Inbox, Search, FileUp } from 'lucide-react';
import { numero, fechaMx, mxn } from '@/lib/formato';
import { StatusPill, type Estado } from '@/app/admin/ui/kit';
import { EstadoVacio } from '../estados';
import { PILL_ESTATUS } from '../resumen-visual';
import { PillAviso } from '../despacho/vista';
import { ImportarViajes, type AccionImportar } from './importar';
import { EnlacePagina, NavPaginas } from '../paginador';
import { Cifra, TiraCifras } from '@/app/ui-v2/graficas';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import { MarcoPagina } from '@/app/ui-v2/componentes';
import { ChipsFiltro, SelloDato, TablaLista, chipsActivos, type ColumnaTabla } from '@/app/ui-v2/datos';
import { ahoraMs } from '@/lib/saludo';

export type FiltroViajes = 'todos' | 'abiertos' | 'en_cuadre' | 'liquidados' | 'escalados';

/** La fila del registro v2 (22-ago-2026): la ficha operativa del viaje más,
 *  SOLO si la página lo permitió (`verDinero`), el anticipo y lo que su
 *  liquidación comprobó. Los tres pesos vienen `null` cuando el rol no ve
 *  finanzas — la página los deja en el servidor, la vista no los pinta. */
export interface FilaRegistroViaje {
  id: string; folio: string; origen: string | null; destino: string | null;
  estatus: string; operadorNombre: string | null; unidadEco: string | null;
  fechaInicio: string | null;
  intakePendientes: number;
  avisadoEn: string | null; aceptadoEn: string | null; escaladoEn: string | null;
  avisosEnviados: number;
  /** `null` = el rol no ve pesos (no "sin anticipo"). */
  anticipo: number | null;
  /** `null` = sin liquidación todavía, o sin permiso. */
  comprobado: number | null;
  diferencia: number | null;
  liqId: string | null;
  liqEstatus: string | null;
}

const ROTULO_FILTRO: Record<FiltroViajes, string> = {
  todos: 'Todos', abiertos: 'Abiertos', en_cuadre: 'En cuadre',
  liquidados: 'Liquidados', escalados: 'Escalados',
};

/** Arma un href a esta misma página conservando el sufijo de
 *  previsualización (`?tenant=`/`?vista=`/`?rol=`) y los controles (filtro,
 *  búsqueda, cursor de página). Un `null` quita el parámetro. El `p` de la
 *  paginación por número (hasta el 22-ago-2026) se BORRA siempre: cambiar de
 *  filtro o de búsqueda vuelve a la primera página, y un `p` heredado ya no
 *  significa nada (ver page.tsx). */
export function hrefRegistro(
  sufijo: string,
  controles: { f?: FiltroViajes | null; q?: string | null; c?: string | null },
): string {
  const params = new URLSearchParams(sufijo.startsWith('?') ? sufijo.slice(1) : sufijo);
  if (controles.f && controles.f !== 'todos') params.set('f', controles.f); else params.delete('f');
  if (controles.q) params.set('q', controles.q); else params.delete('q');
  if (controles.c) params.set('c', controles.c); else params.delete('c');
  params.delete('p');
  const qs = params.toString();
  return `/dashboard/viajes${qs ? `?${qs}` : ''}`;
}

const BTN_SEC = 'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12.5px] font-medium hairline transition-colors hover:bg-[var(--canvas)]';

/** Las columnas del registro. Los tres pesos (anticipo, comprobado, diferencia) SOLO existen si el rol ve dinero: para el jefe de
 *  tráfico ni la cabecera se arma. El orden es el del servidor (cursor, del más reciente al más antiguo): ninguna cabecera ordena,
 *  porque ordenar solo la página visible fingiría ordenar el total. */
function columnasViajes(sufijo: string, verDinero: boolean): ColumnaTabla<FilaRegistroViaje>[] {
  const dinero: ColumnaTabla<FilaRegistroViaje>[] = verDinero ? [
    { id: 'anticipo', titulo: 'Anticipo', alinear: 'der', celda: (v) => (v.anticipo === null ? '—' : mxn(v.anticipo)) },
    { id: 'comprobado', titulo: 'Comprobado', alinear: 'der', celda: (v) => (v.comprobado === null ? <span className="rv-tl__tenue">—</span> : mxn(v.comprobado)) },
    {
      id: 'diferencia', titulo: 'Diferencia', alinear: 'der',
      celda: (v) => v.diferencia === null ? <span className="rv-tl__tenue">—</span>
        : <span className={v.diferencia === 0 ? 'rv-tl__ok' : v.diferencia > 0 ? 'rv-tl__warn' : 'rv-tl__bad'}>{v.diferencia === 0 ? 'Exacta' : mxn(Math.abs(v.diferencia))}</span>,
    },
  ] : [];
  return [
    {
      id: 'viaje', titulo: 'Viaje', principal: true,
      celda: (v) => {
        const ruta = v.origen && v.destino ? `${v.origen} → ${v.destino}` : v.origen ?? v.destino ?? null;
        return (
          <>
            <span className="font-medium block whitespace-nowrap">{v.folio}</span>
            <span className="rv-tl__sub">{ruta ?? 'sin ruta capturada'}</span>
          </>
        );
      },
    },
    { id: 'operador', titulo: 'Operador', celda: (v) => v.operadorNombre ?? <span className="rv-tl__tenue">Sin asignar</span> },
    { id: 'unidad', titulo: 'Unidad', corta: true, celda: (v) => (v.unidadEco ? <span className="cifra-mono">{v.unidadEco}</span> : <span className="rv-tl__tenue">—</span>) },
    { id: 'inicio', titulo: 'Inicio', corta: true, celda: (v) => <span className="rv-tl__apagado">{v.fechaInicio ? fechaMx(v.fechaInicio) : '—'}</span> },
    ...dinero,
    { id: 'aviso', titulo: 'Aviso', corta: true, celda: (v) => (v.estatus === 'liquidado' ? <span className="rv-tl__tenue">—</span> : <PillAviso v={v} />) },
    {
      id: 'estatus', titulo: 'Estatus', corta: true,
      celda: (v) => { const e = PILL_ESTATUS[v.estatus] ?? { etiqueta: v.estatus, estado: 'neutral' as Estado }; return <StatusPill estado={e.estado}>{e.etiqueta}</StatusPill>; },
    },
    {
      id: 'accion', titulo: 'Acción', alinear: 'der', tituloOculto: true,
      celda: (v) => v.liqId ? (
        <Link href={`/dashboard/${v.liqId}${sufijo}`}
          className="inline-flex items-center gap-1 text-[12.5px] font-medium hover:opacity-70 transition-opacity whitespace-nowrap rv-tl__enlace">
          Ver <ArrowRight width={12} height={12} strokeWidth={2} aria-hidden />
        </Link>
      ) : <span className="rv-tl__tenue">—</span>,
    },
  ];
}

/**
 * El Registro de Viajes (F2), v2: navegable, filtrable, buscable y paginado
 * (nunca más de `porPagina` filas por render). Los pesos solo se pintan
 * cuando la página los mandó (`verDinero`); para el jefe de tráfico las
 * tres columnas no existen, ni vacías.
 */
export function VistaViajes({
  filas, filtro, conteos, sufijo, importar, puedeImportar, verDinero, q, cursor, siguiente, hayMas, porPagina,
}: {
  filas: FilaRegistroViaje[];
  filtro: FiltroViajes;
  conteos: {
    total: number | null; abiertos: number | null; enCuadre: number | null;
    liquidados: number | null; escalados: number | null;
  };
  sufijo: string;
  importar: AccionImportar;

  /** Solo quien puede crear viajes ve el botón de importar. */
  puedeImportar: boolean;
  /** `puedeVerArea(rol, 'dinero')`, decidido en la página. */
  verDinero: boolean;
  q: string;
  /** Cursor de ESTA página (`null` = la primera). Solo decide si se ofrece
   *  "Volver al inicio": el contenido ya vino paginado del servidor. */
  cursor: string | null;
  /** Cursor de la página siguiente; `null` si no la hay. */
  siguiente: string | null;
  hayMas: boolean;
  porPagina: number;
}) {
  const conteo = (n: number | null): { valor: string; estado?: 'error'; reintentar?: boolean } => (n === null ? { valor: '—', estado: 'error', reintentar: true } : { valor: numero(n) });
  const params = new URLSearchParams(sufijo.startsWith('?') ? sufijo.slice(1) : sufijo);
  // Los filtros vigentes como chips quitables: el estado vive en la URL (sin JavaScript). Quitar uno conserva tenant/vista/rol y los demás.
  const vigentes = Object.fromEntries([...params.entries(), ...(filtro !== 'todos' ? [['f', filtro]] : []), ...(q ? [['q', q]] : [])]);
  const chips = chipsActivos('/dashboard/viajes', vigentes, [
    { param: 'f', etiqueta: 'Estado', omitir: ['todos'], rotuloValor: (v) => ROTULO_FILTRO[v as FiltroViajes] ?? v },
    { param: 'q', etiqueta: 'Búsqueda' },
  ]);

  return (
    <MarcoPagina titulo="Viajes" apoyo="El registro de viajes de tu flota, navegable y filtrable. Crear, asignar y avisar se hace en Despacho.">

      {/* Un conteo que no se pudo leer es `null`: NUNCA se pinta como 0. La celda dice «No disponible ahora. No es cero.» y ofrece Reintentar. */}
      <TiraCifras sello={selloHoy('Registro de viajes')}>
        <Cifra etiqueta="Viajes en total" {...conteo(conteos.total)} nota="histórico" />
        <Cifra etiqueta="Abiertos" {...conteo(conteos.abiertos)} />
        <Cifra etiqueta="En cuadre" {...conteo(conteos.enCuadre)} />
        <Cifra etiqueta="Escalados sin aceptar" {...conteo(conteos.escalados)}
          tono={(conteos.escalados ?? 0) > 0 ? 'bad' : undefined} />
      </TiraCifras>

      <section className="card p-4 relative">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            {(Object.keys(ROTULO_FILTRO) as FiltroViajes[]).map((f) => (
              <Link key={f} href={hrefRegistro(sufijo, { f, q })}
                className="px-2.5 h-7 inline-flex items-center rounded-lg text-[12px] font-medium transition-colors hairline"
                style={filtro === f
                  ? { background: 'var(--marca)', color: 'var(--marca-fg)', borderColor: 'var(--marca)' }
                  : { background: 'var(--surface)', color: 'var(--muted)' }}>
                {ROTULO_FILTRO[f]}
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* GET puro: la búsqueda vive en la URL y sobrevive a recargar,
                compartir y volver atrás. El sufijo y el filtro viajan como
                campos ocultos para no perderse al enviar. */}
            <form method="get" action="/dashboard/viajes" className="flex items-center gap-1.5" role="search">
              {[...params.entries()].map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
              {filtro !== 'todos' && <input type="hidden" name="f" value={filtro} />}
              <label className="relative">
                <span className="sr-only">Buscar viaje</span>
                <Search width={13} height={13} strokeWidth={1.75} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--faint)' }} aria-hidden />
                <input type="search" name="q" defaultValue={q} placeholder="Folio, origen o destino"
                  className="h-8 pl-8 pr-3 rounded-lg hairline text-[12.5px] w-[220px] max-w-full"
                  style={{ background: 'var(--surface)' }} />
              </label>
              <button type="submit" className={BTN_SEC} style={{ background: 'var(--surface)' }}>Buscar</button>
            </form>
            {puedeImportar && (
              // Sin JavaScript ni estado: `<details>` abre y cierra solo.
              // Cerrado es un botón secundario; abierto, el panel del
              // import aparece debajo de la barra, a lo ancho.
              <details className="group">
                <summary className={`${BTN_SEC} list-none cursor-pointer select-none`} style={{ background: 'var(--surface)' }}>
                  <FileUp width={13} height={13} strokeWidth={1.75} aria-hidden /> Importar desde tu TMS
                </summary>
                <div className="absolute left-0 right-0 z-10 mt-2 px-4">
                  <div className="card p-4 shadow-[var(--shadow-pop)]">
                    <h2 className="font-display text-[15px] font-semibold mb-2">Importar desde tu TMS</h2>
                    <ImportarViajes importar={importar} verDinero={verDinero} />
                  </div>
                </div>
              </details>
            )}
          </div>
        </div>

        <ChipsFiltro chips={chips} quitarTodosHref={hrefRegistro(sufijo, {})} className="mb-3" />

        {filas.length === 0 ? (
          <EstadoVacio icono={<Inbox width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
            {q
              ? `Ningún viaje coincide con «${q}»${filtro !== 'todos' ? ` en «${ROTULO_FILTRO[filtro]}»` : ''}.`
              : filtro === 'todos'
                ? 'Aún no hay viajes registrados — el primero que despaches aparece aquí.'
                : `Ningún viaje cae en «${ROTULO_FILTRO[filtro]}».`}
          </EstadoVacio>
        ) : (
          <TablaLista<FilaRegistroViaje>
            etiqueta="Registro de viajes"
            columnas={columnasViajes(sufijo, verDinero)}
            filas={filas}
            idFila={(v) => v.id}
            base="/dashboard/viajes"
            params={{}}
            pie={verDinero ? (
              <p className="rv-tl__nota">
                Diferencia en ámbar = sobrante a favor de la empresa; en rojo = faltante a favor del operador.
                Un guion en Comprobado es un viaje sin liquidación todavía.
              </p>
            ) : undefined}
          />
        )}

        {/* Paginación por CURSOR (escala 50k, 22-ago-2026): nunca más de
            `porPagina` filas por render. No se dice "página N de M":
            ni se cuenta el total de la consulta filtrada ni se numera —
            el cursor es la posición del último viaje visto, y "Siguientes"
            continúa desde ahí sin que la base relea lo anterior. Hacia
            atrás sirve el botón del navegador o "Volver al inicio". */}
        <div className="rv-tl__sellos">
          <SelloDato tipo="observado" fuente="Registro de viajes" leidoEn={ahoraMs()} edad={false} />
        </div>

        {(cursor || hayMas) && (
          <div className="flex items-center justify-between gap-3 mt-3 pt-3" style={{ borderTop: '1px dashed var(--line2)' }}>
            <span className="text-[11.5px]" style={{ color: 'var(--faint)' }}>
              Hasta {numero(porPagina)} viajes por página, del más reciente al más antiguo.
            </span>
            <NavPaginas>
              {cursor ? <EnlacePagina href={hrefRegistro(sufijo, { f: filtro, q })} direccion="inicio" /> : null}
              {hayMas && siguiente ? <EnlacePagina href={hrefRegistro(sufijo, { f: filtro, q, c: siguiente })} direccion="siguiente" /> : null}
            </NavPaginas>
          </div>
        )}
      </section>
    </MarcoPagina>
  );
}

