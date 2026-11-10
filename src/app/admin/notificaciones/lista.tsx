'use client';

import { useSyncExternalStore } from 'react';
import { Boton, BotonEnlace, StatusChip, Tarjeta } from '@/app/ui-v2/componentes';
import type { Alerta } from '../calcular-alertas';
import {
  alertasPendientes, claveAlerta, esSilenciable, leerLeidas, marcarLeida, marcarTodasLeidas, suscribirCambiosLeidas, SIN_LEIDAS,
} from '../notificaciones-leidas';
import '../resumen.css';

/**
 * Lista real de /admin/notificaciones. "Marcar leído" es un descarte de pantalla guardado en localStorage (`notificaciones-leidas.ts`),
 * no una tabla: las alertas son un cálculo en vivo. NO silencia lo que tiene plazo legal (ARCO), un plazo vencido (SLA) o una fuente
 * ciega: esas siguen aquí y siguen contando hasta que se resuelvan (una alerta leída no es una alerta resuelta).
 */
export default function NotificacionesLista({ alertas }: { alertas: Alerta[] }) {
  const leidas = useSyncExternalStore(suscribirCambiosLeidas, leerLeidas, () => SIN_LEIDAS);
  const pendientes = alertasPendientes(alertas, leidas);
  const silenciables = pendientes.filter(esSilenciable);

  if (alertas.length === 0) {
    return <Tarjeta titulo="Pendientes" estado="vacio" mensaje="Sin novedades" detalle="No hay ninguna condición real que requiera tu atención ahorita." />;
  }
  if (pendientes.length === 0) {
    return <Tarjeta titulo="Pendientes" estado="vacio" mensaje="Todo marcado como leído" detalle="Si la condición cambia, la alerta vuelve a aparecer." />;
  }

  return (
    <Tarjeta
      titulo="Pendientes"
      acciones={silenciables.length > 0
        ? <Boton tamano="sm" variante="secondary" onClick={() => marcarTodasLeidas(silenciables.map(claveAlerta))}>Marcar todas como leídas</Boton>
        : undefined}
    >
      <ul className="adm-res-lista">
        {pendientes.map((a) => (
          <li key={claveAlerta(a)} className="adm-res-fila">
            <StatusChip tono={a.tipo === 'atencion' ? 'bad' : 'ok'}>{a.tipo === 'atencion' ? 'Atención' : 'Informativo'}</StatusChip>
            <div className="adm-res-fila__texto">
              <span className="adm-res-fila__titulo">{a.texto}</span>
              {!esSilenciable(a) ? <span className="adm-res-fila__detalle">Con plazo o sin lectura: no se puede ocultar hasta resolverla.</span> : null}
            </div>
            {/* La alerta lleva a DONDE SE RESUELVE. Sin href no se pinta nada: un «Ver» sin destino sería un botón que miente. */}
            {a.href ? <BotonEnlace tamano="sm" variante="secondary" href={a.href}>Ver</BotonEnlace> : null}
            {esSilenciable(a) ? <Boton tamano="sm" variante="ghost" onClick={() => marcarLeida(claveAlerta(a))}>Marcar leído</Boton> : null}
          </li>
        ))}
      </ul>
    </Tarjeta>
  );
}
