'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { CalendarDays, TriangleAlert, Upload } from 'lucide-react';
import { AvisoResultado } from '../../../../admin/ui/aviso-resultado';

// ═══════════════════════════════════════════════════════════════════════════
// LA PANTALLA DE CARGA DEL PROGRAMA DE DESPACHO (Agente 4, T-A4-07).
//
// Hoy el ejecutivo mantiene el programa en un Excel a mano (levantamiento 747a3730 ~02:19):
// subir el archivo del día es la entrada mínima mientras no haya Drive/API. Esta pantalla solo
// sube y EXPLICA lo que se entendió, en lenguaje llano: cuántas filas, de cuántos días, cuáles no
// se pudieron leer y por qué. Cero pesos. Los números del resultado vienen del servidor; aquí solo
// se pintan.
// ═══════════════════════════════════════════════════════════════════════════

/** Tope del archivo, en bytes (el mismo que el de Carta Porte). La página lo valida; aquí solo se dice. */
export const TOPE_ARCHIVO_PROGRAMA_BYTES = 12 * 1024 * 1024;

export interface DiaPrograma { fecha: string; filas: number; conAviso: number; sinCaja: number }
export interface FilaConAviso { lineaCsv: number; fecha: string | null; avisos: string[] }
export interface FilaDescartada { lineaCsv: number; motivo: string }

export interface ResumenPrograma {
  terminal: string;
  /** Filas de datos que entregó el lector (antes de descartar). */
  leidas: number;
  /** Filas que se pudieron entender. */
  validas: number;
  dias: number;
  porDia: DiaPrograma[];
  totalDescartadas: number;
  /** Las primeras; el total va en `totalDescartadas`. */
  descartadas: FilaDescartada[];
  totalConAviso: number;
  filasConAviso: FilaConAviso[];
  /** Avisos del archivo completo (recortes, columnas faltantes…), ya en lenguaje llano. */
  avisosArchivo: string[];
  /** Filas sin fecha de sección: no se pudieron guardar. */
  sinFecha: number;
  /** Qué hizo la carga contra lo que ya estaba guardado. */
  guardado: { yaCargado: boolean; nuevas: number; cambiadas: number; sinCambio: number; desaparecidas: number };
}

export type ResultadoPrograma =
  | null
  | { ok: false; error: string }
  | { ok: true; resumen: ResumenPrograma };

export type AccionPrograma = (previo: ResultadoPrograma, fd: FormData) => Promise<ResultadoPrograma>;

/** 1087 → «1 087». */
function miles(n: number): string {
  const d = String(Math.trunc(n));
  let out = '';
  for (let i = 0; i < d.length; i++) {
    if (i > 0 && (d.length - i) % 3 === 0) out += ' ';
    out += d[i];
  }
  return out;
}

/** AAAA-MM-DD → DD/MM/AAAA, sin pasar por Date (no hay zona que valga aquí). */
function dia(fecha: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : fecha;
}

const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);

const MOTIVOS: Record<string, string> = {
  sin_caja_unidad_ni_cliente: 'no traía caja, unidad ni cliente',
};

const CAMPO = 'hairline rounded-lg px-2.5 h-9 text-[13px] outline-none focus:border-[var(--muted)] w-full';
const ETIQUETA = 'block text-[11px] font-medium mb-1';

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2 text-[12.5px] px-3.5 py-2.5 rounded-lg" style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>
      <TriangleAlert aria-hidden width={15} height={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />{children}
    </p>
  );
}

function Enviar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="hairline rounded-lg px-3 h-9 text-[12.5px] inline-flex items-center gap-1.5 disabled:opacity-60 hover:bg-[var(--canvas)]">
      <Upload width={14} height={14} strokeWidth={1.75} aria-hidden />{pending ? 'Leyendo el archivo…' : 'Subir y leer'}
    </button>
  );
}

const VACIO = 'Aún no has cargado un programa. Sube el archivo de hoy y aquí verás qué entendí de él.';

function FormaSubir({ accion }: { accion: AccionPrograma }) {
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
            <span className={ETIQUETA}>Archivo del programa (CSV, hasta {TOPE_ARCHIVO_PROGRAMA_BYTES / (1024 * 1024)} MB)</span>
            <input name="archivo" type="file" required accept=".csv,.txt,text/csv" className={`${CAMPO} py-1.5 h-auto`} />
          </label>
        </div>
        <p className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
          Sube el archivo completo del día: si ya lo habías subido, no se duplica nada; si cambió, se guarda qué cambió.
          El Excel con colores (.xlsx) todavía no se puede leer: guárdalo como CSV.
        </p>
        <Enviar />
      </form>
      <Salida estado={estado} />
    </div>
  );
}

/** Lo que hay debajo del formulario: el error en llano, lo que se entendió, o el estado vacío. */
export function Salida({ estado }: { estado: ResultadoPrograma }) {
  if (estado && !estado.ok) return <AvisoResultado estado={estado} />;
  if (estado?.ok) return <Resultado resumen={estado.resumen} />;
  return <p className="text-[12.5px]" style={{ color: 'var(--muted)' }} data-testid="vacio">{VACIO}</p>;
}

