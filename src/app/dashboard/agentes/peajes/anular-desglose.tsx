'use client';

import { useState, useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Ban } from 'lucide-react';
import { AvisoResultado, Boton, CampoTextarea, DialogoConfirmar, Icono, type ResultadoUI } from '@/app/ui-v2/componentes';
import './peajes.css';
import { useT } from '@/lib/i18n/proveedor';
import { agentes as agentesEs } from '@/lib/i18n/es/agentes';

export type EstadoAnular = { ok?: string; error?: string } | null;
export type AccionAnular = (prev: EstadoAnular, fd: FormData) => Promise<EstadoAnular>;

/**
 * «Anular desglose»: para el archivo subido por error. Pide un MOTIVO (obligatorio:
 * una anulación sin porqué es la que nadie puede defender), lo dice todo en el
 * diálogo —qué deja de contar y que el archivo correcto puede volver a mandarse— y
 * no borra nada: el desglose queda de constancia con quién y por qué.
 */
export function BotonAnular({ anular, desgloseId }: { anular: AccionAnular; desgloseId: string }) {
  const { t: tx } = useT('agentes', agentesEs);
  const [estado, accion, pendiente] = useActionState(anular, null);
  const [abierto, setAbierto] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (estado?.ok) router.refresh();
  }, [estado, router]);

  return (
    <form action={accion} className="rv-pj-control" onSubmit={() => setAbierto(false)}>
      <input type="hidden" name="desglose" value={desgloseId} />
      <Boton variante="danger" onClick={() => setAbierto(true)} icono={<Icono icono={Ban} />}
        title={tx('rest.para_un_archivo_subido_por_error')}>{tx('rest.anular')}</Boton>
      <DialogoConfirmar
        abierto={abierto} titulo={tx('rest.anular_este_desglose')} tono="peligro" cierraConFondo={false}
        etiquetaConfirmar={tx('rest.anular_desglose')} tipoConfirmar="submit" pendiente={pendiente}
        onConfirmar={() => setAbierto(false)} onCancelar={() => setAbierto(false)}
        descripcion={(
          <div className="rv-pj-dialogo">
            <p>{tx('rest.deja_de_aparecer_aqui_de_contar')}</p>
            <CampoTextarea etiqueta={tx('rest.motivo_obligatorio_hasta_500_caracteres')} name="motivo" required maxLength={500} rows={3} />
          </div>
        )}
      />
      <AvisoResultado estado={estado as ResultadoUI} compacto />
    </form>
  );
}
