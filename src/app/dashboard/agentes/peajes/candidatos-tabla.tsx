import { FileDown } from 'lucide-react';
import { fechaMx, mxn, numero } from '@/lib/formato';
// SOLO tipos y módulos puros: la vista no debe arrastrar `supabaseAdmin` al bundle.
import {
  ESTADOS_CANDIDATO, ETIQUETA_ESTADO_CANDIDATO, TAMANO_PAGINA, TODAS_LAS_CATEGORIAS, aplicaAccion, etiquetaCategoriaFila, filtrosAQuery,
  type AccionCandidato, type EstadoCandidato, type FilaCandidato, type TablaCandidatos,
} from '@/lib/likida/peajes/candidatos_tabla';
import { ROTULO_CANDIDATO } from '@/lib/likida/peajes/reglas_cobro';

// ═══════════════════════════════════════════════════════════════════════════
// LA TABLA DE CANDIDATOS CON SUS ACCIONES (T-A2-28): una página de a lo más 50 filas, con filtros por
// categoría, estado, unidad, caseta y fecha; totales de TODO lo que cumple el filtro; y por fila (o por
// lote, con confirmación) reclamar, descartar o justificar. Son CANDIDATOS a validar con el proveedor.
// ═══════════════════════════════════════════════════════════════════════════

export type AccionDecidir = (fd: FormData) => Promise<void>;

const CSS_BOTON = 'inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-lg transition-opacity hover:opacity-85';
const ESTILO_PRIMARIO = { background: 'var(--marca)', color: 'var(--marca-fg)' } as const;
const CSS_SECUNDARIO = 'hairline text-[12.5px] font-medium px-3 py-1.5 rounded-lg transition-colors hover:bg-[var(--canvas)]';
const ESTILO_SECUNDARIO = { background: 'var(--surface)', color: 'var(--ink)' } as const;
const CSS_INPUT = 'hairline text-[12.5px] px-2.5 py-1.5 rounded-lg';
const ESTILO_INPUT = { background: 'var(--surface)', color: 'var(--ink)' } as const;
const ESTILO_CANDIDATO = { color: 'var(--warn)', background: 'var(--warnbg)' } as const;
const COLOR_ESTADO: Record<EstadoCandidato, { color: string; background: string }> = {
  pendiente: { color: 'var(--warn)', background: 'var(--warnbg)' },
  reclamado: { color: 'var(--ok)', background: 'var(--okbg)' },
  descartado: { color: 'var(--muted)', background: 'var(--canvas)' },
  justificado: { color: 'var(--muted)', background: 'var(--canvas)' },
};
const ROTULO_ACCION: Record<AccionCandidato, string> = { reclamado: 'Marcar como reclamado', descartado: 'Descartar', justificado: 'Justificar' };
const ROTULO_LOTE: Record<AccionCandidato, string> = { reclamado: 'Marcar como reclamados', descartado: 'Descartar', justificado: 'Justificar' };

const Etiqueta = ({ children }: { children: React.ReactNode }) => (
  <span className="etiqueta-mono text-[10px] uppercase block" style={{ color: 'var(--faint)' }}>{children}</span>
);

function ExtraSufijo({ sufijo }: { sufijo: string }) {
  return <>{[...new URLSearchParams(sufijo.replace(/^\?/, '')).entries()].map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}</>;
}

function Campos({ desglose, retorno, accion, indice, categoria }: { desglose: string; retorno: string; accion: AccionCandidato; indice: number; categoria: string }) {
  return (
    <>
      <input type="hidden" name="desglose" value={desglose} />
      <input type="hidden" name="retorno" value={retorno} />
      <input type="hidden" name="modo" value="fila" />
      <input type="hidden" name="accion" value={accion} />
      <input type="hidden" name="indice" value={indice} />
      <input type="hidden" name="categoria" value={categoria} />
    </>
  );
}

