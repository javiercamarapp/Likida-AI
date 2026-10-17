import { FileDown } from 'lucide-react';
import { mxn, numero } from '@/lib/formato';
// SOLO tipos y módulos puros: la vista no debe arrastrar `supabaseAdmin` al bundle.
import type { ReporteRevision, ReclamoVista } from '@/lib/likida/peajes/revision_cobros';
import type { CierreMensual } from '@/lib/likida/peajes/cierre_mensual';
import type { ResumenSeguimiento } from '@/lib/likida/peajes/reclamos_seguimiento';
import { ETIQUETA_ESTADO_RECLAMO, PLAZO_RECLAMO_MESES } from '@/lib/likida/peajes/reclamos_seguimiento';
import {
  CATEGORIAS_COBRO, ETIQUETA_CATEGORIA_COBRO, ROTULO_CANDIDATO, type CategoriaCobro, type CandidatoCobro,
} from '@/lib/likida/peajes/reglas_cobro';
import { ETIQUETA_SENAL } from '@/lib/likida/peajes/cruces_atipicos';

// ═══════════════════════════════════════════════════════════════════════════
// LA REVISIÓN DE COBROS EN PANTALLA — lo que finanzas hace primero con el archivo
// del proveedor: ¿cada cobro es correcto?, ¿qué llegó tarde?, ¿qué no debía cruzarse?
//
// TODO lo que sale aquí es un CANDIDATO PARA VALIDAR CON EL PROVEEDOR: sin tarifario
// por caseta/clase ninguna regla puede afirmar que un monto esté mal. Cada candidato
// se explica en lenguaje llano: qué pasó / qué significa / qué hacer.
// ═══════════════════════════════════════════════════════════════════════════

type Accion = (fd: FormData) => Promise<void>;

export interface AccionesSeguimiento {
  crearReclamo: Accion; marcarEnviado: Accion; registrarNota: Accion; rechazar: Accion;
  /** «Justificar este cruce» (opcional: sin ella no se pinta el botón). */
  justificarCruce?: Accion;
}

const CSS_BOTON = 'inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-lg transition-opacity hover:opacity-85';
const ESTILO_PRIMARIO = { background: 'var(--marca)', color: 'var(--marca-fg)' } as const;
const CSS_SECUNDARIO = 'hairline text-[12.5px] font-medium px-3 py-1.5 rounded-lg transition-colors hover:bg-[var(--canvas)]';
const ESTILO_SECUNDARIO = { background: 'var(--surface)', color: 'var(--ink)' } as const;
const CSS_INPUT = 'hairline text-[12.5px] px-2.5 py-1.5 rounded-lg';
const ESTILO_INPUT = { background: 'var(--surface)', color: 'var(--ink)' } as const;
const ESTILO_CANDIDATO = { color: 'var(--warn)', background: 'var(--warnbg)' } as const;

/** Candidatos que se pintan por categoría; el resto va en el Excel (que trae TODOS). */
export const MAX_FILAS_POR_CATEGORIA = 100;

/** Qué significa la categoría, en general (cada candidato trae además su explicación). */
const EXPLICACION_CATEGORIA: Record<CategoriaCobro, string> = {
  unidad_inmovilizada: 'Cruces con el TAG de una unidad que la flota declaró en taller, siniestrada o de baja en esa fecha. Es la categoría más importante: basta teclear el número del TAG para pasar una caseta. Es un candidato a validar, no una acusación.',
  clase_fuera_de_3_5: 'Lo esperado es clase 3 (tracto solo) o 5 (tracto con caja de 2 ejes). Otra clase puede ser un error de clasificación del proveedor. La clase 1 suele ser la tarifa por pasada de algunas casetas: decláralas en «Reglas de cobro» para que no aparezcan.',
  extemporaneo: 'El cruce es anterior al periodo de este archivo: el proveedor lo cobró tarde. Hay que revisarlo junto con el mes en que ocurrió.',
  duplicado_exacto: 'Mismo TAG, mismo segundo, misma caseta y mismo importe. Dos cobros seguidos en minutos (posible retorno o reintento) se revisan aparte.',
  tag_dado_de_baja: 'Cruces posteriores a la fecha de baja del TAG (unidad siniestrada o TAG cancelado).',
  caseta_no_debe_cruzarse: 'Casetas que la flota marcó como «no debe cruzarse».',
};

