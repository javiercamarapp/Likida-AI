'use client';

import { useSyncExternalStore } from 'react';
import { Boton, BotonEnlace, StatusChip, Tarjeta } from '@/app/ui-v2/componentes';
import type { Alerta } from '../calcular-alertas';
import {
  alertasPendientes, claveAlerta, esSilenciable, leerLeidas, marcarLeida, marcarTodasLeidas, suscribirCambiosLeidas, SIN_LEIDAS,
} from '../notificaciones-leidas';
import '../resumen.css';

import { useT } from '@/lib/i18n/proveedor';
import { admin_inicio as admin_inicioEs } from '@/lib/i18n/es/admin_inicio';
/**
 * Lista real de /admin/notificaciones. "Marcar leído" es un descarte de pantalla guardado en localStorage (`notificaciones-leidas.ts`),
 * no una tabla: las alertas son un cálculo en vivo. NO silencia lo que tiene plazo legal (ARCO), un plazo vencido (SLA) o una fuente
 * ciega: esas siguen aquí y siguen contando hasta que se resuelvan (una alerta leída no es una alerta resuelta).
 */
export default function NotificacionesLista({ alertas }: { alertas: Alerta[] }) {
  const { t } = useT('admin_inicio', admin_inicioEs);
  const leidas = useSyncExternalStore(suscribirCambiosLeidas, leerLeidas, () => SIN_LEIDAS);
  const pendientes = alertasPendientes(alertas, leidas);
  const silenciables = pendientes.filter(esSilenciable);

  if (alertas.length === 0) {
    return <Tarjeta titulo={t('notificaciones_lista.pendientes')} estado="vacio" mensaje={t('notificaciones_lista.sin_novedades')} detalle={t('notificaciones_lista.no_hay_ninguna_condicion')} />;
  }
  if (pendientes.length === 0) {
    return <Tarjeta titulo={t('notificaciones_lista.pendientes')} estado="vacio" mensaje={t('notificaciones_lista.todo_marcado_como_leido')} detalle={t('notificaciones_lista.si_la_condicion_cambia')} />;
  }

  return (
    <Tarjeta
      titulo={t('notificaciones_lista.pendientes')}
      acciones={silenciables.length > 0
        ? <Boton tamano="sm" variante="secondary" onClick={() => marcarTodasLeidas(silenciables.map(claveAlerta))}>{t('notificaciones_lista.marcar_todas_como_leidas')}</Boton>
        : undefined}
    >
      <ul className="adm-res-lista">
        {pendientes.map((a) => (
          <li key={claveAlerta(a)} className="adm-res-fila">
            <StatusChip tono={a.tipo === 'atencion' ? 'bad' : 'ok'}>{a.tipo === 'atencion' ? t('notificaciones_lista.atencion') : t('notificaciones_lista.informativo')}</StatusChip>
            <div className="adm-res-fila__texto">
              <span className="adm-res-fila__titulo">{a.texto}</span>
              {!esSilenciable(a) ? <span className="adm-res-fila__detalle">{t('notificaciones_lista.con_plazo_o_sin')}</span> : null}
            </div>
            {/* La alerta lleva a DONDE SE RESUELVE. Sin href no se pinta nada: un «Ver» sin destino sería un botón que miente. */}
            {a.href ? <BotonEnlace tamano="sm" variante="secondary" href={a.href}>Ver</BotonEnlace> : null}
            {esSilenciable(a) ? <Boton tamano="sm" variante="ghost" onClick={() => marcarLeida(claveAlerta(a))}>{t('notificaciones_lista.marcar_leido')}</Boton> : null}
          </li>
        ))}
      </ul>
    </Tarjeta>
  );
}
