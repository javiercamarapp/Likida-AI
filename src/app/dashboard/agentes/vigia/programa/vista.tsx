'use client';

import '../vigia.css';
import { AvisoResultado, Aviso as AvisoV2, Boton, CampoArchivo, CampoTexto, Icono, MarcoPagina, TablaBase, Tarjeta, type ColumnaBase } from '@/app/ui-v2/componentes';
import Link from 'next/link';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Upload } from 'lucide-react';
import { recortarRellenoCsv, TOPE_SUBIDA_BYTES } from './recortar_relleno';
import { useT } from '@/lib/i18n/proveedor';
import { agentes as agentesEs } from '@/lib/i18n/es/agentes';
import { type TAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';
import { rico as ricoT } from '@/lib/i18n/rico';

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

const motivos = (tx: TAgentes = TR_ES.t): Record<string, string> => ({
  sin_caja_unidad_ni_cliente: tx('rest.no_traia_caja_unidad_ni_cliente'),
});

function Aviso({ children }: { children: React.ReactNode }) {
  return <AvisoV2 tono="error">{children}</AvisoV2>;
}

function Enviar() {
  const { t: tx } = useT('agentes', agentesEs);
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" loading={pending} icono={<Icono icono={Upload} tam={14} />}>{pending ? 'Leyendo el archivo…' : tx('rest.subir_y_leer')}</Boton>
  );
}

const vacioTr = (tx: TAgentes = TR_ES.t) => (tx('rest.aun_no_has_cargado_un_programa'));

function FormaSubir({ accion }: { accion: AccionPrograma }) {
  const { t: tx } = useT('agentes', agentesEs);
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
        setLocal(tx('rest.el_archivo_pesa_mb_incluso_sin', { toFixed: (listo.size / (1024 * 1024)).toFixed(1), v: TOPE_ARCHIVO_PROGRAMA_BYTES / (1024 * 1024) }));
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
          <CampoTexto etiqueta={tx('rest.terminal')} name="terminal" required maxLength={40} placeholder={tx('rest.por_ejemplo_gdl')} autoComplete="off" />
          <CampoArchivo etiqueta={tx('rest.archivo_del_programa_csv_hasta_mb', { v: TOPE_ARCHIVO_PROGRAMA_BYTES / (1024 * 1024) })} name="archivo" required accept=".csv,.txt,text/csv" />
        </div>
        <p className="rv-vg__nota">{tx('rest.sube_el_archivo_completo_del_dia')}</p>
        <div><Enviar /></div>
      </form>
      {local && <Aviso>{local}</Aviso>}
      <Salida estado={estado} tx={tx} />
    </div>
  );
}

/** Lo que hay debajo del formulario: el error en llano, lo que se entendió, o el estado vacío. */
export function Salida({ estado, tx = TR_ES.t }: { estado: ResultadoPrograma; tx?: TAgentes }) {
  if (estado && !estado.ok) return <AvisoResultado estado={estado} />;
  if (estado?.ok) return <Resultado resumen={estado.resumen} />;
  return <p className="rv-vg__nota" data-testid="vacio">{vacioTr(tx)}</p>;
}

