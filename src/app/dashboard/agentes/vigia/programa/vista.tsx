'use client';

import '../vigia.css';
import { AvisoResultado, Aviso as AvisoV2, Boton, CampoArchivo, CampoTexto, Icono, MarcoPagina, TablaBase, Tarjeta, type ColumnaBase } from '@/app/ui-v2/componentes';
import Link from 'next/link';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Upload } from 'lucide-react';
import { recortarRellenoCsv, TOPE_SUBIDA_BYTES } from './recortar_relleno';

// ═══════════════════════════════════════════════════════════════════════════
// LA PANTALLA DE CARGA DEL PROGRAMA DE DESPACHO (Agente 4, T-A4-07).
//
// Hoy el ejecutivo mantiene el programa en un Excel a mano (levantamiento 747a3730 ~02:19):
// subir el archivo del día es la entrada mínima mientras no haya Drive/API. Esta pantalla solo
// sube y EXPLICA lo que se entendió, en lenguaje llano: cuántas filas, de cuántos días, cuáles no
// se pudieron leer y por qué. Cero pesos. Los números del resultado vienen del servidor; aquí solo
// se pintan.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tope del archivo, en bytes. A39-A4-02: es el REAL de la plataforma (Vercel Functions corta en 4.5 MB; antes se prometían 12 MB y un CSV de
 * 6 MB moría sin mensaje). El navegador quita antes el relleno de `;` de cada línea (`recortar_relleno.ts`), que es lo que hace pesar 27 MB
 * al programa real. La página lo valida; aquí solo se dice.
 */
export const TOPE_ARCHIVO_PROGRAMA_BYTES = TOPE_SUBIDA_BYTES;

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

function Aviso({ children }: { children: React.ReactNode }) {
  return <AvisoV2 tono="error">{children}</AvisoV2>;
}

function Enviar() {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" loading={pending} icono={<Icono icono={Upload} tam={14} />}>{pending ? 'Leyendo el archivo…' : 'Subir y leer'}</Boton>
  );
}

const VACIO = 'Aún no has cargado un programa. Sube el archivo de hoy y aquí verás qué entendí de él.';

function FormaSubir({ accion }: { accion: AccionPrograma }) {
  const [estado, despachar] = useActionState(accion, null);
  const [local, setLocal] = useState<string | null>(null);
  // A39-A4-02: antes de subir, se quita el relleno de `;` y se comprueba el tope REAL, con un mensaje claro en vez de un fallo genérico.
  async function preparar(fd: FormData): Promise<void> {
    setLocal(null);
    const archivo = fd.get('archivo');
    if (archivo instanceof File && archivo.size > 0) {
      let listo: File = archivo;
      if (archivo.size > 64 * 1024) {
        const recortado = recortarRellenoCsv(await archivo.text());
        listo = new File([recortado], archivo.name, { type: archivo.type || 'text/csv' });
      }
      if (listo.size > TOPE_ARCHIVO_PROGRAMA_BYTES) {
        setLocal(`El archivo pesa ${(listo.size / (1024 * 1024)).toFixed(1)} MB incluso sin las columnas vacías, y la subida admite hasta ${TOPE_ARCHIVO_PROGRAMA_BYTES / (1024 * 1024)} MB. Sube solo los últimos días del programa.`);
        return;
      }
      fd.set('archivo', listo);
    }
    despachar(fd);
  }
  return (
    <div className="rv-vg__pila">
      <form action={preparar} className="rv-vg__pila">
        <div className="rv-vg__cuad">
          <CampoTexto etiqueta="Terminal" name="terminal" required maxLength={40} placeholder="Por ejemplo, GDL" autoComplete="off" />
          <CampoArchivo etiqueta={`Archivo del programa (CSV, hasta ${TOPE_ARCHIVO_PROGRAMA_BYTES / (1024 * 1024)} MB, sin contar las columnas vacías)`} name="archivo" required accept=".csv,.txt,text/csv" />
        </div>
        <p className="rv-vg__nota">
          Sube el archivo completo del día: si ya lo habías subido, no se duplica nada; si cambió, se guarda qué cambió.
          El Excel con colores (.xlsx) todavía no se puede leer: guárdalo como CSV.
        </p>
        <div><Enviar /></div>
      </form>
      {local && <Aviso>{local}</Aviso>}
      <Salida estado={estado} />
    </div>
  );
}

/** Lo que hay debajo del formulario: el error en llano, lo que se entendió, o el estado vacío. */
export function Salida({ estado }: { estado: ResultadoPrograma }) {
  if (estado && !estado.ok) return <AvisoResultado estado={estado} />;
  if (estado?.ok) return <Resultado resumen={estado.resumen} />;
  return <p className="rv-vg__nota" data-testid="vacio">{VACIO}</p>;
}

