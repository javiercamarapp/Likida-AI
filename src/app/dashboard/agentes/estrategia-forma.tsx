'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Save } from 'lucide-react';
import { Boton as BotonV2, CampoTexto, Disclosure, Icono } from '@/app/ui-v2/componentes';
import { AvisoResultado } from '../../admin/ui/aviso-resultado';
import { useT } from '@/lib/i18n/proveedor';
import { resto as restoEs } from '@/lib/i18n/es/resto';

// La estrategia editable de un agente (B4, auditoría 4) — SOLO donde hay una
// perilla que un motor de verdad lee. El valor actual llega como prop desde el
// server component (que lo leyó de getConfig); el default del producto se dice
// en la ayuda para que "regresar a como estaba" no requiera adivinar.

export type ResultadoEstrategia = { ok: true; mensaje: string } | { ok: false; error: string } | null;
export type AccionEstrategia = (previo: ResultadoEstrategia, fd: FormData) => Promise<ResultadoEstrategia>;

function Boton() {
  const { t } = useT('resto', restoEs);
  const { pending } = useFormStatus();
  return (
    <BotonV2 type="submit" variante="primary" loading={pending} disabled={pending} icono={<Icono icono={Save} tam={14} />}>
      {pending ? 'Guardando…' : t('ch.guardar_estrategia')}
    </BotonV2>
  );
}

/** El aviso del resultado: el UNICO del panel (`admin/ui/aviso-resultado`). El error
 *  del servidor se enseña VERBATIM: los `DatoInvalido` están escritos para leerse aquí. */
const Aviso = AvisoResultado;

function Marco({ children }: { children: React.ReactNode }) {
  const { t } = useT('resto', restoEs);
  return <Disclosure titulo={t('ch.estrategia_del_agente')} resumen={t('ch.criterio_con_el_que_decide')}>{children}</Disclosure>;
}

export function FormaEstrategiaConductores({ accion, horasActuales }: {
  accion: AccionEstrategia;
  horasActuales: number;
}) {
  const { t } = useT('resto', restoEs);
  const [estado, despachar] = useActionState(accion, null);
  return (
    <Marco>
      <form action={despachar} className="rv-ag-forma">
        <CampoTexto id="est-horas" etiqueta={t('ch.horas_sin_confirmacion_antes_de_escalar')} name="horasEscalacion" inputMode="numeric" required
          defaultValue={horasActuales}
          ayuda={t('ch.si_el_chofer_no_confirma_su')} />
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
  const { t } = useT('resto', restoEs);
  const [estado, despachar] = useActionState(accion, null);
  return (
    <Marco>
      <form action={despachar} className="rv-ag-forma">
        <CampoTexto id="est-umbral" etiqueta={t('ch.confianza_minima_de_lectura_ocr')} name="umbralConfianza" inputMode="decimal" required
          defaultValue={umbralActual}
          ayuda={t('ch.un_comprobante_leido_con_confianza_por')} />
        <Aviso estado={estado} />
        <Boton />
      </form>
    </Marco>
  );
}