function Resultado({ resumen: r }: { resumen: ResumenPrograma }) {
  const { t: tx } = useT('agentes', agentesEs);
  const g = r.guardado;
  const columnas: readonly ColumnaBase<DiaPrograma>[] = [
    { id: 'dia', titulo: tx('rest.dia'), principal: true, celda: (d) => dia(d.fecha) },
    { id: 'filas', titulo: tx('rest.filas'), alinear: 'der', celda: (d) => miles(d.filas) },
    { id: 'sincaja', titulo: tx('rest.sin_caja'), alinear: 'der', celda: (d) => miles(d.sinCaja) },
    { id: 'conaviso', titulo: tx('rest.con_aviso'), alinear: 'der', celda: (d) => miles(d.conAviso) },
  ];
  return (
    <div className="rv-vg__pila" aria-live="polite">
      <Tarjeta titulo={tx('rest.que_entendi')} info="vigia_programa.entendi">
        <div className="rv-vg__pila--s">
          <p>{tx('rest.lei_de_en_la_terminal', { miles: miles(r.leidas), plural: plural(r.leidas, tx('rest.w_fila'), tx('rest.w_filas')), miles2: miles(r.dias), plural2: plural(r.dias, tx('rest.w_dia'), tx('rest.w_dias')), terminal: r.terminal })}{r.totalDescartadas > 0
              ? tx('rest.no_se_pudieron_leer', { miles: miles(r.totalDescartadas) })
              : ' Todas se pudieron leer.'}
          </p>
          <p data-testid="guardado">
            {g.yaCargado
              ? tx('rest.este_archivo_ya_estaba_cargado_no')
              : tx('rest.guarde_y_sin_cambios', { miles: miles(g.nuevas), plural: plural(g.nuevas, tx('rest.w_fila_nueva'), tx('rest.w_filas_nuevas')), miles2: miles(g.cambiadas), plural2: plural(g.cambiadas, tx('rest.w_con_cambios'), tx('rest.w_con_cambios')), miles3: miles(g.sinCambio) })
              + (g.desaparecidas > 0 ? tx('rest.en_el_archivo_las_deje_ocultas', { miles: miles(g.desaparecidas), plural: plural(g.desaparecidas, tx('rest.w_ya_no_viene'), tx('rest.w_ya_no_vienen')) }) : '')}
          </p>
          {r.sinFecha > 0 ? (
            <p className="rv-vg__nota" data-tono="bad">{tx('rest.no_tenian_fecha_de_seccion_y_2', { miles: miles(r.sinFecha), plural: plural(r.sinFecha, tx('rest.w_fila'), tx('rest.w_filas')) })}</p>
          ) : null}
        </div>
      </Tarjeta>

      {r.avisosArchivo.length > 0 ? (
        <ul className="rv-vg__bullets" aria-label={tx('rest.avisos_del_archivo')}>
          {r.avisosArchivo.map((a, i) => <li key={i}>{a}</li>)}
        </ul>
      ) : null}

      {r.descartadas.length > 0 ? (
        <Tarjeta titulo={tx('rest.lo_que_descarte')} info="vigia_programa.descarte">
          <ul className="rv-vg__bullets">
            {r.descartadas.map((d) => <li key={d.lineaCsv}>{tx('rest.linea_del_archivo', { miles: miles(d.lineaCsv) })}{' '}{motivos(tx)[d.motivo] ?? tx('rest.no_se_pudo_entender')}.</li>)}
          </ul>
          {r.totalDescartadas > r.descartadas.length ? (
            <p className="rv-vg__micro">{tx('rest.y_mas_2', { miles: miles(r.totalDescartadas - r.descartadas.length) })}</p>
          ) : null}
        </Tarjeta>
      ) : null}

      <Tarjeta titulo={tx('rest.por_dia')} info="vigia_programa.por_dia">
        <TablaBase etiqueta={tx('rest.por_dia')} columnas={columnas} filas={r.porDia} idFila={(d) => d.fecha} densa tarjetaMovil />
      </Tarjeta>

      {r.filasConAviso.length > 0 ? (
        <Tarjeta titulo={tx('rest.filas_que_conviene_revisar')} info="vigia_programa.revisar">
          <ul className="rv-vg__lista rv-vg__nota">
            {r.filasConAviso.map((f) => (
              <li key={f.lineaCsv}>
                <span className="rv-vg__medio">{tx('rest.linea_2')}{' '}{miles(f.lineaCsv)}{f.fecha ? ` (${dia(f.fecha)})` : ''}:</span>{' '}
                {f.avisos.join(' ')}
              </li>
            ))}
          </ul>
          {r.totalConAviso > r.filasConAviso.length ? (
            <p className="rv-vg__micro">{tx('rest.y_filas_mas_con_aviso', { miles: miles(r.totalConAviso - r.filasConAviso.length) })}</p>
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
  const { t: tx } = useT('agentes', agentesEs);
  return (
    <MarcoPagina titulo={tx('rest.programa_de_despacho')} apoyo={tx('rest.sube_el_archivo_del_programa_de')}>
      <nav aria-label={tx('rest.volver')}>{ricoT(tx('rest.e0_volver_a_servicio_al_cliente'), { e0: (c) => <Link href={`/dashboard/agentes/vigia${sufijo}`} className="rv-vg__enlace">{c}</Link> })}</nav>

      {vigiaEncendido === false ? (
        <Aviso>{tx('rest.el_vigia_esta_apagado_el_programa')}</Aviso>
      ) : null}
      {vigiaEncendido === null ? (
        <p className="rv-vg__nota">{tx('rest.no_pude_confirmar_si_el_vigia')}</p>
      ) : null}

      <Tarjeta titulo={tx('rest.subir_el_programa_del_dia')} info="vigia_programa.subir">
        {puedeEscribir ? (
          <FormaSubir accion={accion} />
        ) : (
          <div className="rv-vg__pila">
            <p className="rv-vg__nota">{tx('rest.solo_el_dueno_o_el_encargado_7')}</p>
            <p className="rv-vg__nota" data-testid="vacio">{vacioTr(tx)}</p>
          </div>
        )}
      </Tarjeta>
    </MarcoPagina>
  );
}
