'use client';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { Bell, TriangleAlert, Info, CheckCheck, ArrowRight } from 'lucide-react';
import type { AlertaFlota } from '../calcular-alertas-flota';
import { BarraPagina } from '../resumen-visual';
import { leerLeidas, marcarLeida, marcarTodasLeidas, suscribirCambios, SIN_LEIDAS } from '../notificaciones-leidas';

const ESTILO = {
  atencion: { fg: 'var(--warn)', bg: 'var(--warnbg)', Icono: TriangleAlert, rotulo: 'Requiere atención' },
  aviso: { fg: 'var(--muted)', bg: 'var(--canvas)', Icono: Info, rotulo: 'Aviso' },
} as const;

/**
 * La lista de alertas de la flota.
 *
 * Es cliente por el estado de "leídas" (localStorage), no por los datos: las
 * alertas llegan ya calculadas del servidor. Lo leído se OCULTA de la lista
 * principal y se cuenta abajo — esconderlo sin decir cuántas hay haría que la
 * pantalla se leyera como "no pasa nada" cuando lo que pasa es que ya las
 * descartaste.
 */
export function ListaAlertas({ alertas }: { alertas: AlertaFlota[] }) {
  const leidas = useSyncExternalStore(suscribirCambios, leerLeidas, () => SIN_LEIDAS);

  const vivas = alertas.filter((a) => !leidas.has(a.id));
  const descartadas = alertas.length - vivas.length;

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Bell width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Notificaciones"
          derecha={vivas.length > 0 ? (
            <button
              type="button"
              onClick={() => marcarTodasLeidas(vivas.map((a) => a.id))}
              className="hairline h-7 px-2.5 rounded-lg inline-flex items-center gap-1.5 text-[12px] font-medium transition-colors hover:bg-[var(--canvas)]"
            >
              <CheckCheck width={13} height={13} strokeWidth={1.75} />
              Marcar todas
            </button>
          ) : undefined}
        />

        <div className="px-5 py-5 flex-1 space-y-3">
          <p className="text-[12px]" style={{ color: 'var(--faint)' }}>
            Lo que hoy necesita a una persona. Cada renglón lleva a la pantalla donde se resuelve;
            todos salen de una consulta real, ninguno de un contador de adorno.
          </p>

          {vivas.length === 0 ? (
            <section className="card p-8 text-center">
              <p className="text-[13px] font-medium">
                {alertas.length === 0 ? 'Sin novedades.' : 'Ya revisaste todo.'}
              </p>
              <p className="text-[12px] mt-1" style={{ color: 'var(--muted)' }}>
                {alertas.length === 0
                  ? 'Nada de la flota pide a una persona en este momento.'
                  : `${descartadas} ${descartadas === 1 ? 'aviso descartado' : 'avisos descartados'} en este navegador.`}
              </p>
            </section>
          ) : (
            <>
              {vivas.map((a) => {
                const e = ESTILO[a.tipo];
                return (
                  <section key={a.id} className="card p-4">
                    <div className="flex items-start gap-3">
                      <e.Icono width={16} height={16} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: e.fg }} />
                      <div className="min-w-0 flex-1">
                        <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium"
                          style={{ color: e.fg, background: e.bg }}>{e.rotulo}</span>
                        <p className="text-[13px] mt-1.5">{a.texto}</p>
                        <div className="flex items-center gap-3 mt-2.5 flex-wrap">
                          <Link href={a.href}
                            className="hairline h-7 px-2.5 rounded-lg inline-flex items-center gap-1.5 text-[12px] font-medium transition-colors hover:bg-[var(--canvas)]">
                            Resolver
                            <ArrowRight width={13} height={13} strokeWidth={1.75} />
                          </Link>
                          <button type="button" onClick={() => marcarLeida(a.id)}
                            className="text-[12px] transition-colors hover:underline" style={{ color: 'var(--muted)' }}>
                            Marcar leído
                          </button>
                        </div>
                      </div>
                    </div>
                  </section>
                );
              })}

              {descartadas > 0 && (
                <p className="text-[11px] pt-1" style={{ color: 'var(--faint)' }}>
                  {descartadas} {descartadas === 1 ? 'aviso descartado' : 'avisos descartados'} en este navegador.
                  Si el número de un aviso cambia, vuelve a aparecer.
                </p>
              )}
            </>
          )}

          <p className="text-[11px] pt-1" style={{ color: 'var(--faint)' }}>
            &quot;Marcar leído&quot; se guarda en este navegador, no en tu cuenta: son un cálculo en vivo
            sobre tus datos, no mensajes archivables.
          </p>
        </div>
      </div>
    </main>
  );
}
