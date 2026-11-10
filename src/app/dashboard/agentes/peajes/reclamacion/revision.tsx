import { FileDown } from 'lucide-react';
import {
  Boton, BotonEnlace, BarraFiltros, CampoFecha, CampoTexto, FiltroCampo, FiltroOpciones, Icono, StatusChip, TablaBase, Tarjeta, type TonoEstado,
} from '@/app/ui-v2/componentes';
import '../peajes.css';
import { mxn, numero } from '@/lib/formato';
// SOLO tipos y módulos puros: la vista no debe arrastrar `supabaseAdmin` al bundle.
import type { ReporteRevision, ReclamoVista } from '@/lib/likida/peajes/revision_cobros';
import type { CierreMensual, CierreDosMeses } from '@/lib/likida/peajes/cierre_mensual';
import type { ResumenSeguimiento } from '@/lib/likida/peajes/reclamos_seguimiento';
import { ETIQUETA_ESTADO_RECLAMO, PLAZO_RECLAMO_MESES } from '@/lib/likida/peajes/reclamos_seguimiento';
import type { ResultadoCasado } from '@/lib/likida/peajes/notas_credito';
import { rotuloOrigenPeriodo } from '@/lib/likida/peajes/periodo';
import {
  CATEGORIAS_COBRO, ETIQUETA_CATEGORIA_COBRO, ROTULO_CANDIDATO, type CategoriaCobro, type CandidatoCobro,
} from '@/lib/likida/peajes/reglas_cobro';
import { ETIQUETA_SENAL } from '@/lib/likida/peajes/cruces_atipicos';
import { ETIQUETA_DOBLE_ENTRE_ARCHIVOS } from '@/lib/likida/peajes/doble_entre_archivos';
import { FormaRegistrarReclamo } from './forma-registrar-reclamo';

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

