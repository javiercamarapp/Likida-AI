import { FileDown, ArrowLeft, ShieldAlert } from 'lucide-react';
import { mxn, numero } from '@/lib/formato';

// El módulo `reclamacion` es puro (sin base): el bundle de la vista puede importarlo.
import { ETIQUETA_MOTIVO_RECLAMACION, type ReporteReclamacion, type MotivoReclamacion } from '@/lib/likida/peajes/reclamacion';
import { TEXTO_SIN_POSICIONES } from '@/lib/likida/peajes/reclamacion_perfil';
import { textoEvidencia } from '@/lib/likida/peajes/reclamacion_archivos';
import type { ReporteRevision, ReclamoVista } from '@/lib/likida/peajes/revision_cobros';
import type { CierreMensual, CierreDosMeses } from '@/lib/likida/peajes/cierre_mensual';
import type { ResumenSeguimiento } from '@/lib/likida/peajes/reclamos_seguimiento';
import { SeccionRevisionCobros, SeccionCierreMensual, SeccionSeguimiento, type AccionesSeguimiento, type PropuestaNota } from './revision';
import { TablaCandidatosCobros, type AccionDecidir } from '../candidatos-tabla';
import type { TablaCandidatos, AccionCandidato } from '@/lib/likida/peajes/candidatos_tabla';
import {
  AvisoCompacto, Boton, BotonEnlace, CampoTexto, EstadoVacio, Icono, MarcoPagina, StatusChip, TablaBase, Tarjeta, TituloRecuadro,
} from '@/app/ui-v2/componentes';
import '../peajes.css';

export type EstadoReclamacion = 'sin_desglose' | 'no_existe' | 'error' | 'ok';

/** Lo que la pantalla suma a la reclamación con GPS: la revisión de cobros del archivo, el cierre mensual y el seguimiento. Todo opcional. */
export interface ExtrasReclamacion {
  revision: ReporteRevision | null;
  /** La tabla de candidatos con sus acciones (T-A2-28). */
  candidatos?: { tabla: TablaCandidatos | null; error: boolean; decidir?: AccionDecidir; aplicables?: Record<AccionCandidato, number> };
  /** El reporte con GPS no se pudo leer (la revisión de cobros sí). */
  errorGps?: boolean;
  mes: string | null;
  cierre: CierreMensual | null;
  /** Los meses que ofrece el selector (del más reciente al más viejo). */
  mesesOpciones?: string[];
  /** Vista de dos meses juntos (`?meses=2`) y su resultado. */
  dosMeses?: boolean;
  cierreDos?: CierreDosMeses | null;
  errorCierre?: boolean;
  seguimiento: { reclamos: ReclamoVista[]; resumen: ResumenSeguimiento } | null;
  errorSeguimiento?: boolean;
  /** La propuesta de a qué reclamo corresponde la nota de crédito que se tecleó (`?nota=`). */
  propuestaNota?: PropuestaNota | null;
  acciones: AccionesSeguimiento;
  aviso?: string | null;
  error?: string | null;
}

/**
 * Perfil `cinco_agentes` (T-A2-24): el reporte enseña solo los motivos visibles, todo como «candidato», sin descargas (la ruta de
 * export es stand-by) y con el margen de distancia de la flota. Ausente = flota sin perfil: todo como siempre.
 */
export interface CandidatoReclamacion {
  motivos: readonly MotivoReclamacion[];
  margenLejosM: number;
  /** Fija el margen de la flota (acción de servidor con su propia puerta). Sin ella no se pinta el formulario. */
  guardarMargen?: (fd: FormData) => void | Promise<void>;
}

