'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Boton, BotonEnlace, StatusChip, Tarjeta } from '@/app/ui-v2/componentes';
import {
  armarPasosCincoAgentes, ROTULO_ESTADO, type PasoAsistente, type ResultadoAsistente, type SenalesAsistente,
} from '@/lib/likida/asistente/pasos_cinco_agentes';
import { conPaso } from './puesta-en-marcha/con-paso';
import { useDeclaraciones } from './puesta-en-marcha/usar-declaraciones';

// Piezas de cliente del Inicio de `cinco_agentes`: la tarjeta propia de Puesta en marcha y los «primeros pasos» de una flota nueva.
// Las dos leen las declaraciones del navegador para coincidir con la pantalla del asistente. Solo importan el modelo puro.

const RUTA = '/dashboard/puesta-en-marcha';

function useMarcha(senales: SenalesAsistente, ambito: string, soloLectura: boolean): ResultadoAsistente {
  const { declaraciones } = useDeclaraciones(ambito, soloLectura);
  return useMemo(() => armarPasosCincoAgentes(senales, declaraciones), [senales, declaraciones]);
}

const pendientes = (r: ResultadoAsistente): PasoAsistente[] => r.rutaCritica.filter((p) => p.estado !== 'listo');

/** La barra de seis segmentos: uno por paso de la ruta crítica. Estado en texto para lector de pantalla (nunca solo color). */
function BarraSegmentos({ r }: { r: ResultadoAsistente }) {
  return (
    <ol className="rv-ic__segs" aria-label={`Puesta en marcha: ${r.listos} de ${r.total} pasos listos`}>
      {r.rutaCritica.map((p) => (
        <li key={p.id} className="rv-ic__seg" data-listo={p.estado === 'listo' || undefined} data-omitido={p.estado === 'omitido' || undefined}>
          <span className="rv-sr">{p.titulo}: {ROTULO_ESTADO[p.estado]}</span>
        </li>
      ))}
    </ol>
  );
}

export function TarjetaPuestaEnMarcha({ senales, ambito, soloLectura, sufijo }: {
  senales: SenalesAsistente; ambito: string; soloLectura: boolean; sufijo: string;
}) {
  const r = useMarcha(senales, ambito, soloLectura);
  const [abierta, setAbierta] = useState(false);
  const completa = r.listoParaOperar;
  const faltan = pendientes(r);
  const siguiente = r.siguiente ? r.rutaCritica.find((p) => p.id === r.siguiente) ?? null : null;

  if (completa) {
    return (
      <Tarjeta
        titulo="Puesta en marcha" info="inicio.puesta_en_marcha" className="rv-ic__marcha"
        acciones={<Boton tamano="sm" variante="ghost" onClick={() => setAbierta((v) => !v)} aria-expanded={abierta}>{abierta ? 'Ocultar pasos' : 'Ver pasos'}</Boton>}
      >
        <p className="rv-ic__linea"><StatusChip tono="ok">Lista</StatusChip> {r.listos} de {r.total} pasos</p>
        <BarraSegmentos r={r} />
        {abierta ? (
          <ul className="rv-ic__pasos">
            {r.rutaCritica.map((p) => <li key={p.id}>{p.titulo}</li>)}
          </ul>
        ) : null}
      </Tarjeta>
    );
  }
  return (
    <Tarjeta titulo="Puesta en marcha" info="inicio.puesta_en_marcha" className="rv-ic__marcha">
      <p className="rv-ic__cifra-fila"><span className="rv-ic__cifra">{r.listos} / {r.total}</span><span className="rv-ic__nota">pasos listos</span></p>
      <BarraSegmentos r={r} />
      {siguiente ? (
        <p className="rv-ic__sigue"><b>Sigue: {siguiente.titulo}.</b> {siguiente.faltaDe ?? ROTULO_ESTADO[siguiente.estado]}</p>
      ) : (
        <p className="rv-ic__sigue">Lo que falta depende de otros: {faltan.map((p) => `${p.titulo} (${p.faltaDe ?? ROTULO_ESTADO[p.estado]})`).join('; ')}.</p>
      )}
      <ul className="rv-ic__pasos" aria-label="Lo que falta y quién lo resuelve">
        {faltan.slice(0, 4).map((p) => (
          <li key={p.id}><span className="rv-ic__paso-titulo">{p.titulo}</span> <span className="rv-ic__nota">{p.faltaDe ?? ROTULO_ESTADO[p.estado]}</span></li>
        ))}
      </ul>
      <BotonEnlace tamano="sm" variante="primary" href={conPaso(RUTA, sufijo, siguiente?.id)} icono={<ArrowRight strokeWidth={1.75} />}>Continuar</BotonEnlace>
    </Tarjeta>
  );
}

/** Flota nueva: en lugar de «Nada urgente», los primeros pasos con su responsable. */
export function PrimerosPasos({ senales, ambito, soloLectura, sufijo }: {
  senales: SenalesAsistente; ambito: string; soloLectura: boolean; sufijo: string;
}) {
  const r = useMarcha(senales, ambito, soloLectura);
  const filas = pendientes(r).slice(0, 3);
  if (filas.length === 0) return <p className="rv-ic__nota">Los pasos iniciales ya están listos.</p>;
  return (
    <>
      <p className="rv-ic__nota">Tu flota todavía no tiene actividad. Estos son los primeros pasos:</p>
      <ul className="rv-ic__pasos" aria-label="Primeros pasos">
        {filas.map((p) => (
          <li key={p.id}>
            <Link className="rv-ic__paso" href={conPaso(RUTA, sufijo, p.id)}>
              <span className="rv-ic__paso-titulo">{p.titulo}</span>
              <span className="rv-ic__nota">{p.faltaDe ?? ROTULO_ESTADO[p.estado]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
