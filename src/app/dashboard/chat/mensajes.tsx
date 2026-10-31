'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, FileSpreadsheet, RefreshCw, TriangleAlert } from 'lucide-react';
import MarcaLikida from './marca';
import BloqueRespuesta from './bloques';
import { TrazaFinal, TrazaViva, textoMs } from './traza';
import { descargar, tablaACsv, textoParaCopiar, visualesDe } from './exportar';
import { useMovimientoReducido } from './movimiento';
import type { PasoTraza, Respuesta } from './respuestas';
import type { Turno } from './use-analista';

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
  if (!r.origen) return null;
  const partes = r.origen === 'analista'
    ? ['Respuesta del analista', r.hora, r.ms !== undefined ? textoMs(r.ms) : undefined]
    : ['Respuesta de reserva · con lo último que ya estaba cargado', r.hora];
  return <p className="rv-chat__sello" data-origen={r.origen}>{partes.filter(Boolean).join(' · ')}</p>;
}

export function RespuestaVista({ turno, ultimo, ocupado, fase, pasosVivos, onRepetir }: {
  turno: Turno;
  ultimo: boolean;
  ocupado: boolean;
  fase: string;
  pasosVivos: PasoTraza[];
  onRepetir: (id: string) => void;
}) {
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
      {terminado && visuales.map((v, j) => <BloqueRespuesta key={j} v={v} indice={j} />)}
      {terminado && r.pasos && <TrazaFinal pasos={r.pasos} ms={r.ms} />}
      {terminado && <Sello r={r} />}
      {terminado && r.texto.trim() && (
        <div className="rv-chat__acciones" role="group" aria-label="Acciones de la respuesta">
          <button type="button" className="rv-btn rv-btn--secondary" onClick={() => void copiar()}>
            {copiado ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            <span>{copiado ? 'Copiado' : 'Copiar'}</span>
          </button>
          {tablas.map((t, i) => (
            <button key={i} type="button" className="rv-btn rv-btn--secondary"
              aria-label={tablas.length > 1 ? `Descargar la tabla ${i + 1} como CSV` : 'Descargar la tabla como CSV'}
              onClick={() => setErrorArchivo(!descargar(`likida-respuesta-${i + 1}.csv`, tablaACsv(t.filas), 'text/csv;charset=utf-8'))}>
              <FileSpreadsheet aria-hidden="true" /><span>CSV</span>
            </button>
          ))}
          {ultimo && r.origen === 'analista' && (
            <button type="button" className="rv-btn rv-btn--secondary rv-chat__solo" disabled={ocupado} onClick={() => onRepetir(turno.id)}>
              <RefreshCw aria-hidden="true" /><span>Regenerar</span>
            </button>
          )}
          {errorArchivo && <span role="alert" className="rv-chat__error-linea">No se pudo crear el archivo en este navegador.</span>}
        </div>
      )}
      {r.fallo && ultimo && (
        <div>
          <button type="button" className="rv-btn rv-btn--secondary" disabled={ocupado} onClick={() => onRepetir(turno.id)}>
            <RefreshCw aria-hidden="true" /><span>Reintentar</span>
          </button>
        </div>
      )}
    </div>
  );
}
