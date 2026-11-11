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

const VACIO = 'Carga el programa del día para ver el estatus.';

function Enviar() {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" loading={pending} icono={<Icono icono={Upload} tam={14} />}>{pending ? 'Leyendo el archivo…' : 'Subir y ver el estatus'}</Boton>
  );
}

function DescargarCsv({ csv }: { csv: string }) {
  function descargar() {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'estatus-importacion.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <Boton onClick={descargar} icono={<Icono icono={Download} tam={14} />}>Descargar CSV</Boton>
  );
}

function Forma({ accion }: { accion: AccionImportacion }) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <div className="rv-vg__pila">
      <form action={despachar} className="rv-vg__pila">
        <div className="rv-vg__cuad">
          <CampoTexto etiqueta="Terminal" name="terminal" required maxLength={40} placeholder="Por ejemplo, GDL" autoComplete="off" />
          <CampoArchivo etiqueta={`Archivo del programa (CSV, hasta ${TOPE_ARCHIVO_IMPORTACION_BYTES / (1024 * 1024)} MB)`} name="archivo" required accept=".csv,.txt,text/csv" />
        </div>
        <p className="rv-vg__nota">
          Aquí solo se lee el archivo para calcular el estatus: no se guarda ni se escribe en ningún otro sistema.
          El Excel con colores (.xlsx) todavía no se puede leer: guárdalo como CSV.
        </p>
        <div><Enviar /></div>
      </form>
      <Salida estado={estado} />
    </div>
  );
}

/** Lo que hay debajo del formulario: el error en llano, el tablero, o el estado vacío. */
export function Salida({ estado }: { estado: ResultadoImportacion }) {
  if (estado && !estado.ok) return <AvisoResultado estado={estado} />;
  if (estado?.ok) return <Tablero r={estado.resumen} />;
  return <p className="rv-vg__nota" data-testid="vacio">{VACIO}</p>;
}

