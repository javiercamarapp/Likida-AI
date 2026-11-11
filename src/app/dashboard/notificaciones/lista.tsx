'use client';

import { Boton, BotonEnlace, EstadoVacio, MarcoPagina, StatusChip, Tarjeta } from '@/app/ui-v2/componentes';
import { useSyncExternalStore } from 'react';
import { CheckCheck, ArrowRight } from 'lucide-react';
import type { AlertaFlota } from '../calcular-alertas-flota';
import { leerLeidas, marcarLeida, marcarTodasLeidas, suscribirCambios, SIN_LEIDAS } from '../notificaciones-leidas';
import { useT } from '@/lib/i18n/proveedor';
import { operacion as operacionEs } from '@/lib/i18n/es/operacion';

/** El tono del chip por tipo de alerta: atención = ámbar con texto; aviso = neutro. Nunca solo color (el chip dice el rótulo). */
const ESTILO = {
  atencion: { tono: 'warn', rotulo: 'notif.rotulo.atencion' },
  aviso: { tono: 'muted', rotulo: 'notif.rotulo.aviso' },
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
              <Tarjeta key={a.id} titulo={t(e.rotulo)} acciones={<StatusChip tono={e.tono}>{t(e.rotulo)}</StatusChip>} elevar entra="tarjeta">
                <p className="rv-notif__texto">{a.texto}</p>
                <div className="rv-notif__acciones">
                  <BotonEnlace tamano="sm" variante="secondary" href={a.href} icono={<ArrowRight width={13} height={13} strokeWidth={1.75} />}>{t('notif.resolver')}</BotonEnlace>
                  <Boton tamano="sm" variante="ghost" onClick={() => marcarLeida(a.id)}>{t('notif.marcar.leido')}</Boton>
                </div>
              </Tarjeta>
            );
          })}

          {descartadas > 0 && (
            <p className="rv-res__nota">
              {tp('notif.descartadas', descartadas)} {t('notif.descartadas.cambio')}
            </p>
          )}
        </>
      )}

      <p className="rv-res__nota">
        {t('notif.nota.leido')}
      </p>
    </MarcoPagina>
  );
}
