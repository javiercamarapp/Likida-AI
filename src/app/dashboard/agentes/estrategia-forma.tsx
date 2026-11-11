'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Save } from 'lucide-react';
import { Boton as BotonV2, CampoTexto, Disclosure, Icono } from '@/app/ui-v2/componentes';
import { AvisoResultado } from '../../admin/ui/aviso-resultado';

// La estrategia editable de un agente (B4, auditoría 4) — SOLO donde hay una
// perilla que un motor de verdad lee. El valor actual llega como prop desde el
// server component (que lo leyó de getConfig); el default del producto se dice
// en la ayuda para que "regresar a como estaba" no requiera adivinar.

export type ResultadoEstrategia = { ok: true; mensaje: string } | { ok: false; error: string } | null;
export type AccionEstrategia = (previo: ResultadoEstrategia, fd: FormData) => Promise<ResultadoEstrategia>;

function Boton() {
  const { pending } = useFormStatus();
  return (
    <BotonV2 type="submit" variante="primary" loading={pending} disabled={pending} icono={<Icono icono={Save} tam={14} />}>
      {pending ? 'Guardando…' : 'Guardar estrategia'}
    </BotonV2>
  );
}

/** El aviso del resultado: el UNICO del panel (`admin/ui/aviso-resultado`). El error
 *  del servidor se enseña VERBATIM: los `DatoInvalido` están escritos para leerse aquí. */
const Aviso = AvisoResultado;

function Marco({ children }: { children: React.ReactNode }) {
  return <Disclosure titulo="Estrategia del agente" resumen="Criterio con el que decide">{children}</Disclosure>;
}

export function FormaEstrategiaConductores({ accion, horasActuales }: {
  accion: AccionEstrategia;
  horasActuales: number;
}) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <Marco>
      <form action={despachar} className="rv-ag-forma">
        <CampoTexto id="est-horas" etiqueta="Horas sin confirmación antes de escalar" name="horasEscalacion" inputMode="numeric" required
          defaultValue={horasActuales}
          ayuda="Si el chofer no confirma su viaje en este tiempo, se le insiste una vez y se le avisa al jefe de tráfico. Entre 1 y 48 horas; el estándar de Likida es 5. El cambio aplica desde la siguiente corrida (cada hora en punto)." />
        <Aviso estado={estado} />
        <Boton />
      </form>
    </Marco>
  );
}

export function FormaEstrategiaLiquidacion({ accion, umbralActual }: {
  accion: AccionEstrategia;
  umbralActual: number;
}) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <Marco>
      <form action={despachar} className="rv-ag-forma">
        <CampoTexto id="est-umbral" etiqueta="Confianza mínima de lectura (OCR)" name="umbralConfianza" inputMode="decimal" required
          defaultValue={umbralActual}
          ayuda="Un comprobante leído con confianza por debajo de este umbral sale «a revisar» en vez de contarse directo. Entre 0.50 y 0.99; el estándar de Likida es 0.85. Subirlo manda más papeles a revisión manual; bajarlo acepta lecturas más dudosas como medición." />
        <Aviso estado={estado} />
        <Boton />
      </form>
    </Marco>
  );
}
