'use client';

import { useState, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Link2, Trash2 } from 'lucide-react';
import { AvisoCompacto, Boton, Icono } from '@/app/ui-v2/componentes';
import { ComboViaje, type BuscarViaje } from './combo-viaje';
import './huerfanos.css';
import { useT } from '@/lib/i18n/proveedor';
import { operacion as operacionEs } from '@/lib/i18n/es/operacion';

export type AccionHuerfano = (
  prev: { error?: string } | null,
  fd: FormData,
) => Promise<{ error?: string } | null>;

export interface ViajeVivo { id: string; rotulo: string }

/**
 * Las dos salidas de un huérfano: adjuntar a un viaje VIVO o descartar (con
 * confirmación de dos pasos — descartar saca el comprobante de la vista de
 * todos, chofer incluido). Las acciones viven en el servidor y re-verifican
 * sesión, rol y tenant; aquí solo se pinta.
 *
 * `sinMonto`: un comprobante que el OCR no pudo leer (monto 0) NO ofrece
 * adjuntar — metería una línea de $0.00 en la liquidación. El mismo guardia
 * vive en el server action y en el flujo de WhatsApp; aquí solo se dice.
 */
export function FilaAcciones({ huerfanoId, hayViajesVivos, sinMonto, buscarViaje, adjuntar, descartar }: {
  huerfanoId: string;
  /** FE-3: ya no se manda la lista completa de viajes vivos (recortada a los
   *  100 más recientes) — solo si la flota TIENE alguno, para decidir si
   *  ofrecer el buscador o el mensaje "sin viajes abiertos". El buscador
   *  (`ComboViaje`) le pregunta al servidor por folio u operador. */
  hayViajesVivos: boolean;
  sinMonto: boolean;
  buscarViaje: BuscarViaje;
  adjuntar: AccionHuerfano;
  descartar: AccionHuerfano;
}) {
  const { t } = useT('operacion', operacionEs);
  const [estadoAdj, accionAdj] = useActionState(adjuntar, null);
  const [estadoDesc, accionDesc] = useActionState(descartar, null);
  const [confirmando, setConfirmando] = useState(false);

  return (
    <div className="rv-hf__acciones">
      {confirmando ? (
        <form action={accionDesc} onSubmit={() => setConfirmando(false)} className="rv-hf__fila">
          <input type="hidden" name="huerfanoId" value={huerfanoId} />
          <span className="rv-hf__pregunta">{t('hf.descartar.pregunta')}</span>
          <BotonConfirmarDescarte />
          <Boton tamano="sm" variante="ghost" onClick={() => setConfirmando(false)}>{t('hf.no')}</Boton>
        </form>
      ) : (
        <form action={accionAdj} className="rv-hf__fila">
          <input type="hidden" name="huerfanoId" value={huerfanoId} />
          {sinMonto ? (
            <span className="rv-hf__sin">
              {t('hf.sinmonto')}
            </span>
          ) : hayViajesVivos ? (
            <>
              <ComboViaje name="viajeId" buscar={buscarViaje} requerido aria-label={t('hf.viaje.aria')} className="rv-ctl" />
              <BotonAdjuntar />
            </>
          ) : (
            <span className="rv-hf__sin">{t('hf.sinviajes')}</span>
          )}
          {/* FE-21: es un botón SOLO de ícono. Sin `aria-label`, un lector de pantalla lo anuncia como "botón" a secas — y el que
              borra un comprobante es el peor botón para no tener nombre. */}
          <Boton tamano="sm" variante="ghost" onClick={() => setConfirmando(true)} title={t('hf.descartar.titulo')}
            aria-label={t('hf.descartar.titulo')} icono={<Icono icono={Trash2} tam={16} />}>{''}</Boton>
        </form>
      )}
      {/* FE-3: ya no hay ventana que confesar — el buscador pregunta a la flota entera de viajes vivos, no a un recorte cargado de una vez. */}
      {!confirmando && !sinMonto && hayViajesVivos && (
        <p className="rv-hf__ayuda">{t('hf.ayuda')}</p>
      )}
      {estadoAdj?.error && <AvisoCompacto tono="error" resumen={estadoAdj.error} />}
      {estadoDesc?.error && <AvisoCompacto tono="error" resumen={estadoDesc.error} />}
    </div>
  );
}

function BotonAdjuntar() {
  const { t } = useT('operacion', operacionEs);
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" tamano="sm" disabled={pending} icono={<Icono icono={Link2} tam={16} />}>
      {pending ? t('hf.adjuntando') : t('hf.adjuntar')}
    </Boton>
  );
}

function BotonConfirmarDescarte() {
  const { t } = useT('operacion', operacionEs);
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="danger" tamano="sm" disabled={pending} icono={<Icono icono={Trash2} tam={16} />}>
      {pending ? t('hf.descartando') : t('hf.descartar.si')}
    </Boton>
  );
}
