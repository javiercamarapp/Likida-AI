'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Download, PackageCheck, TriangleAlert, Upload } from 'lucide-react';
import { AvisoResultado } from '../../../../admin/ui/aviso-resultado';
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

const CAMPO = 'hairline rounded-lg px-2.5 h-9 text-[13px] outline-none focus:border-[var(--muted)] w-full';
const ETIQUETA = 'block text-[11px] font-medium mb-1';
const VACIO = 'Carga el programa del día para ver el estatus.';

function Enviar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="hairline rounded-lg px-3 h-9 text-[12.5px] inline-flex items-center gap-1.5 disabled:opacity-60 hover:bg-[var(--canvas)]">
      <Upload width={14} height={14} strokeWidth={1.75} aria-hidden />{pending ? 'Leyendo el archivo…' : 'Subir y ver el estatus'}
    </button>
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
    <button type="button" onClick={descargar} className="hairline rounded-lg px-3 h-9 text-[12.5px] inline-flex items-center gap-1.5 hover:bg-[var(--canvas)]">
      <Download width={14} height={14} strokeWidth={1.75} aria-hidden />Descargar CSV
    </button>
  );
}

function Forma({ accion }: { accion: AccionImportacion }) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <div className="space-y-4">
      <form action={despachar} className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <label>
            <span className={ETIQUETA}>Terminal</span>
            <input name="terminal" required maxLength={40} placeholder="Por ejemplo, GDL" className={CAMPO} autoComplete="off" />
          </label>
          <label>
            <span className={ETIQUETA}>Archivo del programa (CSV, hasta {TOPE_ARCHIVO_IMPORTACION_BYTES / (1024 * 1024)} MB)</span>
            <input name="archivo" type="file" required accept=".csv,.txt,text/csv" className={`${CAMPO} py-1.5 h-auto`} />
          </label>
        </div>
        <p className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
          Aquí solo se lee el archivo para calcular el estatus: no se guarda ni se escribe en ningún otro sistema.
          El Excel con colores (.xlsx) todavía no se puede leer: guárdalo como CSV.
        </p>
        <Enviar />
      </form>
      <Salida estado={estado} />
    </div>
  );
}

/** Lo que hay debajo del formulario: el error en llano, el tablero, o el estado vacío. */
export function Salida({ estado }: { estado: ResultadoImportacion }) {
  if (estado && !estado.ok) return <AvisoResultado estado={estado} />;
  if (estado?.ok) return <Tablero r={estado.resumen} />;
  return <p className="text-[12.5px]" style={{ color: 'var(--muted)' }} data-testid="vacio">{VACIO}</p>;
}

