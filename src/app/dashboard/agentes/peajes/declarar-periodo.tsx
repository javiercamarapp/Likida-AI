'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AvisoResultado, Boton, CampoFecha, type ResultadoUI } from '@/app/ui-v2/componentes';
import './peajes.css';

export type EstadoPeriodo = { ok?: string; error?: string } | null;
export type AccionPeriodo = (prev: EstadoPeriodo, fd: FormData) => Promise<EstadoPeriodo>;

/**
 * «Declarar periodo» de un desglose ya importado (A37-A2-12). Los canales automáticos solo conocen el periodo si el NOMBRE del
 * archivo lo dice; sin él, los cobros extemporáneos, el doble entre archivos y el cierre mensual no se aplican. Aquí se declara
 * (o se corrige) sin volver a subir el archivo.
 */
export function DeclararPeriodo({ declarar, desgloseId, desde, hasta }: { declarar: AccionPeriodo; desgloseId: string; desde: string | null; hasta: string | null }) {
  const [estado, accion, pendiente] = useActionState(declarar, null);
  const router = useRouter();
  useEffect(() => {
    if (estado?.ok) router.refresh();
  }, [estado, router]);

  return (
    <form action={accion} className="rv-pj-forma rv-pj-forma--linea">
      <input type="hidden" name="desglose" value={desgloseId} />
      <span className="rv-pj-sub">Periodo oficial del archivo{desde && hasta ? `: ${desde} a ${hasta}` : ': sin declarar'}</span>
      <CampoFecha etiqueta="Inicio del periodo oficial" etiquetaOculta name="periodo_desde" required defaultValue={desde ?? ''} />
      <span className="rv-pj-sub">a</span>
      <CampoFecha etiqueta="Fin del periodo oficial" etiquetaOculta name="periodo_hasta" required defaultValue={hasta ?? ''} />
      <Boton type="submit" tamano="sm" loading={pendiente}>{pendiente ? 'Guardando…' : 'Declarar periodo'}</Boton>
      <AvisoResultado estado={estado as ResultadoUI} compacto />
    </form>
  );
}
