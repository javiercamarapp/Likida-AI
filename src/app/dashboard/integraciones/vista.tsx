import { Blocks, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import {
  porCategoria, ESTADO_INTEGRACION, type Integracion,
} from '@/lib/likida/integraciones';
import { BarraPagina } from '../resumen-visual';

const TONO: Record<string, { fg: string; bg: string }> = {
  ok: { fg: 'var(--ok)', bg: 'var(--okbg)' },
  neutral: { fg: 'var(--muted)', bg: 'var(--canvas)' },
  warn: { fg: 'var(--warn)', bg: 'var(--warnbg)' },
  apagado: { fg: 'var(--faint)', bg: 'var(--canvas)' },
};

/**
 * INTEGRACIONES — con qué sistemas de la flota se conecta Likida, y CÓMO se
 * conecta hoy con cada uno.
 *
 * Es la mitad del chasis que faltaba. La arquitectura separa «credenciales»
 * (los accesos que usan los agentes de Likida) de «integraciones» (los sistemas de
 * negocio del cliente), y la separación es correcta: `/dashboard/conexiones` ya
 * cubre lo primero con estado medido.
 *
 * Lo que hace útil a esta página es la línea «Cómo conecta hoy». La diferencia
 * entre "subes el archivo del TAG cada 10 días" y "nos conectamos solos a tu
 * TAG" es toda la diferencia para quien va a comprar — y prometer la segunda
 * cuando lo que hay es la primera es la forma más rápida de perder al cliente
 * en la segunda semana. Por eso `por_archivo` se pinta NEUTRO y no ámbar: es
 * un estado terminado, no uno a medias.
 */
export function VistaIntegraciones({ integraciones, sufijo }: {
  integraciones: Integracion[];
  sufijo: string;
}) {
  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Blocks width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Integraciones"
        />

        <div className="px-5 py-5 flex-1 space-y-5">
          <p className="text-[12px]" style={{ color: 'var(--faint)' }}>
            Likida es una capa sobre lo que ya usas — no reemplaza tu ERP ni tu TMS. Cada renglón dice
            cómo entra el dato <strong>hoy</strong>, no lo que podría llegar a hacer.
          </p>

          {porCategoria(integraciones).map(([categoria, items]) => (
            <section key={categoria} className="space-y-2.5">
              <h2 className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                {categoria}
              </h2>

              {items.map((i) => {
                const e = ESTADO_INTEGRACION[i.estado];
                const t = TONO[e.tono];
                return (
                  <article key={i.id} className="card p-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <h3 className="font-display text-[14px] font-semibold">{i.nombre}</h3>
                      <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0"
                        style={{ color: t.fg, background: t.bg }}>
                        {e.rotulo}
                      </span>
                    </div>

                    <p className="text-[12.5px] mt-1" style={{ color: 'var(--muted)' }}>{i.queHace}</p>

                    <dl className="mt-2.5 space-y-1.5">
                      <div>
                        <dt className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>
                          Cómo conecta hoy
                        </dt>
                        <dd className="text-[12.5px] mt-0.5">{i.comoConectaHoy}</dd>
                      </div>
                      {i.paraSubirDeEscalon && (
                        <div>
                          <dt className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>
                            Para dar el siguiente paso
                          </dt>
                          <dd className="text-[12.5px] mt-0.5" style={{ color: 'var(--muted)' }}>
                            {i.paraSubirDeEscalon}
                          </dd>
                        </div>
                      )}
                    </dl>
                  </article>
                );
              })}
            </section>
          ))}

          <div className="card p-4 flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h3 className="text-[13px] font-medium">¿Falta el sistema que tú usas?</h3>
              <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--muted)' }}>
                Es exactamente lo que se conecta contigo en el arranque. Los accesos que Likida ya tiene
                guardados de tu flota viven en Conexiones.
              </p>
            </div>
            <Link href={`/dashboard/conexiones${sufijo}`}
              className="hairline h-8 px-3 rounded-lg inline-flex items-center gap-1.5 text-[12px] font-medium transition-colors hover:bg-[var(--canvas)] shrink-0">
              Ver Conexiones
              <ArrowRight width={13} height={13} strokeWidth={1.75} />
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