function Tablero({ r }: { r: ResumenImportacion }) {
  const c = r.comparacion;
  const columnas: readonly ColumnaBase<DiaImportacion>[] = [
    { id: 'dia', titulo: 'Día', principal: true, celda: (d) => <span data-dia={d.fecha}>{dia(d.fecha)}</span> },
    { id: 'cajas', titulo: 'Cajas', alinear: 'der', celda: (d) => miles(d.cajas) },
    { id: 'patio', titulo: ETIQUETA_ESTADO.patio, alinear: 'der', celda: (d) => miles(d.porEstado.patio) },
    { id: 'cruce', titulo: ETIQUETA_ESTADO.pend_cruce, alinear: 'der', celda: (d) => miles(d.porEstado.pend_cruce) },
    { id: 'ruta', titulo: ETIQUETA_ESTADO.en_ruta, alinear: 'der', celda: (d) => miles(d.porEstado.en_ruta) },
    { id: 'listo', titulo: ETIQUETA_DOCS.listo, alinear: 'der', celda: (d) => miles(d.porDocs.listo) },
    { id: 'pend', titulo: ETIQUETA_DOCS.pend_requisito, alinear: 'der', celda: (d) => miles(d.porDocs.pend_requisito) },
    { id: 'sin', titulo: 'Sin estatus', alinear: 'der', celda: (d) => miles(d.porEstado.desconocido) },
  ];
  return (
    <div className="rv-vg__pila" aria-live="polite">
      <Tarjeta titulo="Estatus por día" info="vigia_importacion.estatus_dia">
        <div className="rv-vg__pila">
          <p data-testid="resumen">
            {r.totalCajas === 0
              ? `No encontré cajas de importación en la terminal ${r.terminal}.`
              : `${miles(r.totalCajas)} ${plural(r.totalCajas, 'caja', 'cajas')} de importación en ${miles(r.dias.length)} ${plural(r.dias.length, 'día', 'días')}, terminal ${r.terminal}.`}
            {r.filasOtrasSecciones > 0
              ? ` ${miles(r.filasOtrasSecciones)} ${plural(r.filasOtrasSecciones, 'fila', 'filas')} de otras secciones no cuentan aquí.`
              : ''}
          </p>
          {r.sinFecha > 0 ? (
            <p className="rv-vg__nota" data-tono="bad">
              {miles(r.sinFecha)} {plural(r.sinFecha, 'fila', 'filas')} no tenían fecha de sección y no se contaron.
            </p>
          ) : null}
          {r.dias.length > 0 ? (
            <TablaBase etiqueta="Cajas por estatus y por día" columnas={columnas} filas={r.dias} idFila={(d) => d.fecha} densa tarjetaMovil />
          ) : null}
        </div>
      </Tarjeta>

      <Tarjeta titulo="Filas que no cuadran" info="vigia_importacion.incoherencias">
        {r.totalIncoherencias === 0 ? (
          <p className="rv-vg__nota" data-testid="sin-incoherencias">Ninguna fila se contradice: lo que dice TRANSITO y lo que dice CCP es coherente.</p>
        ) : (
          <div className="rv-vg__pila">
            <ul className="rv-vg__lista rv-vg__nota" data-testid="incoherencias">
              {r.incoherencias.map((i, n) => (
                <li key={`${i.lineaCsv}-${i.codigo}-${n}`}>
                  <span className="rv-vg__medio">Línea {miles(i.lineaCsv)} ({dia(i.fecha)}){i.caja ? `, caja ${i.caja}` : ''}:</span>{' '}
                  {i.mensaje}
                </li>
              ))}
            </ul>
            {r.totalIncoherencias > r.incoherencias.length ? (
              <p className="rv-vg__micro">Y {miles(r.totalIncoherencias - r.incoherencias.length)} más en el CSV.</p>
            ) : null}
          </div>
        )}
      </Tarjeta>

      <Tarjeta titulo="Comparación con Track & Trace" info="vigia_importacion.track_trace">
        {c === null ? (
          <p className="rv-vg__nota" data-testid="sin-tt">
            Track &amp; Trace todavía no está conectado: no hay con qué comparar. Cuando lo esté, aquí aparecerán las cajas donde no coincidan.
          </p>
        ) : (
          <p className="rv-vg__nota" data-testid="con-tt">
            {miles(c.comparadas)} {plural(c.comparadas, 'caja comparada', 'cajas comparadas')}: {miles(c.coinciden)} coinciden y {miles(c.difieren.length)} no.
            {c.difieren.length > 0 ? ` No coinciden: ${c.difieren.slice(0, 20).join(', ')}.` : ''}
          </p>
        )}
      </Tarjeta>

      {r.totalCajas > 0 ? (
        <div className="rv-vg__pila--s">
          <div><DescargarCsv csv={r.csv} /></div>
          <p className="rv-vg__micro">Para que el equipo lo pegue en su programa, en lugar de escribirlo a mano.</p>
        </div>
      ) : null}
    </div>
  );
}

export function VistaImportacionVigia({ sufijo, accion }: { sufijo: string; accion: AccionImportacion }) {
  return (
    <MarcoPagina titulo="Estatus de importación" apoyo="Sube el programa del día y ve el estatus de cada viaje, derivado del archivo.">
      <nav aria-label="Volver">
        <Link href={`/dashboard/agentes/vigia${sufijo}`} className="rv-vg__enlace">Volver a servicio al cliente</Link>
      </nav>

      <p role="note" className="rv-vg__icono-linea rv-vg__nota" data-testid="rotulo">
        <Icono icono={TriangleAlert} tam={14} />{ROTULO_DERIVADO}
      </p>

      <Tarjeta titulo="Subir el programa del día" info="vigia_importacion.subir">
        <Forma accion={accion} />
      </Tarjeta>
    </MarcoPagina>
  );
}
