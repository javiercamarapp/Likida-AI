'use client';

import { useMemo, useState } from 'react';
import { BookOpen, Search, ShieldCheck, ShieldAlert, ExternalLink, Code2 } from 'lucide-react';
import {
  buscarNormas, PUEDE_AFIRMARSE, JERARQUIA_ROTULO, type Norma,
} from '@/lib/likida/normas/tipos';
import { BarraPagina } from '../resumen-visual';

/**
 * CONOCIMIENTO NORMATIVO — de dónde saca Likida el fundamento, y de dónde
 * saca la duda.
 *
 * La carpeta `normas/` existía desde antes, pero solo la veía quien abriera el
 * repo. El contador de una flota no tenía cómo saber con qué texto legal se
 * calculó el estímulo de su liquidación — y eso, en un producto que emite una
 * opinión con consecuencias económicas, es justo lo que debería poder auditar.
 *
 * La pantalla enseña el ESTADO DE VERIFICACIÓN al mismo nivel que el título, y
 * no escondido en un pie: una ficha `sin_verificar` es una sobre la que Likida
 * NO afirma nada, y quien la lea tiene que enterarse antes de decidir con ella.
 */
export function VistaConocimiento({ normas }: { normas: readonly Norma[] }) {
  const [q, setQ] = useState('');

  const lista = useMemo(() => {
    const t = q.trim();
    if (t === '') {
      // Sin búsqueda: por jerarquía (la ley primero) y luego por instrumento.
      return [...normas].sort((a, b) =>
        (a.jerarquia - b.jerarquia) || a.instrumento.localeCompare(b.instrumento, 'es'));
    }
    return buscarNormas(normas, t);
  }, [normas, q]);

  const buscando = q.trim() !== '';

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<BookOpen width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Conocimiento normativo"
        />

        <div className="px-5 py-5 flex-1 space-y-3">
          <p className="text-[12px]" style={{ color: 'var(--faint)' }}>
            Las {normas.length} fichas de las que depende una cifra de tu liquidación. Cada una declara
            si se leyó en la fuente original o no — porque de eso depende si Likida puede afirmarlo o
            solo señalártelo.
          </p>

          <div className="relative">
            <Search width={14} height={14} strokeWidth={1.75}
              className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--faint)' }} />
            <label htmlFor="norma-q" className="sr-only">Buscar una norma</label>
            <input id="norma-q" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="peaje, 20-A, diésel, carta porte, datos personales…"
              className="w-full text-[13px] pl-9 pr-3 py-2 rounded-lg hairline"
              style={{ background: 'var(--surface)' }} />
          </div>

          {buscando && lista.length === 0 ? (
            <section className="card p-8 text-center">
              <p className="text-[13px] font-medium">Ninguna ficha habla de eso.</p>
              <p className="text-[12px] mt-1" style={{ color: 'var(--muted)' }}>
                No te enseño la más parecida a propósito: en materia fiscal, una respuesta aproximada
                es peor que ninguna. Si es algo que Likida debería saber, dínoslo desde el Centro de ayuda.
              </p>
            </section>
          ) : (
            lista.map((n) => {
              const v = PUEDE_AFIRMARSE[n.estado_verificacion];
              const Icono = v?.puede ? ShieldCheck : ShieldAlert;
              const color = v?.puede ? 'var(--ok)' : 'var(--warn)';
              const fondo = v?.puede ? 'var(--okbg)' : 'var(--warnbg)';
              return (
                <section key={n.id} className="card p-4">
                  <div className="flex items-start gap-3">
                    <Icono width={16} height={16} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium"
                          style={{ color: 'var(--muted)', background: 'var(--canvas)' }}>
                          {JERARQUIA_ROTULO[n.jerarquia] ?? `Nivel ${n.jerarquia}`}
                        </span>
                        <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium"
                          style={{ color, background: fondo }}>
                          {v?.rotulo ?? n.estado_verificacion}
                        </span>
                      </div>

                      <h2 className="font-display text-[14px] font-semibold mt-1.5">
                        {n.titulo ?? n.instrumento}
                      </h2>
                      <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--muted)' }}>
                        {n.instrumento}
                        {n.articulo_o_regla ? ` · Art./regla ${n.articulo_o_regla}` : ''}
                      </p>

                      {v && (
                        <p className="text-[11.5px] mt-1.5" style={{ color: v.puede ? 'var(--faint)' : 'var(--warn)' }}>
                          {v.nota}
                        </p>
                      )}

                      <div className="flex items-center gap-3 mt-2.5 flex-wrap">
                        {n.fuente_url && (
                          <a href={n.fuente_url} target="_blank" rel="noopener noreferrer"
                            className="hairline h-7 px-2.5 rounded-lg inline-flex items-center gap-1.5 text-[12px] font-medium transition-colors hover:bg-[var(--canvas)]">
                            Leer la fuente
                            <ExternalLink width={12} height={12} strokeWidth={1.75} />
                          </a>
                        )}
                        {n.verificado_el && (
                          <span className="text-[11px]" style={{ color: 'var(--faint)' }}>
                            Revisada el {n.verificado_el}
                          </span>
                        )}
                      </div>

                      {n.citasEnCodigo.length > 0 && (
                        <div className="flex items-start gap-1.5 mt-2 text-[11px]" style={{ color: 'var(--faint)' }}>
                          <Code2 width={12} height={12} strokeWidth={1.75} className="mt-0.5 shrink-0" />
                          <span>Se aplica como: {n.citasEnCodigo.join(' · ')}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              );
            })
          )}

          <p className="text-[11px] pt-1" style={{ color: 'var(--faint)' }}>
            Esto es de dónde sale el cálculo, no asesoría fiscal. Likida prepara y te señala;
            la decisión —y su firma— es de tu contador.
          </p>
        </div>
      </div>
    </main>
  );
}