export function VistaReclamacionPeajes({ sufijo, desglose, estado, reporte, extras, candidato }: {
  sufijo: string; desglose: string | null; estado: EstadoReclamacion; reporte: ReporteReclamacion | null; extras?: ExtrasReclamacion; candidato?: CandidatoReclamacion;
}) {
  const ctx = sufijo ? `&${sufijo.slice(1)}` : '';
  const motivosVisibles = (Object.keys(ETIQUETA_MOTIVO_RECLAMACION) as MotivoReclamacion[]).filter((m) => !candidato || candidato.motivos.includes(m));
  // Sin nada evaluado (ni una línea confirmada ni un cruce) no hay con qué comparar: no se pinta como «todo bien».
  const faltanDatos = !!candidato && !!reporte && reporte.resumen.reclamables === 0 && reporte.resumen.confirmadas === 0;
  return (
    <MarcoPagina titulo="Reporte de reclamación de peajes" apoyo="Los cruces candidatos a reclamo de un desglose de peajes, el cierre mensual y el seguimiento de reclamos." acciones={<BotonEnlace tamano="sm" variante="secondary" href={`/dashboard/agentes/peajes${sufijo}`} icono={<Icono icono={ArrowLeft} />}>Volver al agente</BotonEnlace>}>
      {estado === 'sin_desglose' && (
        <EstadoVacio icono={ShieldAlert} titulo="Elige un desglose">
          Elige un desglose en el agente de Peajes y abre «Reporte de reclamación». Aquí también puedes ver el cierre mensual y el seguimiento de reclamos.
        </EstadoVacio>
      )}
      {estado === 'no_existe' && <AvisoCompacto tono="error" resumen="Ese desglose no existe en tu flota (o fue anulado)." />}
      {estado === 'error' && <AvisoCompacto tono="error" resumen="No se pudo armar el reporte ahora mismo. No es que no haya nada que reclamar: inténtalo de nuevo en un momento." />}

      {extras?.aviso && <AvisoCompacto tono="ok" resumen={extras.aviso} />}
      {extras?.error && <AvisoCompacto tono="error" resumen={extras.error} />}

      {estado === 'ok' && extras?.revision && desglose && (
        <SeccionRevisionCobros revision={extras.revision} desglose={desglose} sufijo={sufijo} justificarCruce={extras.acciones.justificarCruce} />
      )}
      {estado === 'ok' && extras?.candidatos && desglose && (
        <TablaCandidatosCobros tabla={extras.candidatos.tabla} error={extras.candidatos.error} desglose={desglose} sufijo={sufijo}
          decidir={extras.candidatos.decidir} aplicables={extras.candidatos.aplicables} />
      )}
      {extras && (estado === 'ok' || estado === 'sin_desglose') && (
        <>
          <SeccionCierreMensual mes={extras.mes} cierre={extras.cierre} error={extras.errorCierre === true} sufijo={sufijo} desglose={desglose}
            opciones={extras.mesesOpciones} dosMeses={extras.dosMeses === true} cierreDos={extras.cierreDos ?? null} />
          <SeccionSeguimiento
            reclamos={extras.seguimiento?.reclamos ?? null} resumen={extras.seguimiento?.resumen ?? null} acciones={extras.acciones}
            desglose={estado === 'ok' ? desglose : null} revision={extras.revision} error={extras.errorSeguimiento === true}
            propuestaNota={extras.propuestaNota ?? null} sufijo={sufijo} mes={extras.mes} />
        </>
      )}
      {estado === 'ok' && !reporte && extras?.errorGps && (
        <AvisoCompacto tono="error" resumen="El reporte con evidencia de GPS no se pudo armar ahora mismo. No es que no haya nada que reclamar: la revisión de cobros de arriba no depende del GPS." />
      )}

      {estado === 'ok' && reporte && desglose && (
        <>
          <Tarjeta
            titulo={candidato
              ? (reporte.resumen.reclamables === 0 ? 'Sin cruces candidatos' : `${numero(reporte.resumen.reclamables)} ${reporte.resumen.reclamables === 1 ? 'cruce candidato' : 'cruces candidatos'} para pedir revisión`)
              : (reporte.resumen.reclamables === 0 ? 'Sin cruces para reclamar' : `${numero(reporte.resumen.reclamables)} ${reporte.resumen.reclamables === 1 ? 'cruce' : 'cruces'} para pedir revisión`)}
            info="peajes_reclamacion.cruces"
            acciones={(
              <span className="rv-pj-total">
                <span className="rv-pj-rotulo">Monto reclamable</span>
                <strong className="cifra-mono rv-pj-total__valor">{mxn(reporte.resumen.montoReclamable)}</strong>
              </span>
            )}
          >
            <p className="rv-pj-sub">
              {reporte.proveedor ? `Proveedor ${reporte.proveedor} · ` : ''}
              {reporte.periodoDesde && reporte.periodoHasta ? `Periodo ${reporte.periodoDesde} a ${reporte.periodoHasta} · ` : ''}
              {numero(reporte.resumen.lineas)} líneas en el desglose
            </p>
            {!candidato && <div className="rv-pj-acciones">
              <BotonEnlace variante="primary" href={`/api/export/peajes-reclamacion?desglose=${desglose}&formato=xlsx${ctx}`} icono={<Icono icono={FileDown} />}>
                Excel
              </BotonEnlace>
              <BotonEnlace href={`/api/export/peajes-reclamacion?desglose=${desglose}&formato=pdf${ctx}`} icono={<Icono icono={FileDown} />}>
                PDF
              </BotonEnlace>
            </div>}
            {faltanDatos && <AvisoCompacto tono="info" resumen={TEXTO_SIN_POSICIONES} />}
            {candidato?.guardarMargen && (
              <form action={candidato.guardarMargen} className="rv-pj-forma">
                <input type="hidden" name="desglose" value={desglose} />
                <CampoTexto tipo="number" etiqueta="Margen de distancia a la caseta (m)" name="margen" inputMode="numeric" min={100} max={5000} step={1} defaultValue={candidato.margenLejosM} />
                <Boton type="submit">Guardar margen</Boton>
                <span className="rv-pj-sub">Un cruce se marca como candidato si la unidad pasó a más de ese margen (sumado al radio de la caseta). Por omisión 1,000 m; fíjalo en 200 o 500 m cuando se decida.</span>
              </form>
            )}
            <div className="rv-pj-categorias">
              {motivosVisibles.map((m) => (
                <div key={m} className="rv-pj-caja">
                  <span className="rv-pj-rotulo">{ETIQUETA_MOTIVO_RECLAMACION[m]}</span>
                  <span><strong className="rv-pj-caja__monto cifra-mono">{numero(reporte.resumen.porMotivo[m].n)}</strong> <span className="rv-pj-nota">{mxn(reporte.resumen.porMotivo[m].monto)}</span></span>
                </div>
              ))}
            </div>
            <p className="rv-pj-nota">
              No se reclaman (sin evidencia en contra del cobro): {numero(reporte.resumen.confirmadas)} confirmadas por el GPS · {numero(reporte.resumen.sinDatos)} sin datos suficientes
              {reporte.resumen.sinEvaluar > 0 ? ` · ${numero(reporte.resumen.sinEvaluar)} sin evaluar (vuelve a conciliar el desglose)` : ''}. Sin datos no es evidencia en contra de nadie.
              {!candidato && reporte.resumen.sinCurso > 0 ? ` ${numero(reporte.resumen.sinCurso)} de ${numero(reporte.resumen.lineas)} líneas no tienen curso declarado y no se evaluaron por curso: cárgalos en Configuración, sección Cursos.` : ''}
            </p>
          </Tarjeta>

          {reporte.cruces.length > 0 && (
            <Tarjeta titulo="Cruces de caseta en reclamación" info="peajes_reclamacion.cruces">
              <TablaBase<ReporteReclamacion['cruces'][number]>
                etiqueta="Cruces de caseta en reclamación"
                filas={reporte.cruces}
                idFila={(c) => String(c.indice)}
                altoMaximo={false}
                columnas={[
                  { id: 'fecha', titulo: 'Fecha y hora', principal: true, celda: (c) => <>{c.fecha}{c.hora && <span className="rv-pj-nota">{c.hora.slice(0, 8)}</span>}</> },
                  { id: 'caseta', titulo: 'Caseta', celda: (c) => c.casetaCatalogo || c.caseta || '—' },
                  { id: 'tag', titulo: 'TAG / unidad', celda: (c) => <>{c.tag || '—'}{c.unidad && <span className="rv-pj-nota">{c.unidad}</span>}</> },
                  { id: 'monto', titulo: 'Monto', alinear: 'der', celda: (c) => <span className="cifra-mono">{mxn(c.monto)}</span> },
                  {
                    id: 'porque', titulo: candidato ? 'Por qué es candidato' : 'Por qué se reclama',
                    celda: (c) => (
                      <div className="rv-pj-que rv-pj-que--ancho">
                        <StatusChip tono={c.confianza === 'alta' ? 'bad' : 'warn'}>
                          {ETIQUETA_MOTIVO_RECLAMACION[c.motivo]} · {candidato ? 'candidato' : c.confianza}
                        </StatusChip>
                        <span>{c.porQue}</span>
                        {c.evidencia.length > 0 && (
                          <ul className="rv-pj-notas">
                            {c.evidencia.map((e) => <li key={e.en}>{textoEvidencia(e)}</li>)}
                          </ul>
                        )}
                      </div>
                    ),
                  },
                ]}
              />
            </Tarjeta>
          )}

          <Tarjeta titulo="Qué significa y qué NO afirma" info="peajes_reclamacion.leyendas">
            <ul className="rv-pj-notas">
              {reporte.leyendas.map((l) => <li key={l}>{l}</li>)}
            </ul>
          </Tarjeta>
        </>
      )}
    </MarcoPagina>
  );
}
