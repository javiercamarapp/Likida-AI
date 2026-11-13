'use client';

import '../vigia.css';
import { AvisoResultado, Boton, CampoArchivo, CampoTexto, Icono, MarcoPagina, TablaBase, Tarjeta, type ColumnaBase } from '@/app/ui-v2/componentes';
import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Download, TriangleAlert, Upload } from 'lucide-react';
import {
  ETIQUETA_DOCS, ETIQUETA_ESTADO, ROTULO_DERIVADO,
  type ComparacionTT, type DiaImportacion, type Incoherencia,
} from '@/lib/likida/vigia/importacion/derivar';
import { BloqueCifras } from '@/app/ui-v2/esqueletos';
import { useT } from '@/lib/i18n/proveedor';
import { agentes as agentesEs } from '@/lib/i18n/es/agentes';
import { type TAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';
import { rico as ricoT } from '@/lib/i18n/rico';

// ═══════════════════════════════════════════════════════════════════════════
// TABLERO DE ESTATUS DE IMPORTACIÓN (Agente 4, T-A4-37).
//
// El estatus de cada caja (patio / cruce / en ruta; documentos listos o pendientes) hoy se escribe a mano en el programa
// y «no siempre» está al día (levantamiento 9df88631 ~16:56). Esta pantalla lo DERIVA del programa que se sube, cuenta
// cajas por día, señala las filas que no cuadran y da un CSV para pegarlo. No guarda nada ni escribe en ningún sistema.
// Los números vienen del servidor; aquí solo se pintan.
// ═══════════════════════════════════════════════════════════════════════════

export const TOPE_ARCHIVO_IMPORTACION_BYTES = 12 * 1024 * 1024;

export interface ResumenImportacion {
  terminal: string;
  totalCajas: number;
  filasImportacion: number;
  filasOtrasSecciones: number;
  sinFecha: number;
  dias: DiaImportacion[];
  totalIncoherencias: number;
  /** Las primeras; el total va en `totalIncoherencias`. */
  incoherencias: Incoherencia[];
  comparacion: ComparacionTT | null;
  /** El archivo completo, ya con las fórmulas neutralizadas. */
  csv: string;
}

export type ResultadoImportacion =
  | null
  | { ok: false; error: string }
  | { ok: true; resumen: ResumenImportacion };

export type AccionImportacion = (previo: ResultadoImportacion, fd: FormData) => Promise<ResultadoImportacion>;

function miles(n: number): string {
  const d = String(Math.trunc(n));
  let out = '';
  for (let i = 0; i < d.length; i++) {
    if (i > 0 && (d.length - i) % 3 === 0) out += ' ';
    out += d[i];
  }
  return out;
}

/** AAAA-MM-DD → DD/MM/AAAA, sin pasar por Date. */
function dia(fecha: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : fecha;
}

const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);

const vacioTr = (tx: TAgentes = TR_ES.t) => (tx('rest.carga_el_programa_del_dia_para'));

function Enviar() {
  const { t: tx } = useT('agentes', agentesEs);
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" loading={pending} icono={<Icono icono={Upload} tam={14} />}>{pending ? 'Leyendo el archivo…' : tx('rest.subir_y_ver_el_estatus')}</Boton>
  );
}

function DescargarCsv({ csv }: { csv: string }) {
  const { t: tx } = useT('agentes', agentesEs);
  function descargar() {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'estatus-importacion.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <Boton onClick={descargar} icono={<Icono icono={Download} tam={14} />}>{tx('rest.descargar_csv')}</Boton>
  );
}

function Forma({ accion }: { accion: AccionImportacion }) {
  const { t: tx } = useT('agentes', agentesEs);
  const [estado, despachar] = useActionState(accion, null);
  return (
    <div className="rv-vg__pila">
      <form action={despachar} className="rv-vg__pila">
        <div className="rv-vg__cuad">
          <CampoTexto etiqueta={tx('rest.terminal')} name="terminal" required maxLength={40} placeholder={tx('rest.por_ejemplo_gdl')} autoComplete="off" />
          <CampoArchivo etiqueta={`Archivo del programa (CSV, hasta ${TOPE_ARCHIVO_IMPORTACION_BYTES / (1024 * 1024)} MB)`} name="archivo" required accept=".csv,.txt,text/csv" />
        </div>
        <p className="rv-vg__nota">{tx('rest.aqui_solo_se_lee_el_archivo')}</p>
        <div><Enviar /></div>
      </form>
      <Salida estado={estado} tx={tx} />
    </div>
  );
}