function Tablero({ r }: { r: ResumenImportacion }) {
  const c = r.comparacion;
  return (
    <div className="space-y-4" aria-live="polite">
      <div className="space-y-1.5">
        <h3 className="font-display text-[14px] font-semibold">Estatus por día</h3>
        <p className="text-[13px]" data-testid="resumen">
          {r.totalCajas === 0
            ? `No encontré cajas de importación en la terminal ${r.terminal}.`
            : `${miles(r.totalCajas)} ${plural(r.totalCajas, 'caja', 'cajas')} de importación en ${miles(r.dias.length)} ${plural(r.dias.length, 'día', 'días')}, terminal ${r.terminal}.`}
          {r.filasOtrasSecciones > 0
            ? ` ${miles(r.filasOtrasSecciones)} ${plural(r.filasOtrasSecciones, 'fila', 'filas')} de otras secciones no cuentan aquí.`
            : ''}
        </p>
        {r.sinFecha > 0 ? (
          <p className="text-[12.5px]" style={{ color: 'var(--bad)' }}>
            {miles(r.sinFecha)} {plural(r.sinFecha, 'fila', 'filas')} no tenían fecha de sección y no se contaron.
          </p>
        ) : null}
      </div>

      {r.dias.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]" aria-label="Cajas por estatus y por día">
            <thead>
              <tr className="text-left" style={{ color: 'var(--muted)' }}>
                <th className="font-medium py-1 pr-3">Día</th>
                <th className="font-medium py-1 pr-3 text-right">Cajas</th>
                <th className="font-medium py-1 pr-3 text-right">{ETIQUETA_ESTADO.patio}</th>
                <th className="font-medium py-1 pr-3 text-right">{ETIQUETA_ESTADO.pend_cruce}</th>
                <th className="font-medium py-1 pr-3 text-right">{ETIQUETA_ESTADO.en_ruta}</th>
                <th className="font-medium py-1 pr-3 text-right">{ETIQUETA_DOCS.listo}</th>
                <th className="font-medium py-1 pr-3 text-right">{ETIQUETA_DOCS.pend_requisito}</th>
                <th className="font-medium py-1 text-right">Sin estatus</th>
              </tr>
            </thead>
            <tbody>
              {r.dias.map((d) => (
                <tr key={d.fecha} className="border-t" style={{ borderColor: 'var(--line)' }} data-dia={d.fecha}>
                  <td className="py-1 pr-3">{dia(d.fecha)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{miles(d.cajas)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{miles(d.porEstado.patio)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{miles(d.porEstado.pend_cruce)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{miles(d.porEstado.en_ruta)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{miles(d.porDocs.listo)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{miles(d.porDocs.pend_requisito)}</td>
                  <td className="py-1 text-right tabular-nums">{miles(d.porEstado.desconocido)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <h3 className="font-display text-[14px] font-semibold">Filas que no cuadran</h3>
        {r.totalIncoherencias === 0 ? (
          <p className="text-[12.5px]" data-testid="sin-incoherencias">Ninguna fila se contradice: lo que dice TRANSITO y lo que dice CCP es coherente.</p>
        ) : (
          <>
            <ul className="text-[12.5px] space-y-1" data-testid="incoherencias">
              {r.incoherencias.map((i, n) => (
                <li key={`${i.lineaCsv}-${i.codigo}-${n}`}>
                  <span className="font-medium">Línea {miles(i.lineaCsv)} ({dia(i.fecha)}){i.caja ? `, caja ${i.caja}` : ''}:</span>{' '}
                  {i.mensaje}
                </li>
              ))}
            </ul>
            {r.totalIncoherencias > r.incoherencias.length ? (
              <p className="text-[11.5px]" style={{ color: 'var(--muted)' }}>Y {miles(r.totalIncoherencias - r.incoherencias.length)} más en el CSV.</p>
            ) : null}
          </>
        )}
      </div>

      <div className="space-y-1.5">
        <h3 className="font-display text-[14px] font-semibold">Comparación con Track &amp; Trace</h3>
        {c === null ? (
          <p className="text-[12.5px]" style={{ color: 'var(--muted)' }} data-testid="sin-tt">
            Track &amp; Trace todavía no está conectado: no hay con qué comparar. Cuando lo esté, aquí aparecerán las cajas donde no coincidan.
          </p>
        ) : (
          <p className="text-[12.5px]" data-testid="con-tt">
            {miles(c.comparadas)} {plural(c.comparadas, 'caja comparada', 'cajas comparadas')}: {miles(c.coinciden)} coinciden y {miles(c.difieren.length)} no.
            {c.difieren.length > 0 ? ` No coinciden: ${c.difieren.slice(0, 20).join(', ')}.` : ''}
          </p>
        )}
      </div>

      {r.totalCajas > 0 ? (
        <div className="space-y-1.5">
          <DescargarCsv csv={r.csv} />
          <p className="text-[11.5px]" style={{ color: 'var(--muted)' }}>Para que el equipo lo pegue en su programa, en lugar de escribirlo a mano.</p>
        </div>
      ) : null}
    </div>
  );
}

export function VistaImportacionVigia({ sufijo, accion }: { sufijo: string; accion: AccionImportacion }) {
  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <div className="px-5 h-11 flex items-center justify-between gap-3 border-b shrink-0" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
          <div className="flex items-center gap-2 text-[13px] font-medium min-w-0">
            <PackageCheck width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} aria-hidden />
            <span className="truncate">Estatus de importación</span>
          </div>
        </div>
        <div className="px-5 py-5 flex-1 space-y-4">
          <nav aria-label="Volver" className="text-[12.5px]">
            <Link href={`/dashboard/agentes/vigia${sufijo}`} className="hairline rounded-lg px-3 py-1.5 transition-colors hover:bg-[var(--canvas)]">Volver a servicio al cliente</Link>
          </nav>

          <p role="note" className="flex items-start gap-2 text-[12.5px] px-3.5 py-2.5 rounded-lg" style={{ background: 'var(--canvas)' }} data-testid="rotulo">
            <TriangleAlert aria-hidden width={15} height={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />{ROTULO_DERIVADO}
          </p>

          <section className="card p-4 space-y-3" aria-labelledby="importacion-subir">
            <h2 id="importacion-subir" className="font-display text-[15px] font-semibold">Subir el programa del día</h2>
            <Forma accion={accion} />
          </section>
        </div>
      </div>
    </main>
  );
}
