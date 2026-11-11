'use client';

import { useT } from '@/lib/i18n/proveedor';
import { dinero } from '@/lib/i18n/es/dinero';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import './cotizaciones.css';
import { Boton as BotonUi, Tooltip, type AccionDeForma, type ResultadoAccion } from '@/app/ui-v2/componentes';

// ═══════════════════════════════════════════════════════════════════════════
// FE-13b (auditoría 24) — "Marcar enviada" / "Crear viaje" / "Perdida" /
// "Vencida" eran `<form action={fn}>` con `fn: Promise<void>`: sin
// `useActionState` no había `pending` (doble clic = doble envío, y "Crear
// viaje" es exactamente la acción que no debe dispararse dos veces) y el
// `catch` del servidor solo escribía al log — el humano veía la fila
// intacta tras el clic y no sabía si pasó algo.
// ═══════════════════════════════════════════════════════════════════════════

function BotonAccion({ texto, pendienteTexto, className, disabled, title }: {
  texto: string; pendienteTexto: string; className?: string; disabled?: boolean; title?: string;
}) {
  const { pending } = useFormStatus();
  const boton = (
    <BotonUi type="submit" variante="secondary" tamano="sm" disabled={pending || disabled} className={className}>
      {pending ? pendienteTexto : texto}
    </BotonUi>
  );
  return title ? <Tooltip texto={title}>{boton}</Tooltip> : boton;
}


export function FilaAccionesCotizacion({
  id, puedeEnviar, puedeCrearViaje = true, precio, enviada, convertir, perdida,
}: {
  id: string;
  puedeEnviar: boolean;
  /** A37-S17-10: «Crear viaje» solo para quien puede despachar (puedeAsignar). */
  puedeCrearViaje?: boolean;
  precio: number | null;
  enviada: AccionDeForma;
  convertir: AccionDeForma;
  perdida: AccionDeForma;
}) {
  const { t: tr } = useT('dinero', dinero);
  const [estadoEnviada, accEnviada] = useActionState<ResultadoAccion, FormData>(enviada, null);
  const [estadoConvertir, accConvertir] = useActionState<ResultadoAccion, FormData>(convertir, null);
  const [estadoPerdidaP, accPerdida] = useActionState<ResultadoAccion, FormData>(perdida, null);
  const [estadoPerdidaV, accVencida] = useActionState<ResultadoAccion, FormData>(perdida, null);

  const error = estadoEnviada?.error ?? estadoConvertir?.error ?? estadoPerdidaP?.error ?? estadoPerdidaV?.error ?? null;

  return (
    <div className="rv-cot__fila-acc">
      <span className="rv-cot__fila-botones">
        {puedeEnviar && (
          <form action={accEnviada}>
            <input type="hidden" name="id" value={id} />
            <BotonAccion texto={tr('cotizaciones.acciones.marcarEnviada')} pendienteTexto="Marcando…" />
          </form>
        )}
        {puedeCrearViaje && (
          <form action={accConvertir}>
            <input type="hidden" name="id" value={id} />
            <BotonAccion
              texto={tr('cotizaciones.acciones.crearViaje')} pendienteTexto="Creando…"
              disabled={precio === null}
              title={precio === null ? tr('cotizaciones.acciones.sinPrecioNoHay') : tr('cotizaciones.acciones.creaElViajeCon')}
            />
          </form>
        )}
        <form action={accPerdida}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="como" value="perdida" />
          <BotonAccion texto={tr('cotizaciones.acciones.perdida')} pendienteTexto="…" />
        </form>
        <form action={accVencida}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="como" value="vencida" />
          <BotonAccion texto={tr('cotizaciones.acciones.vencida')} pendienteTexto="…" />
        </form>
      </span>
      {error && <span className="rv-cot__error" role="alert">{error}</span>}
    </div>
  );
}