function ExtraSufijo({ sufijo }: { sufijo: string }) {
  return <>{[...new URLSearchParams(sufijo.replace(/^\?/, '')).entries()].map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}</>;
}

function FilasCandidatos({ candidatos, justificar, desglose }: { candidatos: CandidatoCobro[]; justificar?: Accion; desglose?: string }) {
  const visibles = candidatos.slice(0, MAX_FILAS_POR_CATEGORIA);
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left" style={{ color: 'var(--faint)' }}>
              <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Fecha y hora</th>
              <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Caseta</th>
              <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">TAG / unidad</th>
              <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2 text-right">Clase</th>
              <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2 text-right">Importe</th>
              <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2 pl-3">Qué pasó · qué significa · qué hacer</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((c) => (
              <tr key={`${c.indice}-${c.categoria}`} className="border-t align-top" style={{ borderColor: 'var(--line2)' }}>
                <td className="py-2 whitespace-nowrap">{c.fecha ?? '—'}{c.hora && <span className="block text-[11px]" style={{ color: 'var(--faint)' }}>{c.hora}</span>}</td>
                <td className="py-2">{c.caseta ?? '—'}</td>
                <td className="py-2">{c.tag ?? '—'}{c.unidad && <span className="block text-[11px]" style={{ color: 'var(--muted)' }}>{c.unidad}</span>}</td>
                <td className="py-2 text-right cifra-mono">{c.clase ?? '—'}</td>
                <td className="py-2 text-right cifra-mono">{mxn(c.monto)}</td>
                <td className="py-2 pl-3 max-w-[40rem] space-y-1">
                  <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium" style={ESTILO_CANDIDATO}>{ROTULO_CANDIDATO}</span>
                  <p><b>Qué pasó:</b> {c.quePaso}</p>
                  <p style={{ color: 'var(--muted)' }}><b>Qué significa:</b> {c.queSignifica}</p>
                  <p style={{ color: 'var(--muted)' }}><b>Qué hacer:</b> {c.queHacer}</p>
                  {c.categoria === 'caseta_no_debe_cruzarse' && c.justificacion && (
                    <p><span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium hairline">Justificado</span> <b>Motivo:</b> {c.justificacion}</p>
                  )}
                  {c.categoria === 'caseta_no_debe_cruzarse' && !c.justificacion && justificar && desglose && (
                    <form action={justificar} className="flex items-end gap-2 flex-wrap pt-1">
                      <input type="hidden" name="desglose" value={desglose} />
                      <input type="hidden" name="indice" value={c.indice} />
                      <label className="block"><span className="etiqueta-mono text-[10px] uppercase block" style={{ color: 'var(--faint)' }}>Motivo</span>
                        <input name="motivo" required minLength={3} maxLength={300} placeholder="Salida de servicio autorizada" aria-label={`Motivo para justificar el cruce del renglón ${c.indice + 1}`}
                          className={`${CSS_INPUT} w-[240px] mt-0.5`} style={ESTILO_INPUT} /></label>
                      <button type="submit" className={CSS_SECUNDARIO} style={ESTILO_SECUNDARIO}>Justificar este cruce</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {candidatos.length > visibles.length && (
        <p className="text-[11.5px] mt-2" style={{ color: 'var(--muted)' }}>
          Se muestran los primeros {numero(visibles.length)} de {numero(candidatos.length)}; el Excel trae todos.
        </p>
      )}
    </>
  );
}

export function SeccionRevisionCobros({ revision, desglose, sufijo, justificarCruce }: { revision: ReporteRevision; desglose: string; sufijo: string; justificarCruce?: Accion }) {
  const ctx = sufijo ? `&${sufijo.slice(1)}` : '';
  const r = revision.revision;
  const cal = revision.calidad as {
    sinEncabezadoConDatos?: string[]; noReconocidas?: string[]; columnasFaltantes?: string[];
    lineasSinTag?: number; lineasSinUnidad?: number; lineasSinClase?: number; hojasIgnoradas?: string[]; hojaLeida?: string | null;
  } | null;
  const avisosCalidad: string[] = [];
  if (cal) {
    if ((cal.sinEncabezadoConDatos?.length ?? 0) > 0) avisosCalidad.push(`${cal.sinEncabezadoConDatos?.length} columnas sin encabezado con datos (${cal.sinEncabezadoConDatos?.join(', ')}) no se importan.`);
    if ((cal.columnasFaltantes?.length ?? 0) > 0) avisosCalidad.push(`El archivo no trae columna de: ${cal.columnasFaltantes?.join(', ')}.`);
    if ((cal.lineasSinTag ?? 0) > 0) avisosCalidad.push(`${numero(cal.lineasSinTag ?? 0)} líneas sin TAG.`);
    if ((cal.lineasSinUnidad ?? 0) > 0) avisosCalidad.push(`${numero(cal.lineasSinUnidad ?? 0)} líneas sin unidad.`);
    if ((cal.lineasSinClase ?? 0) > 0) avisosCalidad.push(`${numero(cal.lineasSinClase ?? 0)} líneas sin clase legible: no se les pudo validar la clase.`);
    if ((cal.hojasIgnoradas?.length ?? 0) > 0) avisosCalidad.push(`Se leyó solo la hoja «${cal.hojaLeida}»; «${cal.hojasIgnoradas?.join('», «')}» repite filas y leerla duplicaría cruces.`);
  }
  return (
    <section className="card p-4" id="revision-cobros">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display text-[15px] font-semibold">Revisión de cobros del archivo</h2>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--muted)' }}>
            {revision.archivoNombre ? `${revision.archivoNombre} · ` : ''}
            {revision.periodoOficialDesde && revision.periodoOficialHasta
              ? `Periodo ${revision.periodoOficialDesde} a ${revision.periodoOficialHasta} (${revision.periodoOrigen === 'declarado' ? 'declarado' : 'tomado del nombre del archivo'}) · `
              : 'Periodo del archivo no declarado · '}
            {numero(r.lineasRevisadas)} cruces · {mxn(r.montoRevisado)}
          </p>
          <span className="inline-flex mt-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium" style={ESTILO_CANDIDATO}>{ROTULO_CANDIDATO}</span>
        </div>
        <div className="text-right">
          <span className="etiqueta-mono text-[10px] uppercase block" style={{ color: 'var(--faint)' }}>Cruces con algún candidato</span>
          <span className="text-[20px] font-semibold cifra-mono">{numero(r.lineasConCandidato)}</span>
          <span className="text-[11px] ml-1.5" style={{ color: 'var(--muted)' }}>{mxn(r.montoConCandidato)}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        <a href={`/api/export/peajes-revision?desglose=${desglose}${ctx}`} className={CSS_BOTON} style={ESTILO_PRIMARIO}>
          <FileDown width={13} height={13} strokeWidth={2} /> Excel de la revisión
        </a>
        <a href={`/api/export/peajes-candidatos?desglose=${desglose}${ctx}`} className={CSS_SECUNDARIO} style={ESTILO_SECUNDARIO}>
          <FileDown width={13} height={13} strokeWidth={2} className="inline mr-1" /> Reporte para el portal del proveedor
        </a>
        <a href={`/api/export/peajes-candidatos?desglose=${desglose}&excluirReclamados=1${ctx}`} className={CSS_SECUNDARIO} style={ESTILO_SECUNDARIO}>
          Sin lo que ya reclamaste
        </a>
        <a href={`/api/export/peajes-candidatos?desglose=${desglose}&formato=csv${ctx}`} className={CSS_SECUNDARIO} style={ESTILO_SECUNDARIO}>
          CSV
        </a>
      </div>

      <p className="text-[11.5px] mt-3" style={{ color: 'var(--muted)' }}>
        Son candidatos, no cobros indebidos: sin el tarifario por caseta y clase ninguna regla puede afirmar que un monto esté mal. Valida cada uno con el proveedor por su portal (tienes {PLAZO_RECLAMO_MESES} meses desde el cobro para reclamar).
      </p>

      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2 mt-3">
        {CATEGORIAS_COBRO.map((c) => (
          <a key={c} href={`#cat-${c}`} className="rounded-lg hairline p-2.5 hover:bg-[var(--canvas)]">
            <span className="etiqueta-mono text-[10px] uppercase block" style={{ color: 'var(--faint)' }}>{ETIQUETA_CATEGORIA_COBRO[c]}</span>
            <span className="text-[15px] font-semibold cifra-mono">{numero(r.porCategoria[c].n)}</span>
            <span className="text-[11px] ml-1.5" style={{ color: 'var(--muted)' }}>{mxn(r.porCategoria[c].monto)}</span>
          </a>
        ))}
      </div>

      {r.reglasNoAplicadas.length > 0 && (
        <div role="note" className="mt-3 rounded-lg hairline p-3 text-[12px]" style={{ color: 'var(--muted)' }}>
          <b style={{ color: 'var(--ink)' }}>Reglas que no se pudieron aplicar a este archivo:</b>
          <ul className="mt-1 space-y-0.5">
            {r.reglasNoAplicadas.map((n) => <li key={n.regla}>{ETIQUETA_CATEGORIA_COBRO[n.regla]}: {n.motivo}</li>)}
          </ul>
        </div>
      )}
      {avisosCalidad.length > 0 && (
        <div role="note" className="mt-3 rounded-lg hairline p-3 text-[12px]" style={{ color: 'var(--muted)' }}>
          <b style={{ color: 'var(--ink)' }}>Calidad del archivo:</b>
          <ul className="mt-1 space-y-0.5">{avisosCalidad.map((a) => <li key={a}>{a}</li>)}</ul>
        </div>
      )}
      {r.sugerenciasPasada.length > 0 && (
        <div role="note" className="mt-3 rounded-lg hairline p-3 text-[12px]" style={{ color: 'var(--muted)' }}>
          <b style={{ color: 'var(--ink)' }}>¿Tarifa por pasada?</b> En estas casetas casi todos los cruces son clase 1: {r.sugerenciasPasada.map((s) => `${s.caseta} (${numero(s.cruces)})`).join(', ')}.
          Si cobran por pasada, decláralo en «Reglas de cobro» (Configuración) y dejarán de aparecer como candidatos.
        </div>
      )}

      {CATEGORIAS_COBRO.map((c) => {
        const lista = r.candidatos.filter((x) => x.categoria === c);
        if (lista.length === 0) return null;
        return (
          <details key={c} id={`cat-${c}`} className="mt-4" open={lista.length <= 10}>
            <summary className="cursor-pointer text-[13px] font-semibold">
              {ETIQUETA_CATEGORIA_COBRO[c]} · {numero(lista.length)} · {mxn(r.porCategoria[c].monto)}
            </summary>
            <p className="text-[12px] my-2" style={{ color: 'var(--muted)' }}>{EXPLICACION_CATEGORIA[c]}</p>
            <FilasCandidatos candidatos={lista} justificar={justificarCruce} desglose={desglose} />
          </details>
        );
      })}

      {revision.atipicos.atipicos.length > 0 && (
        <details className="mt-4" id="atipicos">
          <summary className="cursor-pointer text-[13px] font-semibold">Cruces atípicos · {numero(revision.atipicos.atipicos.length)}</summary>
          <p className="text-[12px] my-2" style={{ color: 'var(--muted)' }}>Patrones poco comunes de una misma unidad. Son avisos para el despacho, no cobros indebidos confirmados.</p>
          <ul className="space-y-2 text-[12.5px]">
            {revision.atipicos.atipicos.slice(0, MAX_FILAS_POR_CATEGORIA).map((a) => (
              <li key={`${a.senal}-${a.indices.join('-')}`} className="rounded-lg hairline p-2.5 space-y-1">
                <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium" style={ESTILO_CANDIDATO}>{ETIQUETA_SENAL[a.senal]} · {ROTULO_CANDIDATO}</span>
                <p><b>Qué pasó:</b> {a.quePaso}</p>
                <p style={{ color: 'var(--muted)' }}><b>Qué significa:</b> {a.queSignifica}</p>
                <p style={{ color: 'var(--muted)' }}><b>Qué hacer:</b> {a.queHacer}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
      {revision.atipicos.noAplicadas.length > 0 && (
        <p className="text-[11.5px] mt-3" style={{ color: 'var(--faint)' }}>
          Señales de cruces atípicos sin aplicar: {revision.atipicos.noAplicadas.map((n) => `${ETIQUETA_SENAL[n.senal]} (${n.motivo})`).join(' · ')}
        </p>
      )}
    </section>
  );
}

// ── El cierre mensual ───────────────────────────────────────────────────────

export function SeccionCierreMensual({ mes, cierre, error, sufijo, desglose }: {
  mes: string | null; cierre: CierreMensual | null; error: boolean; sufijo: string; desglose: string | null;
}) {
  return (
    <section className="card p-4" id="cierre-mensual">
      <h2 className="font-display text-[15px] font-semibold">Cierre mensual</h2>
      <p className="text-[12px] mt-0.5" style={{ color: 'var(--muted)' }}>
        Junta las tres decenas de un mes (y compara los cobros tardíos con el mes anterior si también lo subiste). Un mes con una decena faltante se dice incompleto.
      </p>
      <form method="get" className="flex items-end gap-2 flex-wrap mt-3">
        <ExtraSufijo sufijo={sufijo} />
        {desglose && <input type="hidden" name="desglose" value={desglose} />}
        <label className="block">
          <span className="etiqueta-mono text-[10px] uppercase block" style={{ color: 'var(--faint)' }}>Mes (AAAA-MM)</span>
          <input name="mes" defaultValue={mes ?? ''} placeholder="2026-09" pattern="\d{4}-(0[1-9]|1[0-2])" required className={`${CSS_INPUT} w-[120px] mt-0.5`} style={ESTILO_INPUT} />
        </label>
        <button type="submit" className={CSS_BOTON} style={ESTILO_PRIMARIO}>Ver el mes</button>
      </form>
      {error && <p role="alert" className="text-[12.5px] mt-3" style={{ color: 'var(--bad)' }}>No se pudo armar el cierre ahora mismo. No es que no haya cobros: inténtalo de nuevo.</p>}
      {cierre && (
        <div className="mt-3 space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <span className="text-[13px] font-semibold">{cierre.mes}</span>
              <span className="inline-flex ml-2 px-2 py-0.5 rounded-full text-[11px] font-medium"
                style={cierre.completo ? { color: 'var(--ok)', background: 'var(--okbg)' } : { color: 'var(--warn)', background: 'var(--warnbg)' }}>
                {cierre.completo ? 'Mes completo' : 'Mes incompleto'}
              </span>
            </div>
            <div className="text-right">
              <span className="text-[18px] font-semibold cifra-mono">{numero(cierre.cruces)}</span> cruces · <span className="cifra-mono">{mxn(cierre.monto)}</span>
            </div>
          </div>
          <div className="grid sm:grid-cols-3 gap-2">
            {cierre.decenas.map((d) => (
              <div key={d.etiqueta} className="rounded-lg hairline p-2.5">
                <span className="etiqueta-mono text-[10px] uppercase block" style={{ color: 'var(--faint)' }}>Decena {d.etiqueta}</span>
                {d.cubierta
                  ? <><span className="text-[15px] font-semibold cifra-mono">{numero(d.cruces)}</span><span className="text-[11px] ml-1.5" style={{ color: 'var(--muted)' }}>{mxn(d.monto)}</span></>
                  : <span className="text-[12.5px]" style={{ color: 'var(--bad)' }}>Falta el archivo</span>}
              </div>
            ))}
          </div>
          <p className="text-[12.5px]">
            Cobros tardíos (candidatos: validar con el proveedor): {numero(cierre.tardiosMesAnterior.n)} del mes anterior ({mxn(cierre.tardiosMesAnterior.monto)}) y {numero(cierre.tardiosDecenaAnterior.n)} de una decena anterior de este mes ({mxn(cierre.tardiosDecenaAnterior.monto)}).
            {cierre.repetidosEntreArchivos.length > 0 && <> <b>{numero(cierre.repetidosEntreArchivos.length)} cobros aparecen en más de un archivo.</b></>}
          </p>
          {cierre.avisos.length > 0 && (
            <ul className="text-[12px] space-y-0.5" style={{ color: 'var(--muted)' }}>{cierre.avisos.map((a) => <li key={a}>{a}</li>)}</ul>
          )}
        </div>
      )}
    </section>
  );
}

// ── El seguimiento de reclamos y notas de crédito ───────────────────────────

const COLOR_ALERTA: Record<ReclamoVista['evaluacion']['alerta'], { color: string; background: string }> = {
  ok: { color: 'var(--ok)', background: 'var(--okbg)' },
  por_vencer: { color: 'var(--warn)', background: 'var(--warnbg)' },
  vencido: { color: 'var(--bad)', background: 'var(--badbg)' },
  cerrado: { color: 'var(--muted)', background: 'var(--canvas)' },
};
const ROTULO_ALERTA: Record<ReclamoVista['evaluacion']['alerta'], string> = { ok: 'En plazo', por_vencer: 'Por vencer', vencido: 'Vencido', cerrado: 'Cerrado' };

export function SeccionSeguimiento({ reclamos, resumen, acciones, desglose, revision, error }: {
  reclamos: ReclamoVista[] | null; resumen: ResumenSeguimiento | null; acciones: AccionesSeguimiento; desglose: string | null;
  revision: ReporteRevision | null; error: boolean;
}) {
  const conCandidatos = revision ? CATEGORIAS_COBRO.filter((c) => revision.revision.porCategoria[c].n > 0) : [];
  return (
    <section className="card p-4" id="seguimiento">
      <h2 className="font-display text-[15px] font-semibold">Seguimiento de reclamos y notas de crédito</h2>
      <p className="text-[12px] mt-0.5" style={{ color: 'var(--muted)' }}>
        El proveedor no atiende por teléfono: se reclama por su portal y, si procede, devuelve una nota de crédito sin detalle. Aquí queda qué reclamaste, qué te acreditaron y cuánto falta.
        El plazo es de {PLAZO_RECLAMO_MESES} meses desde el cobro más antiguo del reclamo (regla dicha por el cliente: confírmala con el proveedor).
      </p>
      {error && <p role="alert" className="text-[12.5px] mt-3" style={{ color: 'var(--bad)' }}>No se pudo leer el seguimiento ahora mismo. No es que no haya reclamos: inténtalo de nuevo.</p>}
      {resumen && reclamos && (
        <p className="text-[12.5px] mt-3">
          {numero(resumen.reclamos)} reclamos · reclamado {mxn(resumen.montoReclamado)} · acreditado {mxn(resumen.montoAcreditado)} · <b>por acreditar {mxn(resumen.pendienteAcreditar)}</b>
          {resumen.porVencer > 0 && <> · <span style={{ color: 'var(--warn)' }}>{numero(resumen.porVencer)} por vencer</span></>}
          {resumen.vencidos > 0 && <> · <span style={{ color: 'var(--bad)' }}>{numero(resumen.vencidos)} vencidos</span></>}
        </p>
      )}
      {reclamos && reclamos.length === 0 && <p className="text-[12.5px] mt-2" style={{ color: 'var(--muted)' }}>Aún no registras reclamos.</p>}
      {reclamos && reclamos.length > 0 && (
        <div className="space-y-2 mt-3">
          {reclamos.map((r) => (
            <div key={r.id} className="rounded-lg hairline p-3 text-[12.5px] space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium">{(CATEGORIAS_COBRO as readonly string[]).includes(r.categoria) ? ETIQUETA_CATEGORIA_COBRO[r.categoria as CategoriaCobro] : r.categoria}</span>
                <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium" style={COLOR_ALERTA[r.evaluacion.alerta]}>{ROTULO_ALERTA[r.evaluacion.alerta]}</span>
                <span style={{ color: 'var(--muted)' }}>{ETIQUETA_ESTADO_RECLAMO[r.estado]}</span>
                {r.referenciaPortal && <span className="cifra-mono text-[11.5px]" style={{ color: 'var(--faint)' }}>Folio {r.referenciaPortal}</span>}
              </div>
              <p>
                {numero(r.nCruces)} cruces · reclamado {mxn(r.montoReclamado)} · acreditado {mxn(r.montoAcreditado)}
                {r.evaluacion.pctAcreditado !== null && ` (${r.evaluacion.pctAcreditado}%)`} · cobro más antiguo {r.fechaCobroMasAntiguo} · vence {r.evaluacion.fechaLimite}
              </p>
              <p style={{ color: 'var(--muted)' }}>{r.evaluacion.mensaje}</p>
              {r.estado === 'preparado' && (
                <form action={acciones.marcarEnviado} className="flex items-end gap-2 flex-wrap">
                  <input type="hidden" name="reclamo" value={r.id} />
                  <label className="block"><span className="etiqueta-mono text-[10px] uppercase block" style={{ color: 'var(--faint)' }}>Enviado el</span>
                    <input type="date" name="enviado_en" required className={`${CSS_INPUT} mt-0.5`} style={ESTILO_INPUT} /></label>
                  <label className="block"><span className="etiqueta-mono text-[10px] uppercase block" style={{ color: 'var(--faint)' }}>Folio del portal (opc.)</span>
                    <input name="referencia" maxLength={120} className={`${CSS_INPUT} w-[160px] mt-0.5`} style={ESTILO_INPUT} /></label>
                  <button type="submit" className={CSS_BOTON} style={ESTILO_PRIMARIO}>Marcar como enviado</button>
                </form>
              )}
              {(r.estado === 'enviado' || r.estado === 'acreditado_parcial') && (
                <div className="flex gap-3 flex-wrap items-end">
                  <form action={acciones.registrarNota} className="flex items-end gap-2 flex-wrap">
                    <input type="hidden" name="reclamo" value={r.id} />
                    <label className="block"><span className="etiqueta-mono text-[10px] uppercase block" style={{ color: 'var(--faint)' }}>Nota de crédito (MXN)</span>
                      <input name="monto" inputMode="decimal" required className={`${CSS_INPUT} w-[120px] mt-0.5`} style={ESTILO_INPUT} /></label>
                    <label className="block"><span className="etiqueta-mono text-[10px] uppercase block" style={{ color: 'var(--faint)' }}>Fecha</span>
                      <input type="date" name="fecha" required className={`${CSS_INPUT} mt-0.5`} style={ESTILO_INPUT} /></label>
                    <label className="block"><span className="etiqueta-mono text-[10px] uppercase block" style={{ color: 'var(--faint)' }}>Folio de la nota (opc.)</span>
                      <input name="referencia" maxLength={120} className={`${CSS_INPUT} w-[140px] mt-0.5`} style={ESTILO_INPUT} /></label>
                    <button type="submit" className={CSS_BOTON} style={ESTILO_PRIMARIO}>Registrar nota de crédito</button>
                  </form>
                  <form action={acciones.rechazar}>
                    <input type="hidden" name="reclamo" value={r.id} />
                    <button type="submit" className={CSS_SECUNDARIO} style={ESTILO_SECUNDARIO}>El proveedor lo rechazó</button>
                  </form>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {desglose && conCandidatos.length > 0 && (
        <form action={acciones.crearReclamo} className="flex items-end gap-2 flex-wrap mt-4">
          <input type="hidden" name="desglose" value={desglose} />
          <label className="block"><span className="etiqueta-mono text-[10px] uppercase block" style={{ color: 'var(--faint)' }}>Registrar reclamo de</span>
            <select name="categoria" required className={`${CSS_INPUT} mt-0.5`} style={ESTILO_INPUT}>
              {conCandidatos.map((c) => <option key={c} value={c}>{ETIQUETA_CATEGORIA_COBRO[c]} ({numero(revision?.revision.porCategoria[c].n ?? 0)})</option>)}
            </select></label>
          <label className="block"><span className="etiqueta-mono text-[10px] uppercase block" style={{ color: 'var(--faint)' }}>Enviado el (si ya lo enviaste)</span>
            <input type="date" name="enviado_en" className={`${CSS_INPUT} mt-0.5`} style={ESTILO_INPUT} /></label>
          <label className="block"><span className="etiqueta-mono text-[10px] uppercase block" style={{ color: 'var(--faint)' }}>Folio del portal (opc.)</span>
            <input name="referencia" maxLength={120} className={`${CSS_INPUT} w-[150px] mt-0.5`} style={ESTILO_INPUT} /></label>
          <button type="submit" className={CSS_BOTON} style={ESTILO_PRIMARIO}>Registrar reclamo</button>
        </form>
      )}
      {desglose && conCandidatos.length > 0 && (
        <p className="text-[11px] mt-1.5" style={{ color: 'var(--faint)' }}>El número de cruces, el importe y el cobro más antiguo se toman de los candidatos de la categoría, no de lo que escribas.</p>
      )}
    </section>
  );
}