function Resultado({ resumen: r }: { resumen: ResumenPrograma }) {
  const g = r.guardado;
  return (
    <div className="space-y-4" aria-live="polite">
      <div className="space-y-1.5">
        <h3 className="font-display text-[14px] font-semibold">Qué entendí</h3>
        <p className="text-[13px]">
          Leí {miles(r.leidas)} {plural(r.leidas, 'fila', 'filas')} de {miles(r.dias)} {plural(r.dias, 'día', 'días')} en la terminal {r.terminal}.
          {r.totalDescartadas > 0
            ? ` ${miles(r.totalDescartadas)} no se pudieron leer.`
            : ' Todas se pudieron leer.'}
        </p>
        <p className="text-[13px]" data-testid="guardado">
          {g.yaCargado
            ? 'Este archivo ya estaba cargado: no cambié nada.'
            : `Guardé ${miles(g.nuevas)} ${plural(g.nuevas, 'fila nueva', 'filas nuevas')}, ${miles(g.cambiadas)} ${plural(g.cambiadas, 'con cambios', 'con cambios')} y ${miles(g.sinCambio)} sin cambios.`
            + (g.desaparecidas > 0 ? ` ${miles(g.desaparecidas)} ${plural(g.desaparecidas, 'ya no viene', 'ya no vienen')} en el archivo: las dejé ocultas, no las borré.` : '')}
        </p>
        {r.sinFecha > 0 ? (
          <p className="text-[12.5px]" style={{ color: 'var(--bad)' }}>
            {miles(r.sinFecha)} {plural(r.sinFecha, 'fila', 'filas')} no tenían fecha de sección y no se guardaron.
          </p>
        ) : null}
      </div>

      {r.avisosArchivo.length > 0 ? (
        <ul className="text-[12.5px] space-y-1 list-disc pl-5" aria-label="Avisos del archivo">
          {r.avisosArchivo.map((a, i) => <li key={i}>{a}</li>)}
        </ul>
      ) : null}

      {r.descartadas.length > 0 ? (
        <div className="space-y-1.5">
          <h3 className="font-display text-[14px] font-semibold">Lo que descarté</h3>
          <ul className="text-[12.5px] space-y-0.5 list-disc pl-5">
            {r.descartadas.map((d) => <li key={d.lineaCsv}>Línea {miles(d.lineaCsv)} del archivo: {MOTIVOS[d.motivo] ?? 'no se pudo entender'}.</li>)}
          </ul>
          {r.totalDescartadas > r.descartadas.length ? (
            <p className="text-[11.5px]" style={{ color: 'var(--muted)' }}>Y {miles(r.totalDescartadas - r.descartadas.length)} más.</p>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-1.5">
        <h3 className="font-display text-[14px] font-semibold">Por día</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left" style={{ color: 'var(--muted)' }}>
                <th className="font-medium py-1 pr-3">Día</th>
                <th className="font-medium py-1 pr-3 text-right">Filas</th>
                <th className="font-medium py-1 pr-3 text-right">Sin caja</th>
                <th className="font-medium py-1 text-right">Con aviso</th>
              </tr>
            </thead>
            <tbody>
              {r.porDia.map((d) => (
                <tr key={d.fecha} className="border-t" style={{ borderColor: 'var(--line)' }}>
                  <td className="py-1 pr-3">{dia(d.fecha)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{miles(d.filas)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{miles(d.sinCaja)}</td>
                  <td className="py-1 text-right tabular-nums">{miles(d.conAviso)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {r.filasConAviso.length > 0 ? (
        <div className="space-y-1.5">
          <h3 className="font-display text-[14px] font-semibold">Filas que conviene revisar</h3>
          <ul className="text-[12.5px] space-y-1">
            {r.filasConAviso.map((f) => (
              <li key={f.lineaCsv}>
                <span className="font-medium">Línea {miles(f.lineaCsv)}{f.fecha ? ` (${dia(f.fecha)})` : ''}:</span>{' '}
                {f.avisos.join(' ')}
              </li>
            ))}
          </ul>
          {r.totalConAviso > r.filasConAviso.length ? (
            <p className="text-[11.5px]" style={{ color: 'var(--muted)' }}>Y {miles(r.totalConAviso - r.filasConAviso.length)} filas más con aviso.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function VistaProgramaVigia({ sufijo, puedeEscribir, vigiaEncendido, accion }: {
  sufijo: string;
  /** Solo quien opera el despacho sube el archivo; el resto mira. */
  puedeEscribir: boolean;
  /** `null` = no se pudo leer la configuración del Vigía. */
  vigiaEncendido: boolean | null;
  accion: AccionPrograma;
}) {
  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <div className="px-5 h-11 flex items-center justify-between gap-3 border-b shrink-0" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
          <div className="flex items-center gap-2 text-[13px] font-medium min-w-0">
            <CalendarDays width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} aria-hidden />
            <span className="truncate">Programa de despacho</span>
          </div>
        </div>
        <div className="px-5 py-5 flex-1 space-y-4">
          <nav aria-label="Volver" className="text-[12.5px]">
            <Link href={`/dashboard/agentes/vigia${sufijo}`} className="hairline rounded-lg px-3 py-1.5 transition-colors hover:bg-[var(--canvas)]">Volver a servicio al cliente</Link>
          </nav>

          {vigiaEncendido === false ? (
            <Aviso>El Vigía está apagado: el programa se guarda, pero no se avisa a ningún cliente hasta que el dueño lo encienda.</Aviso>
          ) : null}
          {vigiaEncendido === null ? (
            <p className="text-[12px]" style={{ color: 'var(--muted)' }}>No pude confirmar si el Vigía está encendido.</p>
          ) : null}

          <section className="card p-4 space-y-3" aria-labelledby="programa-subir">
            <h2 id="programa-subir" className="font-display text-[15px] font-semibold">Subir el programa del día</h2>
            {puedeEscribir ? (
              <FormaSubir accion={accion} />
            ) : (
              <>
              <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>Solo el dueño o el encargado de la flota sube el programa. Tú puedes ver esta pantalla pero no cargar archivos.</p>
              <p className="text-[12.5px]" style={{ color: 'var(--muted)' }} data-testid="vacio">{VACIO}</p>
              </>
            )}
          </section>

        </div>
      </div>
    </main>
  );
}