function AccionesDeFila({ f, desglose, retorno, decidir }: { f: FilaCandidato; desglose: string; retorno: string; decidir: AccionDecidir }) {
  if (f.estado !== 'pendiente') {
    return (
      <div className="space-y-0.5">
        <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium" style={COLOR_ESTADO[f.estado]}>{ETIQUETA_ESTADO_CANDIDATO[f.estado]}</span>
        {f.motivo && <p className="text-[11.5px]"><b>Motivo:</b> {f.motivo}</p>}
        {f.actor && f.decididoEn && <p className="text-[11px]" style={{ color: 'var(--faint)' }}>{f.actor} · {fechaMx(f.decididoEn)}</p>}
      </div>
    );
  }
  const puedeReclamar = aplicaAccion(f, 'reclamado').ok;
  return (
    <div className="space-y-1.5">
      <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium" style={COLOR_ESTADO.pendiente}>{ETIQUETA_ESTADO_CANDIDATO.pendiente}</span>
      {puedeReclamar && (
        <form action={decidir}>
          <Campos desglose={desglose} retorno={retorno} accion="reclamado" indice={f.indice} categoria={f.categoria} />
          <button type="submit" className={CSS_BOTON} style={ESTILO_PRIMARIO}>{ROTULO_ACCION.reclamado}</button>
        </form>
      )}
      {(['descartado', 'justificado'] as const).map((a) => (
        <form key={a} action={decidir} className="flex items-end gap-1.5 flex-wrap">
          <Campos desglose={desglose} retorno={retorno} accion={a} indice={f.indice} categoria={f.categoria} />
          <input name="motivo" required minLength={3} maxLength={300} placeholder={a === 'descartado' ? 'Por qué se descarta' : 'Por qué está justificado'}
            aria-label={`Motivo para ${a === 'descartado' ? 'descartar' : 'justificar'} el renglón ${f.indice + 1} (${etiquetaCategoriaFila(f.categoria)})`}
            className={`${CSS_INPUT} w-[170px]`} style={ESTILO_INPUT} />
          <button type="submit" className={CSS_SECUNDARIO} style={ESTILO_SECUNDARIO}>{ROTULO_ACCION[a]}</button>
        </form>
      ))}
    </div>
  );
}

function Lote({ tabla, desglose, retorno, decidir, aplicables }: {
  tabla: TablaCandidatos; desglose: string; retorno: string; decidir: AccionDecidir; aplicables: Record<AccionCandidato, number>;
}) {
  const f = tabla.filtros;
  const hay = (['reclamado', 'descartado', 'justificado'] as const).some((a) => aplicables[a] > 0);
  if (!hay) return null;
  return (
    <div className="mt-4 rounded-lg hairline p-3 space-y-3" id="lote-candidatos">
      <p className="text-[12.5px]"><b>Acciones en lote</b> sobre todo lo que cumple el filtro actual (no solo esta página). Cada una pide confirmación con el número de cruces.</p>
      {(['reclamado', 'descartado', 'justificado'] as const).map((a) => aplicables[a] > 0 && (
        <form key={a} action={decidir} className="flex items-end gap-2 flex-wrap">
          <input type="hidden" name="desglose" value={desglose} />
          <input type="hidden" name="retorno" value={retorno} />
          <input type="hidden" name="modo" value="filtro" />
          <input type="hidden" name="accion" value={a} />
          <input type="hidden" name="esperado" value={aplicables[a]} />
          <input type="hidden" name="f_cat" value={f.categoria} />
          <input type="hidden" name="f_estado" value={f.estado} />
          <input type="hidden" name="f_unidad" value={f.unidad} />
          <input type="hidden" name="f_caseta" value={f.caseta} />
          <input type="hidden" name="f_desde" value={f.desde} />
          <input type="hidden" name="f_hasta" value={f.hasta} />
          <input type="hidden" name="f_orden" value={f.orden} />
          {a === 'reclamado'
            ? <label className="block"><Etiqueta>Enviado el (si ya lo enviaste)</Etiqueta><input type="date" name="enviado_en" className={`${CSS_INPUT} mt-0.5`} style={ESTILO_INPUT} /></label>
            : <label className="block"><Etiqueta>Motivo</Etiqueta><input name="motivo" required minLength={3} maxLength={300} aria-label={`Motivo para ${a === 'descartado' ? 'descartar' : 'justificar'} en lote`} className={`${CSS_INPUT} w-[220px] mt-0.5`} style={ESTILO_INPUT} /></label>}
          <label className="flex items-center gap-1.5 text-[12.5px]">
            <input type="checkbox" name="confirmar" required /> Confirmo: {ROTULO_LOTE[a].toLowerCase()} {numero(aplicables[a])} {aplicables[a] === 1 ? 'cruce' : 'cruces'}
          </label>
          <button type="submit" className={a === 'reclamado' ? CSS_BOTON : CSS_SECUNDARIO} style={a === 'reclamado' ? ESTILO_PRIMARIO : ESTILO_SECUNDARIO}>
            {ROTULO_LOTE[a]} ({numero(aplicables[a])})
          </button>
        </form>
      ))}
    </div>
  );
}

