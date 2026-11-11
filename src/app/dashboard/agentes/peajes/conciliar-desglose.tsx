'use client';

import { useState, useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { Boton, Icono } from '@/app/ui-v2/componentes';
import './peajes.css';

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
          <input type="hidden" name="desglose" value={desgloseId} />
          <span className="rv-pj-sub">
            ¿Re-cruzar el desglose completo contra los gastos de caseta de hoy?
          </span>
          <BotonConfirmar />
          <Boton onClick={() => setConfirmando(false)}>Cancelar</Boton>
        </form>
      ) : (
        <Boton variante="primary" onClick={() => setConfirmando(true)} icono={<Icono icono={RefreshCw} />}
          title="Volver a cruzar todas las líneas del desglose contra los gastos que hay hoy">
          Conciliar
        </Boton>
      )}

      {estado?.error && <p className="rv-pj-sub rv-pj-malo" role="alert">{estado.error}</p>}
      {r && !confirmando && (
        <p className="rv-pj-sub" role="status">
          Crucé <strong className="cifra-mono">{r.total}</strong> líneas:{' '}
          <strong className="cifra-mono">{r.cuadra}</strong> cuadran,{' '}
          <span className="cifra-mono">{r.noCuadra}</span> con discrepancia,{' '}
          <span className="cifra-mono">{r.sinContraparte}</span> sin contraparte
          {r.gpsConfirma !== undefined && (
            <> · GPS: <span className="cifra-mono">{r.gpsConfirma}</span> confirman, <span className="cifra-mono">{r.gpsNoCoincide ?? 0}</span> no coinciden, <span className="cifra-mono">{r.gpsSinDatos ?? 0}</span> sin datos</>
          )}
          {r.noEscritas > 0 && (
            <span className="rv-pj-malo"> · {r.noEscritas} no se pudieron escribir — vuelve a conciliar</span>
          )}.
        </p>
      )}
    </div>
  );
}

function BotonConfirmar() {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending} icono={<Icono icono={RefreshCw} />}>
      {pending ? 'Cruzando…' : 'Sí, cruzar'}
    </Boton>
  );
}
