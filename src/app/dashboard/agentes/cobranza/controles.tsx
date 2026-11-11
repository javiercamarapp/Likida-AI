'use client';

import { useState, useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Play, Pause, Send } from 'lucide-react';
import type { ResultadoCobranza } from '@/lib/likida/agentes/cobranza';
import { AvisoCompacto, Boton, Icono } from '@/app/ui-v2/componentes';
import '../agentes.css';
import { useT } from '@/lib/i18n/proveedor';
import { agentes as agentesEs } from '@/lib/i18n/es/agentes';
import { rico } from '../i18n-agentes';

export type AccionSimple = (
  prev: { error?: string } | null,
  fd: FormData,
) => Promise<{ error?: string } | null>;

export type EstadoEjecutar = { error?: string; resultado?: ResultadoCobranza } | null;
export type AccionEjecutar = (prev: EstadoEjecutar, fd: FormData) => Promise<EstadoEjecutar>;

/**
 * "Ejecutar ahora" con confirmación en dos pasos: manda WhatsApp REAL a
 * todos los de la cola, y un botón que dispara mensajes de un clic es un
 * accidente esperando turno. La corrida ignora la ventana (el humano que
 * confirma ES la autorización), pero un agente pausado no corre ni a mano —
 * el motor lo dice y aquí se muestra tal cual.
 */
export function BotonEjecutar({ ejecutarAhora, enCola, activo }: {
  ejecutarAhora: AccionEjecutar;
  enCola: number;
  activo: boolean;
}) {
  const tr = useT('agentes', agentesEs);
  const { t } = tr;
  const [estado, accion] = useActionState(ejecutarAhora, null);
  const [confirmando, setConfirmando] = useState(false);
  const router = useRouter();

  // Tras una corrida, la cola y la bitácora del servidor ya cambiaron: se
  // refresca la página completa conservando el resumen local. El cierre del
  // paso de confirmación NO vive aquí (setState en un efecto encadena
  // renders): lo hace el onSubmit, que es evento del usuario.
  useEffect(() => {
    if (estado?.resultado) router.refresh();
  }, [estado, router]);

  const r = estado?.resultado;

  return (
    <div className="rv-ag-accion">
      {confirmando ? (
        <form action={accion} onSubmit={() => setConfirmando(false)} className="rv-ag-accion__confirmar">
          <span className="rv-ag-notif__nota">
            {tr.tp('cobranza.controles.mandar', enCola)}</span>
          <BotonConfirmar />
          <Boton variante="ghost" onClick={() => setConfirmando(false)}>{t('cobranza.controles.cancelar')}</Boton>
        </form>
      ) : (
        <Boton variante="primary" onClick={() => setConfirmando(true)}
          disabled={!activo || enCola === 0}
          title={!activo ? t('cobranza.controles.el_agente_esta_pausado') : enCola === 0 ? t('cobranza.controles.no_hay_a_quien_contactar') : t('cobranza.controles.correr_la_cobranza_ahora_sin')}
          icono={<Icono icono={Send} tam={14} />}>
          {t('cobranza.controles.ejecutar_ahora')}
        </Boton>
      )}

      {estado?.error && <AvisoCompacto tono="error" resumen={estado.error} />}
      {r && !confirmando && (
        <div className="rv-ag-accion__resultado">
          {r.omitido ? (
            <AvisoCompacto tono="warn" resumen={t('cobranza.controles.el_agente_no_corrio', { omitido: r.omitido })} />
          ) : (
            <p className="rv-ag-notif__nota">
              {rico(t('cobranza.controles.contacto_a_de'), { contactados: <strong>{r.contactados}</strong>, revisados: <span className="cifra-mono">{r.revisados}</span>, sinTelefono: r.sinTelefono > 0 && <> {t('cobranza.controles.sin_telefono', { n: r.sinTelefono })}</>, fallos: r.fallos.length > 0 && <> <span className="rv-ag-malo">{t('cobranza.controles.fallos', { n: r.fallos.length })}</span></> })}
            </p>
          )}
          {/* FE-14: el reloj de corte (25 s) puede dejar folios sin tocar en una cola grande: se dice, para que el humano sepa que hay
              que volver a apretar "Ejecutar ahora" en vez de asumir que ya se contactó a todos. */}
          {r.cortadosPorReloj > 0 && (
            <AvisoCompacto tono="warn" resumen={t('cobranza.controles.el_reloj_corto_la_corrida', { cortadosPorReloj: r.cortadosPorReloj })} />
          )}
          {r.fallos.map((f, i) => (
            <AvisoCompacto key={i} tono="error" resumen={f} />
          ))}
        </div>
      )}
    </div>
  );
}

function BotonConfirmar() {
  const { t } = useT('agentes', agentesEs);
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending} disabled={pending} icono={pending ? undefined : <Icono icono={Send} tam={14} />}>
      {pending ? t('cobranza.controles.mandando') : t('cobranza.controles.si_mandar')}
    </Boton>
  );
}

/** Pausar / reanudar — separado de "guardar estrategia" a propósito: editar
 *  las palabras del mensaje no debe despausar al agente en silencio. */
export function BotonPausa({ alternarPausa, activo }: { alternarPausa: AccionSimple; activo: boolean }) {
  const [estado, accion] = useActionState(alternarPausa, null);
  return (
    <div className="rv-ag-accion">
      <form action={accion}>
        {/* A37-S12-04: el estado DESEADO viaja en el form; el servidor no invierte. */}
        <input type="hidden" name="deseado" value={activo ? 'pausado' : 'activo'} />
        <BotonPausaInterno activo={activo} />
      </form>
      {estado?.error && <AvisoCompacto tono="error" resumen={estado.error} />}
    </div>
  );
}

function BotonPausaInterno({ activo }: { activo: boolean }) {
  const { t } = useT('agentes', agentesEs);
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="secondary" loading={pending} disabled={pending}
      title={activo ? t('cobranza.controles.el_agente_deja_de_contactar') : t('cobranza.controles.el_agente_vuelve_a_contactar')}
      icono={pending ? undefined : <Icono icono={activo ? Pause : Play} tam={14} />}>
      {activo ? (pending ? t('cobranza.controles.pausando') : t('cobranza.controles.pausar_agente')) : (pending ? t('cobranza.controles.reanudando') : t('cobranza.controles.reanudar_agente'))}
    </Boton>
  );
}