export function TablaCandidatosCobros({ tabla, error, desglose, sufijo, decidir, aplicables }: {
  tabla: TablaCandidatos | null; error: boolean; desglose: string; sufijo: string;
  /** Sin ella la tabla es de solo lectura (sin botones). */
  decidir?: AccionDecidir;
  /** Cuántas filas tocaría cada acción en lote con el filtro actual (el número que se confirma). */
  aplicables?: Record<AccionCandidato, number>;
}) {
  const ctx = sufijo ? `&${sufijo.slice(1)}` : '';
  if (error || !tabla) {
    return (
      <section className="card p-4" id="candidatos">
        <h2 className="font-display text-[15px] font-semibold">Candidatos del archivo</h2>
        <p role="alert" className="text-[12.5px] mt-3" style={{ color: 'var(--bad)' }}>No se pudo leer la tabla de candidatos ahora mismo. No es que no haya candidatos: inténtalo de nuevo.</p>
      </section>
    );
  }
  const f = tabla.filtros;
  const retorno = filtrosAQuery(f);
  const enlace = (pag: number) => `?${new URLSearchParams([...new URLSearchParams(sufijo.replace(/^\?/, '')).entries(), ['desglose', desglose], ...new URLSearchParams(filtrosAQuery({ ...f, pagina: 1 }, false)).entries(), ...(pag > 1 ? [['pag', String(pag)] as [string, string]] : [])]).toString()}#candidatos`;
  const desde = tabla.total === 0 ? 0 : (tabla.pagina - 1) * TAMANO_PAGINA + 1;
  const hasta = Math.min(tabla.total, tabla.pagina * TAMANO_PAGINA);
  const hayFiltro = f.categoria !== '' || f.estado !== '' || f.unidad !== '' || f.caseta !== '' || f.desde !== '' || f.hasta !== '';
  return (
    <section className="card p-4" id="candidatos">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display text-[15px] font-semibold">Candidatos del archivo</h2>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--muted)' }}>
            Decide qué hacer con cada cruce señalado: reclamarlo al proveedor, descartarlo o justificarlo (siempre con motivo). Nada de esto cambia lo que el proveedor te cobró.
          </p>
          <span className="inline-flex mt-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium" style={ESTILO_CANDIDATO}>{ROTULO_CANDIDATO}</span>
        </div>
        <div className="text-right">
          <Etiqueta>{hayFiltro ? 'Cruces con este filtro' : 'Cruces candidatos'}</Etiqueta>
          <span className="text-[20px] font-semibold cifra-mono">{numero(tabla.total)}</span>
          <span className="text-[11px] ml-1.5" style={{ color: 'var(--muted)' }}>{mxn(tabla.monto)}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        {ESTADOS_CANDIDATO.map((e) => (
          <span key={e} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11.5px] font-medium" style={COLOR_ESTADO[e]}>
            {ETIQUETA_ESTADO_CANDIDATO[e]} · {numero(tabla.porEstado[e].n)} · {mxn(tabla.porEstado[e].monto)}
          </span>
        ))}
        <a href={`/api/export/peajes-candidatos?desglose=${desglose}${ctx}`} className={CSS_SECUNDARIO} style={ESTILO_SECUNDARIO}>
          <FileDown width={13} height={13} strokeWidth={2} className="inline mr-1" /> Reporte para el portal del proveedor
        </a>
      </div>

      <form method="get" action="#candidatos" className="flex items-end gap-2 flex-wrap mt-3">
        <ExtraSufijo sufijo={sufijo} />
        <input type="hidden" name="desglose" value={desglose} />
        <label className="block"><Etiqueta>Categoría</Etiqueta>
          <select name="cat" defaultValue={f.categoria} className={`${CSS_INPUT} mt-0.5`} style={ESTILO_INPUT}>
            <option value="">Todas</option>
            {TODAS_LAS_CATEGORIAS.map((c) => <option key={c} value={c}>{etiquetaCategoriaFila(c)}</option>)}
          </select></label>
        <label className="block"><Etiqueta>Estado</Etiqueta>
          <select name="estado" defaultValue={f.estado} className={`${CSS_INPUT} mt-0.5`} style={ESTILO_INPUT}>
            <option value="">Todos</option>
            {ESTADOS_CANDIDATO.map((e) => <option key={e} value={e}>{ETIQUETA_ESTADO_CANDIDATO[e]}</option>)}
          </select></label>
        <label className="block"><Etiqueta>Unidad</Etiqueta>
          <input name="unidad" defaultValue={f.unidad} maxLength={60} className={`${CSS_INPUT} w-[110px] mt-0.5`} style={ESTILO_INPUT} /></label>
        <label className="block"><Etiqueta>Caseta</Etiqueta>
          <input name="caseta" defaultValue={f.caseta} maxLength={60} className={`${CSS_INPUT} w-[150px] mt-0.5`} style={ESTILO_INPUT} /></label>
        <label className="block"><Etiqueta>Desde</Etiqueta>
          <input type="date" name="desde" defaultValue={f.desde} className={`${CSS_INPUT} mt-0.5`} style={ESTILO_INPUT} /></label>
        <label className="block"><Etiqueta>Hasta</Etiqueta>
          <input type="date" name="hasta" defaultValue={f.hasta} className={`${CSS_INPUT} mt-0.5`} style={ESTILO_INPUT} /></label>
        <label className="block"><Etiqueta>Orden</Etiqueta>
          <select name="orden" defaultValue={f.orden} className={`${CSS_INPUT} mt-0.5`} style={ESTILO_INPUT}>
            <option value="monto_desc">Mayor monto primero</option>
            <option value="monto_asc">Menor monto primero</option>
            <option value="fecha">Por fecha</option>
          </select></label>
        <button type="submit" className={CSS_BOTON} style={ESTILO_PRIMARIO}>Filtrar</button>
        {hayFiltro && <a href={`?${new URLSearchParams([...new URLSearchParams(sufijo.replace(/^\?/, '')).entries(), ['desglose', desglose]]).toString()}#candidatos`} className={CSS_SECUNDARIO} style={ESTILO_SECUNDARIO}>Quitar filtros</a>}
      </form>

      {tabla.total === 0 ? (
        <p className="text-[12.5px] mt-4" style={{ color: 'var(--muted)' }}>
          {hayFiltro ? 'Ningún candidato cumple este filtro. Quita algún filtro para ver más.' : 'Este archivo no tiene candidatos que revisar.'}
        </p>
      ) : (
        <>
          <p className="text-[11.5px] mt-3" style={{ color: 'var(--muted)' }}>
            Mostrando {numero(desde)}–{numero(hasta)} de {numero(tabla.total)}. Las páginas son de {TAMANO_PAGINA}: el archivo completo viaja en el Excel.
          </p>
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left" style={{ color: 'var(--faint)' }}>
                  <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Fecha y hora</th>
                  <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Categoría</th>
                  <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Caseta</th>
                  <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">TAG / unidad</th>
                  <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2 text-right">Clase</th>
                  <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2 text-right">Importe</th>
                  <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2 pl-3">Qué pasó</th>
                  <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2 pl-3">Acción</th>
                </tr>
              </thead>
              <tbody>
                {tabla.filas.map((c) => (
                  <tr key={c.clave} className="border-t align-top" style={{ borderColor: 'var(--line2)' }}>
                    <td className="py-2 whitespace-nowrap">{c.fecha ?? '—'}{c.hora && <span className="block text-[11px]" style={{ color: 'var(--faint)' }}>{c.hora}</span>}</td>
                    <td className="py-2">{c.etiquetaCategoria}{c.critica && <span className="block text-[11px] font-medium" style={{ color: 'var(--bad)' }}>Crítico</span>}</td>
                    <td className="py-2">{c.caseta ?? '—'}</td>
                    <td className="py-2">{c.tag ?? '—'}{c.unidad && <span className="block text-[11px]" style={{ color: 'var(--muted)' }}>{c.unidad}</span>}</td>
                    <td className="py-2 text-right cifra-mono">{c.clase ?? '—'}</td>
                    <td className="py-2 text-right cifra-mono">{mxn(c.monto)}</td>
                    <td className="py-2 pl-3 max-w-[28rem]">
                      <p>{c.quePaso}</p>
                      <details className="mt-0.5">
                        <summary className="cursor-pointer text-[11.5px]" style={{ color: 'var(--muted)' }}>Qué significa y qué hacer</summary>
                        <p className="text-[12px]" style={{ color: 'var(--muted)' }}><b>Qué significa:</b> {c.queSignifica}</p>
                        <p className="text-[12px]" style={{ color: 'var(--muted)' }}><b>Qué hacer:</b> {c.queHacer}</p>
                      </details>
                    </td>
                    <td className="py-2 pl-3 min-w-[15rem]">
                      {decidir
                        ? <AccionesDeFila f={c} desglose={desglose} retorno={retorno} decidir={decidir} />
                        : <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium" style={COLOR_ESTADO[c.estado]}>{ETIQUETA_ESTADO_CANDIDATO[c.estado]}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {tabla.paginas > 1 && (
            <nav aria-label="Páginas de candidatos" className="flex items-center gap-3 mt-3 text-[12.5px]">
              {tabla.pagina > 1 ? <a href={enlace(tabla.pagina - 1)} className={CSS_SECUNDARIO} style={ESTILO_SECUNDARIO}>← Anterior</a> : <span style={{ color: 'var(--faint)' }}>← Anterior</span>}
              <span>Página {numero(tabla.pagina)} de {numero(tabla.paginas)}</span>
              {tabla.pagina < tabla.paginas ? <a href={enlace(tabla.pagina + 1)} className={CSS_SECUNDARIO} style={ESTILO_SECUNDARIO}>Siguiente →</a> : <span style={{ color: 'var(--faint)' }}>Siguiente →</span>}
            </nav>
          )}
        </>
      )}
      {decidir && aplicables && <Lote tabla={tabla} desglose={desglose} retorno={retorno} decidir={decidir} aplicables={aplicables} />}
    </section>
  );
}
