'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, FileSpreadsheet, RefreshCw, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { Boton } from '../../ui-v2/componentes/boton';
import MarcaLikida from './marca';
import BloqueRespuesta from './bloques';
import TarjetaAccion from './tarjeta-accion';
import { TrazaFinal, TrazaViva, textoMs } from './traza';
import { descargar, repartoACsv, serieACsv, tablaACsv, textoParaCopiar, visualesDe } from './exportar';
import { useMovimientoReducido } from './movimiento';
import type { PasoTraza, Respuesta } from './respuestas';
import type { Turno } from './use-analista';
import { useT } from '@/lib/i18n/proveedor';
import { resto as restoEs } from '@/lib/i18n/es/resto';
import { rico } from '@/lib/i18n/rico';

/** Escritura progresiva (como Vexa): máx. 4,5 s aunque la respuesta sea larga; con «reducir movimiento» sale completa de una vez.
 *  El texto COMPLETO va siempre en el árbol de accesibilidad (`rv-sr`) para que el lector de pantalla lo anuncie UNA vez, y lo que
 *  se ve escribirse es `aria-hidden`: nada de leer letra por letra. Avisa con `onListo` cuando terminó: los bloques y las acciones
 *  esperan a ese momento (la respuesta «se arma» en orden, sin depender de un temporizador aparte). */
function TextoRespuesta({ texto, escribir, onListo }: { texto: string; escribir: boolean; onListo: () => void }) {
  const reducido = useMovimientoReducido();
  const progresivo = escribir && !reducido && texto.length > 0;
  const [escrito, setEscrito] = useState(0);
  useEffect(() => {
    if (!progresivo) return;
    const largo = texto.length;
    const ritmo = Math.max(0.06, largo / 4500);
    const t0 = performance.now();
    let raf = 0;
    const paso = (t: number) => {
      const n = Math.min(largo, Math.floor((t - t0) * ritmo));
      setEscrito(n);
      if (n < largo) raf = requestAnimationFrame(paso);
    };
    raf = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(raf);
  }, [progresivo, texto]);
  const terminado = !progresivo || escrito >= texto.length;
  useEffect(() => { if (terminado) onListo(); }, [terminado, onListo]);
  if (terminado) return <p className="rv-chat__texto">{texto}</p>;
  return (
    <p className="rv-chat__texto" aria-busy="true">
      <span aria-hidden="true">{texto.slice(0, escrito)}</span>
      <span className="rv-sr">{texto}</span>
    </p>
  );
}

export function BurbujaUsuario({ turno }: { turno: Turno }) {
  return (
    <div className="rv-chat__usuario" data-nuevo={turno.nuevo}>
      <div className="rv-chat__burbuja">{turno.q}</div>
    </div>
  );
}

function Sello({ r }: { r: Respuesta }) {
  const { t: tx } = useT('resto', restoEs);
  if (!r.origen) return null;
  const partes = r.origen === 'analista' || r.origen === 'copiloto'
    ? [r.origen === 'copiloto' ? 'Respuesta del copiloto' : 'Respuesta del analista', r.hora, r.ms !== undefined ? textoMs(r.ms) : undefined]
    : [tx('ch.respuesta_de_reserva_con_lo_ultimo'), r.hora];
  return <p className="rv-chat__sello" data-origen={r.origen}>{partes.filter(Boolean).join(' · ')}</p>;
}

