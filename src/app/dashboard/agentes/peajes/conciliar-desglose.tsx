'use client';

import { useState, useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { Boton, Icono, Tooltip } from '@/app/ui-v2/componentes';
import './peajes.css';
import { useT } from '@/lib/i18n/proveedor';
import { agentes as agentesEs } from '@/lib/i18n/es/agentes';
import { rico as ricoT } from '@/lib/i18n/rico';

export type ResumenCruce = {
  total: number;
  cuadra: number;
  noCuadra: number;
  sinContraparte: number;
  noEscritas: number;
  /** El cruce por caseta con el GPS (0375). Ausentes en corridas anteriores. */
  gpsConfirma?: number;
  gpsNoCoincide?: number;
  gpsSinDatos?: number;
};
export type EstadoConciliar = { error?: string; resumen?: ResumenCruce } | null;
export type AccionConciliar = (prev: EstadoConciliar, fd: FormData) => Promise<EstadoConciliar>;

/**
 * «Conciliar» con confirmación en dos pasos — el mismo patrón que el barrido
 * (`controles.tsx`) y por la misma razón: re-corre el cruce COMPLETO del
 * desglose contra los gastos de caseta de hoy y reescribe las tres cubetas,
 * y un botón que reescribe de un clic es un accidente esperando turno. El
 * acuse dice lo que quedó EN LA BASE, incluidas las líneas que no se
 * pudieron escribir.
 */
export function BotonConciliar({ conciliar, desgloseId }: {
  conciliar: AccionConciliar;
  desgloseId: string;
}) {
  const { t: tx } = useT('agentes', agentesEs);
  const [estado, accion] = useActionState(conciliar, null);
  const [confirmando, setConfirmando] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (estado?.resumen) router.refresh();
  }, [estado, router]);

  const r = estado?.resumen;

  return (
    <div className="rv-pj-control">
      {confirmando ? (
        <form action={accion} onSubmit={() => setConfirmando(false)} className="rv-pj-confirmar">
          <input type="hidden" name="desglose" value={desgloseId} />{ricoT(tx('rest.e0_re_cruzar_el_desglose_completo'), { e0: (c) => <span className="rv-pj-sub">{c}</span> })}<BotonConfirmar />
          <Boton onClick={() => setConfirmando(false)}>{tx('cobranza.controles.cancelar')}</Boton>
        </form>
      ) : (
        <Tooltip texto={tx('rest.volver_a_cruzar_todas_las_lineas')}><Boton variante="primary" onClick={() => setConfirmando(true)} icono={<Icono icono={RefreshCw} />}>{tx('rest.conciliar')}</Boton></Tooltip>
      )}

      {estado?.error && <p className="rv-pj-sub rv-pj-malo" role="alert">{estado.error}</p>}
      {r && !confirmando && (
        <p className="rv-pj-sub" role="status">{tx('rest.cruce')}{' '}<strong className="cifra-mono">{r.total}</strong>{' '}{tx('rest.lineas')}{' '}<strong className="cifra-mono">{r.cuadra}</strong> cuadran,{' '}
          <span className="cifra-mono">{r.noCuadra}</span>{' '}{tx('rest.con_discrepancia')}{' '}<span className="cifra-mono">{r.sinContraparte}</span>{' '}{tx('rest.sin_contraparte')}{r.gpsConfirma !== undefined && (
            <>{tx('rest.gps')}{' '}<span className="cifra-mono">{r.gpsConfirma}</span> confirman, <span className="cifra-mono">{r.gpsNoCoincide ?? 0}</span>{' '}{tx('rest.no_coinciden')}{' '}<span className="cifra-mono">{r.gpsSinDatos ?? 0}</span>{' '}{tx('rest.sin_datos')}</>
          )}
          {r.noEscritas > 0 && (
            <span className="rv-pj-malo">{tx('rest.no_se_pudieron_escribir_vuelve_a', { noEscritas: r.noEscritas })}</span>
          )}.
        </p>
      )}
    </div>
  );
}

function BotonConfirmar() {
  const { t: tx } = useT('agentes', agentesEs);
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending} icono={<Icono icono={RefreshCw} />}>
      {pending ? 'Cruzando…' : tx('rest.si_cruzar')}
    </Boton>
  );
}
