'use client';

import { useEffect } from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Upload } from 'lucide-react';
import { Boton, CampoArchivo, Icono } from '@/app/ui-v2/componentes';
import './peajes.css';
import { useT } from '@/lib/i18n/proveedor';
import { agentes as agentesEs } from '@/lib/i18n/es/agentes';

export type AccionSubir = (
  prev: { error?: string; resumen?: { totalLineas: number; conciliadas: number; porConciliar: number } } | null,
  fd: FormData,
) => Promise<{ error?: string; resumen?: { totalLineas: number; conciliadas: number; porConciliar: number } } | null>;

/**
 * El XML del consolidado, por pantalla. El cruce corre en el servidor
 * (guardarYConciliarConsolidado — el mismo del camino de WhatsApp) y el
 * resultado se dice con sus tres números; tras un cruce, la página completa
 * se refresca para que KPIs y bitácora cuenten lo nuevo.
 */
export function SubirDesglose({ subirDesglose }: { subirDesglose: AccionSubir }) {
  const { t: tx } = useT('agentes', agentesEs);
  const [estado, accion] = useActionState(subirDesglose, null);
  const router = useRouter();

  useEffect(() => {
    if (estado?.resumen) router.refresh();
  }, [estado, router]);

  return (
    <div className="rv-pj-control">
      <form action={accion} className="rv-pj-forma">
        <CampoArchivo etiqueta={tx('rest.xml_del_cfdi_consolidado')} name="archivo" accept=".xml,text/xml,application/xml" required />
        <BotonSubir />
      </form>
      {estado?.error && <p className="rv-pj-sub rv-pj-malo" role="alert">{estado.error}</p>}
      {estado?.resumen && (
        <p className="rv-pj-sub" role="status">{tx('rest.cruce_corrido')}{' '}<strong className="cifra-mono">{estado.resumen.conciliadas}</strong> de{' '}
          <span className="cifra-mono">{estado.resumen.totalLineas}</span>{' '}{tx('rest.lineas_conciliadas_solas')}{estado.resumen.porConciliar > 0 && <>{tx('rest.esperan_a_un_humano_en_la', { porConciliar: estado.resumen.porConciliar })}</>}.
        </p>
      )}
    </div>
  );
}

function BotonSubir() {
  const { t: tx } = useT('agentes', agentesEs);
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending} icono={<Icono icono={Upload} />}>
      {pending ? 'Cruzando…' : tx('rest.cruzar_contra_los_viajes')}
    </Boton>
  );
}