export function RespuestaVista({ turno, ultimo, ocupado, fase, pasosVivos, onRepetir, acciones = false, endpointAccion, onEjecutada }: {
  turno: Turno;
  ultimo: boolean;
  ocupado: boolean;
  fase: string;
  pasosVivos: PasoTraza[];
  onRepetir: (id: string) => void;
  /** Modo superadmin: pinta la acción propuesta con su confirmación. Apagado, el bloque `accion` jamás se pinta (no existe en el cliente). */
  acciones?: boolean;
  endpointAccion?: string;
  onEjecutada?: (mensaje: string) => void;
}) {
  const { t: tx } = useT('resto', restoEs);
  const { r } = turno;
  const [copiado, setCopiado] = useState(false);
  const [errorArchivo, setErrorArchivo] = useState(false);
  const [escrita, setEscrita] = useState(!turno.nuevo);
  const alListo = useCallback(() => setEscrita(true), []);
  // Una respuesta que NO se escribe (fallo, historial, sin texto) ya está lista; las demás avisan al terminar de escribirse.
  const terminado = escrita || r.fallo === true || !r.texto;
  useEffect(() => {
    if (!copiado) return;
    const t = setTimeout(() => setCopiado(false), 1500);
    return () => clearTimeout(t);
  }, [copiado]);

  if (r.pendiente) return <div className="rv-chat__respuesta" data-nuevo={turno.nuevo}><TrazaViva fase={fase} pasos={pasosVivos} /></div>;
  if (r.cancelada) return <p className="rv-chat__cancelada" data-nuevo={turno.nuevo}>{r.texto}</p>;
  if (!turno.q.trim() && !r.texto) return null;

  const visuales = visualesDe(r);
  const tablas = visuales.filter((v): v is Extract<typeof v, { tipo: 'tabla' }> => v.tipo === 'tabla');
  const graficas = visuales.filter((v): v is Extract<typeof v, { tipo: 'serie' | 'dona' }> => v.tipo === 'serie' || v.tipo === 'dona');
  async function copiar() {
    try { await navigator.clipboard.writeText(textoParaCopiar(r)); setCopiado(true); } catch { setCopiado(false); }
  }
  return (
    <div className="rv-chat__respuesta" data-nuevo={turno.nuevo} data-fallo={r.fallo || undefined}>
      <div className="rv-chat__respuesta-texto">
        <MarcaLikida />
        {r.fallo ? (
          <div className="rv-chat__aviso" role="alert">
            <TriangleAlert width={16} height={16} aria-hidden="true" />
            <p className="rv-chat__texto">{r.texto}</p>
          </div>
        ) : <TextoRespuesta texto={r.texto} escribir={turno.nuevo} onListo={alListo} />}
      </div>
      {terminado && visuales.map((v, j) => <BloqueRespuesta t={tx} key={j} v={v} indice={j} />)}
      {terminado && acciones && r.accion && (r.archivada ? (
        // Una acción reabierta del historial NO trae botón: la previsualización vieja describe el estado de AQUEL día; ejecutarla hoy
        // firmaría sobre un efecto que ya no es verdad. Se pide de nuevo y el servidor la re-propone.
        <section className="rv-tarjeta rv-chat__bloque rv-accion" data-estado="archivada">
          <p className="rv-accion__linea">{tx('ch.propuesta_archivada_del_historial')}<span className="rv-accion__objetivo">{r.accion.objetivo}</span>{tx('ch.para_ejecutarla_pidela_de_nuevo_se')}</p>
        </section>
      ) : (
        <TarjetaAccion a={r.accion} endpoint={endpointAccion ?? ''} onEjecutada={(m) => onEjecutada?.(m)} />
      ))}
      {terminado && r.fuentes && r.fuentes.length > 0 && (
        <div className="rv-chat__fuentes" role="group" aria-label={tx('ch.fuentes')}>{rico(tx('ch.e0_fuentes_e0'), { e0: (c) => <span className="rv-chat__nota">{c}</span> })}{r.fuentes.map((f) => (
            <Link key={f.ruta} href={f.ruta} className="rv-chip rv-chat__fuente">{f.etiqueta}<ExternalLink width={12} height={12} strokeWidth={1.75} aria-hidden="true" /></Link>
          ))}
        </div>
      )}
      {terminado && r.pasos && <TrazaFinal pasos={r.pasos} ms={r.ms} />}
      {terminado && <Sello r={r} />}
      {terminado && r.texto.trim() && (
        <div className="rv-chat__acciones" role="group" aria-label={tx('ch.acciones_de_la_respuesta')}>
          <Boton onClick={() => void copiar()}>
            {copiado ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            <span>{copiado ? tx('ch.copiado') : tx('ch.copiar')}</span>
          </Boton>
          {tablas.map((t, i) => (
            <Boton key={i}
              aria-label={tablas.length > 1 ? tx('ch.descargar_la_tabla_como_csv', { v: i + 1 }) : tx('ch.descargar_la_tabla_como_csv_2')}
              onClick={() => setErrorArchivo(!descargar(`likida-respuesta-${i + 1}.csv`, tablaACsv(t.filas), 'text/csv;charset=utf-8'))}>
              <FileSpreadsheet aria-hidden="true" /><span>CSV</span>
            </Boton>
          ))}
          {graficas.map((g, i) => (
            <Boton key={`g${i}`}
              aria-label={graficas.length > 1 ? tx('ch.descargar_los_datos_de_la_grafica', { v: i + 1 }) : tx('ch.descargar_los_datos_de_la_grafica_2')}
              onClick={() => setErrorArchivo(!descargar(`likida-grafica-${i + 1}.csv`, g.tipo === 'serie' ? serieACsv(g.puntos) : repartoACsv(g.segmentos), 'text/csv;charset=utf-8'))}>
              <FileSpreadsheet aria-hidden="true" strokeWidth={1.75} />{rico(tx('ch.e0_datos_csv_e0'), { e0: (c) => <span>{c}</span> })}</Boton>
          ))}
          {ultimo && (r.origen === 'analista' || r.origen === 'copiloto') && (
            <Boton className="rv-chat__solo" disabled={ocupado} onClick={() => onRepetir(turno.id)}>
              <RefreshCw aria-hidden="true" />{rico(tx('ch.e0_regenerar_e0'), { e0: (c) => <span>{c}</span> })}</Boton>
          )}
          {errorArchivo && <span role="alert" className="rv-chat__error-linea">{tx('ch.no_se_pudo_crear_el_archivo')}</span>}
        </div>
      )}
      {r.fallo && ultimo && (
        <div>
          <Boton disabled={ocupado} onClick={() => onRepetir(turno.id)}>
            <RefreshCw aria-hidden="true" />{rico(tx('ch.e0_reintentar_e0'), { e0: (c) => <span>{c}</span> })}</Boton>
        </div>
      )}
    </div>
  );
}