function Resultado({ resumen: r }: { resumen: ResumenPrograma }) {
  const g = r.guardado;
  const columnas: readonly ColumnaBase<DiaPrograma>[] = [
    { id: 'dia', titulo: 'Día', principal: true, celda: (d) => dia(d.fecha) },
    { id: 'filas', titulo: 'Filas', alinear: 'der', celda: (d) => miles(d.filas) },
    { id: 'sincaja', titulo: 'Sin caja', alinear: 'der', celda: (d) => miles(d.sinCaja) },
    { id: 'conaviso', titulo: 'Con aviso', alinear: 'der', celda: (d) => miles(d.conAviso) },
  ];
  return (
    <div className="rv-vg__pila" aria-live="polite">
      <Tarjeta titulo="Qué entendí" info="vigia_programa.entendi">
        <div className="rv-vg__pila--s">
          <p>
            Leí {miles(r.leidas)} {plural(r.leidas, 'fila', 'filas')} de {miles(r.dias)} {plural(r.dias, 'día', 'días')} en la terminal {r.terminal}.
            {r.totalDescartadas > 0
              ? ` ${miles(r.totalDescartadas)} no se pudieron leer.`
              : ' Todas se pudieron leer.'}
          </p>
          <p data-testid="guardado">
            {g.yaCargado
              ? 'Este archivo ya estaba cargado: no cambié nada.'
              : `Guardé ${miles(g.nuevas)} ${plural(g.nuevas, 'fila nueva', 'filas nuevas')}, ${miles(g.cambiadas)} ${plural(g.cambiadas, 'con cambios', 'con cambios')} y ${miles(g.sinCambio)} sin cambios.`
              + (g.desaparecidas > 0 ? ` ${miles(g.desaparecidas)} ${plural(g.desaparecidas, 'ya no viene', 'ya no vienen')} en el archivo: las dejé ocultas, no las borré.` : '')}
          </p>
          {r.sinFecha > 0 ? (
            <p className="rv-vg__nota" data-tono="bad">
              {miles(r.sinFecha)} {plural(r.sinFecha, 'fila', 'filas')} no tenían fecha de sección y no se guardaron.
            </p>
          ) : null}
        </div>
      </Tarjeta>

      {r.avisosArchivo.length > 0 ? (
        <ul className="rv-vg__bullets" aria-label="Avisos del archivo">
          {r.avisosArchivo.map((a, i) => <li key={i}>{a}</li>)}
        </ul>
      ) : null}

      {r.descartadas.length > 0 ? (
        <Tarjeta titulo="Lo que descarté" info="vigia_programa.descarte">
          <ul className="rv-vg__bullets">
            {r.descartadas.map((d) => <li key={d.lineaCsv}>Línea {miles(d.lineaCsv)} del archivo: {MOTIVOS[d.motivo] ?? 'no se pudo entender'}.</li>)}
          </ul>
          {r.totalDescartadas > r.descartadas.length ? (
            <p className="rv-vg__micro">Y {miles(r.totalDescartadas - r.descartadas.length)} más.</p>
          ) : null}
        </Tarjeta>
      ) : null}

      <Tarjeta titulo="Por día" info="vigia_programa.por_dia">
        <TablaBase etiqueta="Por día" columnas={columnas} filas={r.porDia} idFila={(d) => d.fecha} densa tarjetaMovil />
      </Tarjeta>

      {r.filasConAviso.length > 0 ? (
        <Tarjeta titulo="Filas que conviene revisar" info="vigia_programa.revisar">
          <ul className="rv-vg__lista rv-vg__nota">
            {r.filasConAviso.map((f) => (
              <li key={f.lineaCsv}>
                <span className="rv-vg__medio">Línea {miles(f.lineaCsv)}{f.fecha ? ` (${dia(f.fecha)})` : ''}:</span>{' '}
                {f.avisos.join(' ')}
              </li>
            ))}
          </ul>
          {r.totalConAviso > r.filasConAviso.length ? (
            <p className="rv-vg__micro">Y {miles(r.totalConAviso - r.filasConAviso.length)} filas más con aviso.</p>
          ) : null}
        </Tarjeta>
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
    <MarcoPagina titulo="Programa de despacho" apoyo="Sube el archivo del programa de despacho para que el Vigía avise a tus clientes.">
      <nav aria-label="Volver">
        <Link href={`/dashboard/agentes/vigia${sufijo}`} className="rv-vg__enlace">Volver a servicio al cliente</Link>
      </nav>

      {vigiaEncendido === false ? (
        <Aviso>El Vigía está apagado: el programa se guarda, pero no se avisa a ningún cliente hasta que el dueño lo encienda.</Aviso>
      ) : null}
      {vigiaEncendido === null ? (
        <p className="rv-vg__nota">No pude confirmar si el Vigía está encendido.</p>
      ) : null}

      <Tarjeta titulo="Subir el programa del día" info="vigia_programa.subir">
        {puedeEscribir ? (
          <FormaSubir accion={accion} />
        ) : (
          <div className="rv-vg__pila">
            <p className="rv-vg__nota">Solo el dueño o el encargado de la flota sube el programa. Tú puedes ver esta pantalla pero no cargar archivos.</p>
            <p className="rv-vg__nota" data-testid="vacio">{VACIO}</p>
          </div>
        )}
      </Tarjeta>
    </MarcoPagina>
  );
}