function FilasCandidatos({ candidatos, justificar, desglose }: { candidatos: CandidatoCobro[]; justificar?: Accion; desglose?: string }) {
  const visibles = candidatos.slice(0, MAX_FILAS_POR_CATEGORIA);
  return (
    <>
      <TablaBase<CandidatoCobro>
        etiqueta="Cruces de caseta en revisión"
        filas={visibles}
        idFila={(c) => `${c.indice}-${c.categoria}`}
        altoMaximo={false}
        columnas={[
          { id: 'fecha', titulo: 'Fecha y hora', principal: true, celda: (c) => <>{c.fecha ?? '—'}{c.hora && <span className="rv-pj-nota">{c.hora}</span>}</> },
          { id: 'caseta', titulo: 'Caseta', celda: (c) => c.caseta ?? '—' },
          { id: 'tag', titulo: 'TAG / unidad', celda: (c) => <>{c.tag ?? '—'}{c.unidad && <span className="rv-pj-nota">{c.unidad}</span>}</> },
          { id: 'clase', titulo: 'Clase', alinear: 'der', celda: (c) => <span className="cifra-mono">{c.clase ?? '—'}</span> },
          { id: 'importe', titulo: 'Importe', alinear: 'der', celda: (c) => <span className="cifra-mono">{mxn(c.monto)}</span> },
          {
            id: 'quepaso', titulo: 'Qué pasó · qué significa · qué hacer',
            celda: (c) => (
              <div className="rv-pj-que rv-pj-que--ancho">
                <StatusChip tono="warn">{ROTULO_CANDIDATO}</StatusChip>
                <p className="rv-pj-texto"><b>Qué pasó:</b> {c.quePaso}</p>
                <p className="rv-pj-sub"><b>Qué significa:</b> {c.queSignifica}</p>
                <p className="rv-pj-sub"><b>Qué hacer:</b> {c.queHacer}</p>
                {c.categoria === 'caseta_no_debe_cruzarse' && c.justificacion && (
                  <p className="rv-pj-texto"><StatusChip tono="muted">Justificado</StatusChip> <b>Motivo:</b> {c.justificacion}</p>
                )}
                {c.categoria === 'caseta_no_debe_cruzarse' && !c.justificacion && justificar && desglose && (
                  <form action={justificar} className="rv-pj-forma">
                    <input type="hidden" name="desglose" value={desglose} />
                    <input type="hidden" name="indice" value={c.indice} />
                    <CampoTexto etiqueta="Motivo" name="motivo" required minLength={3} maxLength={300} placeholder="Salida de servicio autorizada"
                      aria-label={`Motivo para justificar el cruce del renglón ${c.indice + 1}`} />
                    <Boton type="submit">Justificar este cruce</Boton>
                  </form>
                )}
              </div>
            ),
          },
        ]}
      />
      {candidatos.length > visibles.length && (
        <p className="rv-pj-sub">
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
    <div id="revision-cobros">
    <Tarjeta
      titulo="Revisión de cobros del archivo"
      acciones={(
        <span className="rv-pj-total">
          <span className="rv-pj-rotulo">Cruces con algún candidato</span>
          <strong className="cifra-mono rv-pj-total__valor">{numero(r.lineasConCandidato)}</strong>
          <span className="rv-pj-nota">{mxn(r.montoConCandidato)}</span>
        </span>
      )}
    >
      <p className="rv-pj-sub">
        {revision.archivoNombre ? `${revision.archivoNombre} · ` : ''}
        {revision.periodoOficialDesde && revision.periodoOficialHasta
          ? `Periodo ${revision.periodoOficialDesde} a ${revision.periodoOficialHasta} (${rotuloOrigenPeriodo(revision.periodoOrigen)}) · `
          : 'Periodo del archivo no declarado · '}
        {numero(r.lineasRevisadas)} cruces · {mxn(r.montoRevisado)}
      </p>
      <div><StatusChip tono="warn">{ROTULO_CANDIDATO}</StatusChip></div>
      <div className="rv-pj-acciones">
        <BotonEnlace variante="primary" href={`/api/export/peajes-revision?desglose=${desglose}${ctx}`} icono={<Icono icono={FileDown} />}>
          Excel de la revisión
        </BotonEnlace>
        <BotonEnlace href={`/api/export/peajes-candidatos?desglose=${desglose}${ctx}`} icono={<Icono icono={FileDown} />}>
          Reporte para el portal del proveedor
        </BotonEnlace>
        <BotonEnlace href={`/api/export/peajes-candidatos?desglose=${desglose}&excluirReclamados=1${ctx}`}>
          Sin lo que ya reclamaste
        </BotonEnlace>
        <BotonEnlace href={`/api/export/peajes-candidatos?desglose=${desglose}&formato=csv${ctx}`}>
          CSV
        </BotonEnlace>
      </div>

      <p className="rv-pj-nota">
        Son candidatos, no cobros indebidos: sin el tarifario por caseta y clase ninguna regla puede afirmar que un monto esté mal. Valida cada uno con el proveedor por su portal (tienes {PLAZO_RECLAMO_MESES} meses desde el cobro para reclamar).
      </p>

      <div className="rv-pj-categorias">
        {CATEGORIAS_COBRO.map((c) => (
          <a key={c} href={`#cat-${c}`} className="rv-pj-caja rv-pj-caja--enlace">
            <span className="rv-pj-rotulo">{ETIQUETA_CATEGORIA_COBRO[c]}</span>
            <span className="rv-pj-caja__monto cifra-mono">{numero(r.porCategoria[c].n)}</span>
            <span className="rv-pj-nota">{mxn(r.porCategoria[c].monto)}</span>
          </a>
        ))}
      </div>

      {r.reglasNoAplicadas.length > 0 && (
        <div role="note" className="rv-pj-caja">
          <b>Reglas que no se pudieron aplicar a este archivo:</b>
          <ul className="rv-pj-notas">
            {r.reglasNoAplicadas.map((n) => <li key={n.regla}>{ETIQUETA_CATEGORIA_COBRO[n.regla]}: {n.motivo}</li>)}
          </ul>
        </div>
      )}
      {avisosCalidad.length > 0 && (
        <div role="note" className="rv-pj-caja">
          <b>Calidad del archivo:</b>
          <ul className="rv-pj-notas">{avisosCalidad.map((a) => <li key={a}>{a}</li>)}</ul>
        </div>
      )}
      {r.sugerenciasPasada.length > 0 && (
        <div role="note" className="rv-pj-caja rv-pj-sub">
          <b>¿Tarifa por pasada?</b> En estas casetas casi todos los cruces son clase 1: {r.sugerenciasPasada.map((s) => `${s.caseta} (${numero(s.cruces)})`).join(', ')}.
          Si cobran por pasada, decláralo en «Reglas de cobro» (Configuración) y dejarán de aparecer como candidatos.
        </div>
      )}

      {CATEGORIAS_COBRO.map((c) => {
        const lista = r.candidatos.filter((x) => x.categoria === c);
        if (lista.length === 0) return null;
        return (
          <details key={c} id={`cat-${c}`} className="rv-pj-det" open={lista.length <= 10}>
            <summary className="rv-pj-det__cab">
              {ETIQUETA_CATEGORIA_COBRO[c]} · {numero(lista.length)} · {mxn(r.porCategoria[c].monto)}
            </summary>
            <p className="rv-pj-sub">{EXPLICACION_CATEGORIA[c]}</p>
            <FilasCandidatos candidatos={lista} justificar={justificarCruce} desglose={desglose} />
          </details>
        );
      })}

      {revision.dobleEntreArchivos && revision.dobleEntreArchivos.candidatos.length > 0 && (
        <details className="rv-pj-det" id="doble-entre-archivos" open={revision.dobleEntreArchivos.candidatos.length <= 10}>
          <summary className="rv-pj-det__cab">
            {ETIQUETA_DOBLE_ENTRE_ARCHIVOS} · {numero(revision.dobleEntreArchivos.candidatos.length)} · {mxn(revision.dobleEntreArchivos.montoCandidatos)}
          </summary>
          <p className="rv-pj-sub">
            El proveedor cobró tarde un cruce que ya aparece, con el mismo TAG, segundo, caseta e importe, en un archivo anterior de los últimos {revision.dobleEntreArchivos.ventanaMeses} meses.
            El monto es el del segundo cobro; confírmalo con el proveedor antes de reclamarlo. El Excel del portal lo trae en su propia hoja.
          </p>
          <ul className="rv-pj-lista">
            {revision.dobleEntreArchivos.candidatos.slice(0, MAX_FILAS_POR_CATEGORIA).map((c) => (
              <li key={`${c.indice}-${c.archivoPrevioId}`} className="rv-pj-caja">
                <StatusChip tono="warn">{mxn(c.monto)} · {ROTULO_CANDIDATO}</StatusChip>
                <p className="rv-pj-texto"><b>Qué pasó:</b> {c.quePaso}</p>
                <p className="rv-pj-sub"><b>Qué hacer:</b> {c.queHacer}</p>
              </li>
            ))}
          </ul>
        </details>
      )}

      {revision.atipicos.atipicos.length > 0 && (
        <details className="rv-pj-det" id="atipicos">
          <summary className="rv-pj-det__cab">Cruces atípicos · {numero(revision.atipicos.atipicos.length)}</summary>
          <p className="rv-pj-sub">Patrones poco comunes de una misma unidad. Son avisos para el despacho, no cobros indebidos confirmados.</p>
          <ul className="rv-pj-lista">
            {revision.atipicos.atipicos.slice(0, MAX_FILAS_POR_CATEGORIA).map((a) => (
              <li key={`${a.senal}-${a.indices.join('-')}`} className="rv-pj-caja">
                <StatusChip tono="warn">{ETIQUETA_SENAL[a.senal]} · {ROTULO_CANDIDATO}</StatusChip>
                <p className="rv-pj-texto"><b>Qué pasó:</b> {a.quePaso}</p>
                <p className="rv-pj-sub"><b>Qué significa:</b> {a.queSignifica}</p>
                <p className="rv-pj-sub"><b>Qué hacer:</b> {a.queHacer}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
      {revision.atipicos.noAplicadas.length > 0 && (
        <p className="rv-pj-nota">
          Señales de cruces atípicos sin aplicar: {revision.atipicos.noAplicadas.map((n) => `${ETIQUETA_SENAL[n.senal]} (${n.motivo})`).join(' · ')}
        </p>
      )}
    </Tarjeta>
    </div>
  );
}

// ── El cierre mensual ───────────────────────────────────────────────────────

export function SeccionCierreMensual({ mes, cierre, error, sufijo, desglose, opciones = [], dosMeses = false, cierreDos = null }: {
  mes: string | null; cierre: CierreMensual | null; error: boolean; sufijo: string; desglose: string | null;
  /** Los meses que ofrece el selector (del más reciente al más viejo). Vacío = campo de texto AAAA-MM. */
  opciones?: string[];
  /** Vista de DOS meses juntos (el pedido y el anterior). */
  dosMeses?: boolean;
  cierreDos?: CierreDosMeses | null;
}) {
  const lista = mes && opciones.length > 0 && !opciones.includes(mes) ? [mes, ...opciones] : opciones;
  return (
    <div id="cierre-mensual">
    <Tarjeta titulo="Cierre mensual">
      <p className="rv-pj-sub">
        Junta las tres decenas de un mes (y compara los cobros tardíos con el mes anterior si también lo subiste). Un mes con una decena faltante se dice incompleto.
        Con «dos meses juntos» se consolidan el mes elegido y el anterior para que los cobros tardíos se acomoden en la misma ventana.
      </p>
      <BarraFiltros accion="?" etiqueta="Periodo del cierre mensual" ocultos={[...new URLSearchParams(sufijo.replace(/^\?/, '')).entries(), ...(desglose ? [['desglose', desglose] as const] : [])]}>
        {lista.length > 0 ? (
          <FiltroOpciones nombre="mes" etiqueta="Mes" valor={mes ?? lista[0]} porDefecto="" opciones={lista.map((m) => ({ valor: m, rotulo: m }))} />
        ) : (
          <FiltroCampo etiqueta="Mes"><input className="border-0 bg-transparent" name="mes" defaultValue={mes ?? ''} placeholder="2026-09" pattern="\d{4}-(0[1-9]|1[0-2])" required data-anillo="envolvente" /></FiltroCampo>
        )}
        <FiltroOpciones nombre="meses" etiqueta="Ventana" valor={dosMeses ? '2' : '1'} porDefecto="1"
          opciones={[{ valor: '1', rotulo: 'Un mes' }, { valor: '2', rotulo: 'Dos meses juntos' }]} />
      </BarraFiltros>
      {error && <p role="alert" className="rv-pj-sub rv-pj-malo">No se pudo armar el cierre ahora mismo. No es que no haya cobros: inténtalo de nuevo.</p>}
      {dosMeses && cierreDos && <CierreDosMesesVista c={cierreDos} />}
      {!dosMeses && cierre && (
        <div className="rv-pj-bloque">
          <div className="rv-pj-cab">
            <div>
              <strong>{cierre.mes}</strong>{' '}
              <StatusChip tono={cierre.completo ? 'ok' : 'warn'}>{cierre.completo ? 'Mes completo' : 'Mes incompleto'}</StatusChip>
            </div>
            <div className="rv-pj-der">
              <strong className="cifra-mono rv-pj-caja__monto">{numero(cierre.cruces)}</strong> cruces · <span className="cifra-mono">{mxn(cierre.monto)}</span>
            </div>
          </div>
          <div className="rv-pj-decenas">
            {cierre.decenas.map((d) => <TarjetaDecena key={d.etiqueta} d={d} />)}
          </div>
          <p className="rv-pj-texto">
            Cobros tardíos (candidatos: validar con el proveedor): {numero(cierre.tardiosMesAnterior.n)} del mes anterior ({mxn(cierre.tardiosMesAnterior.monto)}) y {numero(cierre.tardiosDecenaAnterior.n)} de una decena anterior de este mes ({mxn(cierre.tardiosDecenaAnterior.monto)}).
            {cierre.repetidosEntreArchivos.length > 0 && <> <b>{numero(cierre.repetidosEntreArchivos.length)} cobros aparecen en más de un archivo.</b></>}
          </p>
          {cierre.avisos.length > 0 && (
            <ul className="rv-pj-notas">{cierre.avisos.map((a) => <li key={a}>{a}</li>)}</ul>
          )}
        </div>
      )}
    </Tarjeta>
    </div>
  );
}

function TarjetaDecena({ d }: { d: CierreMensual['decenas'][number] }) {
  return (
    <div className="rv-pj-caja">
      <span className="rv-pj-rotulo">Decena {d.etiqueta}</span>
      {d.cubierta
        ? <span><strong className="rv-pj-caja__monto cifra-mono">{numero(d.cruces)}</strong> <span className="rv-pj-nota">{mxn(d.monto)}</span></span>
        : <span className="rv-pj-sub rv-pj-malo">Falta el archivo</span>}
    </div>
  );
}

function CierreDosMesesVista({ c }: { c: CierreDosMeses }) {
  return (
    <div className="rv-pj-bloque" id="cierre-dos-meses">
      <div className="rv-pj-cab">
        <div>
          <strong>{c.meses[0]} + {c.meses[1]}</strong>{' '}
          <StatusChip tono={c.completo ? 'ok' : 'warn'}>{c.completo ? 'Dos meses completos' : 'Ventana incompleta'}</StatusChip>
        </div>
        <div className="rv-pj-der">
          <strong className="cifra-mono rv-pj-caja__monto">{numero(c.cruces)}</strong> cruces · <span className="cifra-mono">{mxn(c.monto)}</span>
        </div>
      </div>
      <div className="rv-pj-decenas">
        {c.decenas.map((d) => <TarjetaDecena key={d.etiqueta} d={d} />)}
      </div>
      <p className="rv-pj-texto">
        Cobros tardíos que caen dentro de la ventana (se acomodan): {numero(c.acomodados.n)} ({mxn(c.acomodados.monto)}). Anteriores a {c.meses[0]} (candidatos: validar con el proveedor): {numero(c.tardiosFueraDeVentana.n)} ({mxn(c.tardiosFueraDeVentana.monto)}).
        {c.repetidosEntreArchivos.length > 0 && <> <b>{numero(c.repetidosEntreArchivos.length)} cobros aparecen en más de un archivo.</b></>}
      </p>
      {c.avisos.length > 0 && (
        <ul className="rv-pj-notas">{c.avisos.map((a) => <li key={a}>{a}</li>)}</ul>
      )}
    </div>
  );
}

// ── El seguimiento de reclamos y notas de crédito ───────────────────────────

const TONO_ALERTA: Record<ReclamoVista['evaluacion']['alerta'], TonoEstado> = { ok: 'ok', por_vencer: 'warn', vencido: 'bad', cerrado: 'muted' };
const ROTULO_ALERTA: Record<ReclamoVista['evaluacion']['alerta'], string> = { ok: 'En plazo', por_vencer: 'Por vencer', vencido: 'Vencido', cerrado: 'Cerrado' };

/**
 * La PROPUESTA de a qué reclamo(s) corresponde una nota de crédito (`casarNota`). Es solo una sugerencia por suma exacta: nada se
 * registra solo; la persona confirma capturando la nota en el reclamo que corresponda. `texto` es lo que escribió (se devuelve al campo).
 */
export interface PropuestaNota {
  texto: string;
  /** `null` = el texto no es un importe válido (`motivo` dice por qué) o no se pudo calcular (`fallo`). */
  importe: number | null;
  resultado: ResultadoCasado | null;
  motivo?: string;
  fallo?: boolean;
}

function etiquetaReclamo(r: ReclamoVista | undefined, id: string): string {
  if (!r) return `reclamo ${id.slice(0, 8)}`;
  const cat = (CATEGORIAS_COBRO as readonly string[]).includes(r.categoria) ? ETIQUETA_CATEGORIA_COBRO[r.categoria as CategoriaCobro] : r.categoria;
  const falta = Math.round((r.montoReclamado - r.montoAcreditado) * 100) / 100;
  return `${cat} · ${numero(r.nCruces)} cruces · por acreditar ${mxn(falta)} · cobro más antiguo ${r.fechaCobroMasAntiguo}${r.referenciaPortal ? ` · folio ${r.referenciaPortal}` : ''}`;
}

/** «¿A qué reclamo corresponde esta nota?»: formulario GET (no escribe nada) y, si hay importe, la propuesta de `casarNota`. */
export function CasarNota({ propuesta, reclamos, sufijo, desglose, mes }: {
  propuesta: PropuestaNota | null; reclamos: ReclamoVista[]; sufijo: string; desglose: string | null; mes: string | null;
}) {
  const previos = new URLSearchParams(sufijo.replace(/^\?/, ''));
  if (desglose) previos.set('desglose', desglose);
  if (mes) previos.set('mes', mes);
  previos.delete('nota');
  const porId = new Map(reclamos.map((r) => [r.id, r]));
  const r = propuesta?.resultado ?? null;
  return (
    <div className="rv-pj-caja" id="casar-nota">
      {/* sin-info: rótulo de un bloque dentro de la tarjeta de seguimiento */}
      <h3 className="rv-pj-rotulo">¿A qué reclamo corresponde una nota de crédito?</h3>
      <p className="rv-pj-sub">
        El proveedor manda la nota sin decir qué cruces cubre. Escribe su importe y el sistema propone a qué reclamo(s) enviados les cuadra la suma exacta.
        Es solo una sugerencia: no registra nada; la nota se captura en el reclamo que tú confirmes.
      </p>
      <form method="get" action="/dashboard/agentes/peajes/reclamacion" className="rv-pj-forma">
        {[...previos.entries()].map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <CampoTexto etiqueta="Importe de la nota (MXN)" name="nota" inputMode="decimal" required maxLength={20} defaultValue={propuesta?.texto ?? ''} />
        <Boton type="submit">Proponer reclamo</Boton>
      </form>
      {propuesta?.fallo && <p role="alert" className="rv-pj-sub rv-pj-malo">No se pudo calcular la propuesta ahora mismo. No es que no haya coincidencia: inténtalo de nuevo.</p>}
      {propuesta && !propuesta.fallo && propuesta.importe === null && <p role="alert" className="rv-pj-sub rv-pj-malo">{propuesta.motivo ?? 'El importe no es válido.'}</p>}
      {r && propuesta?.importe != null && (
        <div className="rv-pj-bloque" role="status">
          {r.alertas.includes('nota_mayor_que_reclamado') && (
            <p className="rv-pj-sub rv-pj-tono" data-tono="warn">La nota ({mxn(propuesta.importe)}) es mayor que todo lo que falta por acreditar: revisa si falta registrar un reclamo.</p>
          )}
          {r.tipo === 'seguro' && (
            <p className="rv-pj-texto">Coincide exactamente con: <b>{etiquetaReclamo(porId.get(r.reclamoIds[0]), r.reclamoIds[0])}</b>. Confírmalo capturando la nota en ese reclamo.</p>
          )}
          {r.tipo === 'sugerido' && (
            <>
              <p className="rv-pj-texto">{r.ambiguo ? 'Hay más de una combinación posible; ninguna se elige sola:' : 'Podría corresponder a la suma de estos reclamos:'}</p>
              <ul className="rv-pj-notas">
                {r.opciones.map((op, i) => <li key={i}>{op.map((id) => etiquetaReclamo(porId.get(id), id)).join(' + ')}</li>)}
              </ul>
              {r.truncado && <p className="rv-pj-sub">Hay más combinaciones de las que se muestran: casa la nota a mano.</p>}
            </>
          )}
          {r.tipo === 'demasiados' && <p className="rv-pj-sub">{r.mensaje}</p>}
          {r.tipo === 'sin_casar' && !r.alertas.includes('importe_invalido') && (
            <p className="rv-pj-sub">Ningún reclamo enviado ni combinación de ellos suma {mxn(propuesta.importe)}. Puede ser una nota parcial: captúrala en el reclamo que creas que corresponde.</p>
          )}
        </div>
      )}
    </div>
  );
}

export function SeccionSeguimiento({ reclamos, resumen, acciones, desglose, revision, error, propuestaNota, sufijo = '', mes = null }: {
  reclamos: ReclamoVista[] | null; resumen: ResumenSeguimiento | null; acciones: AccionesSeguimiento; desglose: string | null;
  revision: ReporteRevision | null; error: boolean; propuestaNota?: PropuestaNota | null; sufijo?: string; mes?: string | null;
}) {
  const conCandidatos = revision ? CATEGORIAS_COBRO.filter((c) => revision.revision.porCategoria[c].n > 0) : [];
  return (
    <div id="seguimiento">
    <Tarjeta titulo="Seguimiento de reclamos y notas de crédito">
      <p className="rv-pj-sub">
        El proveedor no atiende por teléfono: se reclama por su portal y, si procede, devuelve una nota de crédito sin detalle. Aquí queda qué reclamaste, qué te acreditaron y cuánto falta.
        El plazo es de {PLAZO_RECLAMO_MESES} meses desde el cobro más antiguo del reclamo (regla dicha por el cliente: confírmala con el proveedor).
      </p>
      {error && <p role="alert" className="rv-pj-sub rv-pj-malo">No se pudo leer el seguimiento ahora mismo. No es que no haya reclamos: inténtalo de nuevo.</p>}
      {resumen && reclamos && (
        <p className="rv-pj-texto">
          {numero(resumen.reclamos)} reclamos · reclamado {mxn(resumen.montoReclamado)} · acreditado {mxn(resumen.montoAcreditado)} · <b>por acreditar {mxn(resumen.pendienteAcreditar)}</b>
          {resumen.preparados > 0 && <> · <span className="rv-pj-apagado">{numero(resumen.preparados)} preparados sin enviar ({mxn(resumen.montoPreparado)}, aún no exigidos al proveedor)</span></>}
          {resumen.porVencer > 0 && <> · <span className="rv-pj-tono" data-tono="warn">{numero(resumen.porVencer)} por vencer</span></>}
          {resumen.vencidos > 0 && <> · <span className="rv-pj-malo">{numero(resumen.vencidos)} vencidos</span></>}
        </p>
      )}
      {reclamos && reclamos.length === 0 && <p className="rv-pj-sub">Aún no registras reclamos.</p>}
      {reclamos && reclamos.length > 0 && (
        <div className="rv-pj-bloque">
          {reclamos.map((r) => (
            <div key={r.id} className="rv-pj-caja">
              <div className="rv-pj-acciones">
                <strong>{(CATEGORIAS_COBRO as readonly string[]).includes(r.categoria) ? ETIQUETA_CATEGORIA_COBRO[r.categoria as CategoriaCobro] : r.categoria}</strong>
                <StatusChip tono={TONO_ALERTA[r.evaluacion.alerta]}>{ROTULO_ALERTA[r.evaluacion.alerta]}</StatusChip>
                <span className="rv-pj-apagado">{ETIQUETA_ESTADO_RECLAMO[r.estado]}</span>
                {r.referenciaPortal && <span className="cifra-mono rv-pj-nota">Folio {r.referenciaPortal}</span>}
              </div>
              <p className="rv-pj-texto">
                {numero(r.nCruces)} cruces · reclamado {mxn(r.montoReclamado)} · acreditado {mxn(r.montoAcreditado)}
                {r.evaluacion.pctAcreditado !== null && ` (${r.evaluacion.pctAcreditado}%)`} · cobro más antiguo {r.fechaCobroMasAntiguo} · vence {r.evaluacion.fechaLimite}
              </p>
              <p className="rv-pj-sub">{r.evaluacion.mensaje}</p>
              {r.estado === 'preparado' && (
                <form action={acciones.marcarEnviado} className="rv-pj-forma">
                  <input type="hidden" name="reclamo" value={r.id} />
                  <CampoFecha etiqueta="Enviado el" name="enviado_en" required />
                  <CampoTexto etiqueta="Folio del portal (opc.)" name="referencia" maxLength={120} />
                  <Boton type="submit" variante="primary">Marcar como enviado</Boton>
                </form>
              )}
              {(r.estado === 'enviado' || r.estado === 'acreditado_parcial') && (
                <div className="rv-pj-forma">
                  <form action={acciones.registrarNota} className="rv-pj-forma">
                    <input type="hidden" name="reclamo" value={r.id} />
                    {/* A33-06: lo que esta pantalla vio; un doble clic o pestaña repetida manda lo mismo y la base lo registra una sola vez. */}
                    <input type="hidden" name="version_vista" value={`${r.estado}:${r.montoAcreditado}`} />
                    <CampoTexto etiqueta="Nota de crédito (MXN)" name="monto" inputMode="decimal" required />
                    <CampoFecha etiqueta="Fecha" name="fecha" required />
                    <CampoTexto etiqueta="Folio de la nota (opc.)" name="referencia" maxLength={120} />
                    <Boton type="submit" variante="primary">Registrar nota de crédito</Boton>
                  </form>
                  <form action={acciones.rechazar}>
                    <input type="hidden" name="reclamo" value={r.id} />
                    <Boton type="submit">El proveedor lo rechazó</Boton>
                  </form>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {reclamos && reclamos.some((r) => r.estado === 'enviado' || r.estado === 'acreditado_parcial') && (
        <CasarNota propuesta={propuestaNota ?? null} reclamos={reclamos} sufijo={sufijo} desglose={desglose} mes={mes} />
      )}
      {desglose && conCandidatos.length > 0 && (
        <FormaRegistrarReclamo
          accion={acciones.crearReclamo} desglose={desglose}
          opciones={conCandidatos.map((c) => ({ categoria: c, n: revision?.revision.porCategoria[c].n ?? 0 }))}
        />
      )}
      {desglose && conCandidatos.length > 0 && (
        <p className="rv-pj-nota">El número de cruces, el importe y el cobro más antiguo se toman de los candidatos de la categoría, no de lo que escribas.</p>
      )}
    </Tarjeta>
    </div>
  );
}
