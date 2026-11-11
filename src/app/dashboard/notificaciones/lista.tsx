'use client';

import { Boton, EstadoVacio, MarcoPagina } from '@/app/ui-v2/componentes';
import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { TriangleAlert, Info, CheckCheck, ArrowRight } from 'lucide-react';
import type { AlertaFlota } from '../calcular-alertas-flota';
import { leerLeidas, marcarLeida, marcarTodasLeidas, suscribirCambios, SIN_LEIDAS } from '../notificaciones-leidas';
import { useT } from '@/lib/i18n/proveedor';
import { operacion as operacionEs } from '@/lib/i18n/es/operacion';

const ESTILO = {
  atencion: { fg: 'var(--warn)', bg: 'var(--warnbg)', Icono: TriangleAlert, rotulo: 'notif.rotulo.atencion' },
  aviso: { fg: 'var(--muted)', bg: 'var(--canvas)', Icono: Info, rotulo: 'notif.rotulo.aviso' },
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
  const { t, tp } = useT('operacion', operacionEs);
  const leidas = useSyncExternalStore(suscribirCambios, leerLeidas, () => SIN_LEIDAS);

  const vivas = alertas.filter((a) => !leidas.has(a.id));
  const descartadas = alertas.length - vivas.length;

  return (
    <MarcoPagina titulo={t('notif.titulo')} apoyo={t('notif.apoyo')} acciones={vivas.length > 0 ? (
        <Boton tamano="sm" onClick={() => marcarTodasLeidas(vivas.map((a) => a.id))} icono={<CheckCheck width={13} height={13} strokeWidth={1.75} />}>
          {t('notif.marcar.todas')}
        </Boton>
      ) : undefined}>
      {vivas.length === 0 ? (
        <EstadoVacio pantalla titulo={alertas.length === 0 ? t('notif.vacio.titulo') : t('notif.vacio.revisado')}>
          {alertas.length === 0
            ? t('notif.vacio.nada')
            : tp('notif.descartadas', descartadas)}
        </EstadoVacio>
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
                      style={{ color: e.fg, background: e.bg }}>{t(e.rotulo)}</span>
                    <p className="text-[13px] mt-1.5">{a.texto}</p>
                    <div className="flex items-center gap-3 mt-2.5 flex-wrap">
                      <Link href={a.href}
                        className="hairline h-7 px-2.5 rounded-lg inline-flex items-center gap-1.5 text-[12px] font-medium transition-colors hover:bg-[var(--canvas)]">
                        {t('notif.resolver')}
                        <ArrowRight width={13} height={13} strokeWidth={1.75} />
                      </Link>
                      <button type="button" onClick={() => marcarLeida(a.id)}
                        className="rv-btn rv-btn--ghost rv-btn--sm" style={{ color: 'var(--muted)' }}>
                        {t('notif.marcar.leido')}
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            );
          })}

          {descartadas > 0 && (
            <p className="text-[11px] pt-1" style={{ color: 'var(--faint)' }}>
              {tp('notif.descartadas', descartadas)} {t('notif.descartadas.cambio')}
            </p>
          )}
        </>
      )}

      <p className="text-[11px] pt-1" style={{ color: 'var(--faint)' }}>
        {t('notif.nota.leido')}
      </p>
    </MarcoPagina>
  );
}
