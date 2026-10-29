'use client';

import { useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import { BotonEnlace, Chip } from '@/app/ui-v2/componentes';
import { ProgresoAnillo } from '@/app/ui-v2/graficas';
import { Particulas } from '@/app/ui-v2/svg/particulas';
import { anclaTour } from '@/app/ui-v2/movimiento/tour';
import { armarPasosCincoAgentes, etiquetaGlobal, ROTULO_ESTADO, type SenalesAsistente } from '@/lib/likida/asistente/pasos_cinco_agentes';
import { conPaso } from './con-paso';
import { useDeclaraciones } from './usar-declaraciones';

/**
 * El avance de la puesta en marcha dentro del Resumen. Usa la MISMA función pura que la pantalla del asistente y las
 * mismas declaraciones del navegador, así que las dos cifras nunca se contradicen.
 */
export function TarjetaPuestaEnMarcha({ senales, ambito, sufijo, soloLectura }: {
  senales: SenalesAsistente; ambito: string; sufijo: string; soloLectura: boolean;
}) {
  const { declaraciones } = useDeclaraciones(ambito, soloLectura);
  const r = useMemo(() => armarPasosCincoAgentes(senales, declaraciones), [senales, declaraciones]);
  const sig = r.siguiente ? r.rutaCritica.find((p) => p.id === r.siguiente) ?? null : null;

  return (
    <section className="rv-res-marcha" aria-labelledby="rv-res-marcha-t" {...anclaTour('resumen.puesta-en-marcha')}>
      <div className="rv-res-marcha__arte" aria-hidden="true"><Particulas /></div>
      <ProgresoAnillo valor={r.avance} tamano={64} grosor={6} etiqueta="Avance de la puesta en marcha" />
      <div className="rv-res-marcha__texto">
        <p className="rv-res-marcha__rotulo etiqueta-mono">Puesta en marcha</p>
        <h2 id="rv-res-marcha-t" className="rv-res-marcha__titulo font-display">
          {etiquetaGlobal(r) ?? `${r.listos} de ${r.total} pasos terminados`}
        </h2>
        {sig ? (
          <p className="rv-res-marcha__sig">
            Sigue: <strong>{sig.titulo}</strong>{' '}
            <Chip tono={sig.estado === 'atencion' || sig.estado === 'sin_dato' ? 'warn' : 'neutral'}>{ROTULO_ESTADO[sig.estado]}</Chip>
            {sig.faltaDe ? <span className="rv-res-marcha__falta"> · {sig.faltaDe}</span> : null}
          </p>
        ) : (
          <p className="rv-res-marcha__sig">No hay nada pendiente de tu lado.</p>
        )}
      </div>
      <BotonEnlace variante={etiquetaGlobal(r) ? 'secondary' : 'primary'} href={conPaso('/dashboard/puesta-en-marcha', sufijo, r.siguiente ?? undefined)} icono={<ArrowRight />}>
        {etiquetaGlobal(r) ? 'Revisar pasos' : 'Continuar'}
      </BotonEnlace>
    </section>
  );
}