/** Lo que hay debajo del formulario: el error en llano, el tablero, o el estado vacío. */
export function Salida({ estado, tx = TR_ES.t }: { estado: ResultadoImportacion; tx?: TAgentes }) {
  if (estado && !estado.ok) return <AvisoResultado estado={estado} />;
  if (estado?.ok) return <Tablero r={estado.resumen} />;
  return <p className="rv-vg__nota" data-testid="vacio">{vacioTr(tx)}</p>;
}

function Tablero({ r }: { r: ResumenImportacion }) {
  const { t: tx } = useT('agentes', agentesEs);
  const c = r.comparacion;
  const columnas: readonly ColumnaBase<DiaImportacion>[] = [
    { id: 'dia', titulo: tx('rest.dia'), principal: true, celda: (d) => <span data-dia={d.fecha}>{dia(d.fecha)}</span> },
    { id: 'cajas', titulo: tx('rest.cajas'), alinear: 'der', celda: (d) => miles(d.cajas) },
    { id: 'patio', titulo: ETIQUETA_ESTADO.patio, alinear: 'der', celda: (d) => miles(d.porEstado.patio) },
    { id: 'cruce', titulo: ETIQUETA_ESTADO.pend_cruce, alinear: 'der', celda: (d) => miles(d.porEstado.pend_cruce) },
    { id: 'ruta', titulo: ETIQUETA_ESTADO.en_ruta, alinear: 'der', celda: (d) => miles(d.porEstado.en_ruta) },
    { id: 'listo', titulo: ETIQUETA_DOCS.listo, alinear: 'der', celda: (d) => miles(d.porDocs.listo) },
    { id: 'pend', titulo: ETIQUETA_DOCS.pend_requisito, alinear: 'der', celda: (d) => miles(d.porDocs.pend_requisito) },
    { id: 'sin', titulo: tx('rest.sin_estatus'), alinear: 'der', celda: (d) => miles(d.porEstado.desconocido) },
  ];
  return (
    <div className="rv-vg__pila rv-ag-sin-filete" aria-live="polite">
      {/* Tira de cifras del resultado (Rovaq «Importaciones»): solo lo que el archivo dijo, nunca un conteo inventado. */}
      <BloqueCifras
        etiqueta={tx('rest.estatus_de_importacion')}
        cifras={[
          { etiqueta: tx('f26d.importacion.cajas'), valor: miles(r.totalCajas) },
          { etiqueta: tx('f26d.importacion.dias'), valor: miles(r.dias.length) },
          { etiqueta: tx('f26d.importacion.no_cuadran'), valor: miles(r.totalIncoherencias), tono: r.totalIncoherencias > 0 ? 'warn' : undefined },
          { etiqueta: tx('f26d.importacion.sin_fecha'), valor: miles(r.sinFecha), tono: r.sinFecha > 0 ? 'bad' : undefined },
        ]}
      />
      <Tarjeta titulo={tx('rest.estatus_por_dia')} info="vigia_importacion.estatus_dia">
        <div className="rv-vg__pila">
          <p data-testid="resumen">
            {r.totalCajas === 0
              ? tx('rest.no_encontre_cajas_de_importacion_en', { terminal: r.terminal })
              : tx('rest.de_importacion_en_terminal', { miles: miles(r.totalCajas), plural: plural(r.totalCajas, tx('rest.w_caja'), tx('rest.w_cajas')), miles2: miles(r.dias.length), plural2: plural(r.dias.length, tx('rest.w_dia'), tx('rest.w_dias')), terminal: r.terminal })}
            {r.filasOtrasSecciones > 0
              ? tx('rest.de_otras_secciones_no_cuentan_aqui', { miles: miles(r.filasOtrasSecciones), plural: plural(r.filasOtrasSecciones, tx('rest.w_fila'), tx('rest.w_filas')) })
              : ''}
          </p>
          {r.sinFecha > 0 ? (
            <p className="rv-vg__nota" data-tono="bad">{tx('rest.no_tenian_fecha_de_seccion_y', { miles: miles(r.sinFecha), plural: plural(r.sinFecha, tx('rest.w_fila'), tx('rest.w_filas')) })}</p>
          ) : null}
          {r.dias.length > 0 ? (
            <TablaBase etiqueta={tx('rest.cajas_por_estatus_y_por_dia')} columnas={columnas} filas={r.dias} idFila={(d) => d.fecha} densa tarjetaMovil />
          ) : null}
        </div>
      </Tarjeta>

      <Tarjeta titulo={tx('rest.filas_que_no_cuadran')} info="vigia_importacion.incoherencias">
        {r.totalIncoherencias === 0 ? (
          <p className="rv-vg__nota" data-testid="sin-incoherencias">{tx('rest.ninguna_fila_se_contradice_lo_que')}</p>
        ) : (
          <div className="rv-vg__pila">
            <ul className="rv-vg__lista rv-vg__nota" data-testid="incoherencias">
              {r.incoherencias.map((i, n) => (
                <li key={`${i.lineaCsv}-${i.codigo}-${n}`}>
                  <span className="rv-vg__medio">{tx('rest.linea', { miles: miles(i.lineaCsv), dia: dia(i.fecha) })}{i.caja ? `, caja ${i.caja}` : ''}:</span>{' '}
                  {i.mensaje}
                </li>
              ))}
            </ul>
            {r.totalIncoherencias > r.incoherencias.length ? (
              <p className="rv-vg__micro">{tx('rest.y_mas_en_el_csv', { miles: miles(r.totalIncoherencias - r.incoherencias.length) })}</p>
            ) : null}
          </div>
        )}
      </Tarjeta>

      <Tarjeta titulo={tx('rest.comparacion_con_track_trace')} info="vigia_importacion.track_trace">
        {c === null ? (
          <p className="rv-vg__nota" data-testid="sin-tt">{tx('rest.track_amp_trace_todavia_no_esta')}</p>
        ) : (
          <p className="rv-vg__nota" data-testid="con-tt">{tx('rest.coinciden_y_no', { miles: miles(c.comparadas), plural: plural(c.comparadas, tx('rest.w_caja_comparada'), tx('rest.w_cajas_comparadas')), miles2: miles(c.coinciden), miles3: miles(c.difieren.length) })}{c.difieren.length > 0 ? ` No coinciden: ${c.difieren.slice(0, 20).join(', ')}.` : ''}
          </p>
        )}
      </Tarjeta>

      {r.totalCajas > 0 ? (
        <div className="rv-vg__pila--s">
          <div><DescargarCsv csv={r.csv} /></div>
          <p className="rv-vg__micro">{tx('rest.para_que_el_equipo_lo_pegue')}</p>
        </div>
      ) : null}
    </div>
  );
}

export function VistaImportacionVigia({ sufijo, accion }: { sufijo: string; accion: AccionImportacion }) {
  const { t: tx } = useT('agentes', agentesEs);
  return (
    <MarcoPagina titulo={tx('rest.estatus_de_importacion')} apoyo={tx('rest.sube_el_programa_del_dia_y')}>
      <nav aria-label={tx('rest.volver')}>{ricoT(tx('rest.e0_volver_a_servicio_al_cliente'), { e0: (c) => <Link href={`/dashboard/agentes/vigia${sufijo}`} className="rv-vg__enlace">{c}</Link> })}</nav>

      <p role="note" className="rv-vg__icono-linea rv-vg__nota" data-testid="rotulo">
        <Icono icono={TriangleAlert} tam={14} />{ROTULO_DERIVADO}
      </p>

      <Tarjeta titulo={tx('rest.subir_el_programa_del_dia')} info="vigia_importacion.subir">
        <Forma accion={accion} />
      </Tarjeta>
    </MarcoPagina>
  );
}
