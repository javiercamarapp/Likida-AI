'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Mail, Search } from 'lucide-react';
import { CAMPO_FLOTA_PINTADA } from '@/lib/auth/flota_cambio';
import '../vigia.css';
import { AvisoResultado, Boton as BotonV2, CampoTexto, Icono } from '@/app/ui-v2/componentes';
import type { EstadoRevisionUI, ResultadoEnvioUI } from '@/lib/likida/vigia/sin_atender_aviso/acciones';
import { TablaSinAtender } from './tabla';
import { useT } from '@/lib/i18n/proveedor';
import { agentes as agentesEs } from '@/lib/i18n/es/agentes';

export type AccionRevisar = (previo: EstadoRevisionUI, fd: FormData) => Promise<EstadoRevisionUI>;
export type AccionEnviar = (previo: ResultadoEnvioUI | null, fd: FormData) => Promise<ResultadoEnvioUI>;

function Boton({ children, Ic, secundario, formAction }: { children: React.ReactNode; Ic: typeof Search; secundario?: boolean; formAction?: (fd: FormData) => void }) {
  const { pending } = useFormStatus();
  return (
    <BotonV2 type="submit" formAction={formAction} loading={pending} variante={secundario ? 'secondary' : 'primary'} icono={<Icono icono={Ic} tam={14} />}>
      {pending ? 'Un momento…' : children}
    </BotonV2>
  );
}

/** Los ajustes de esta revisión y, debajo, su resultado. Lo que se escribe aquí es una PRUEBA: vale para esta revisión y para el resumen que se mande desde aquí, y se suma a lo guardado en la configuración de la flota. */
export function FormaRevision({ revisar, enviar, flota, puedeEnviar, inicial }: {
  revisar: AccionRevisar; enviar: AccionEnviar; flota?: string; puedeEnviar: boolean; inicial: React.ReactNode;
}) {
  const { t: tx } = useT('agentes', agentesEs);
  const [revision, despacharRevision] = useActionState(revisar, null);
  const [envio, despacharEnvio] = useActionState(enviar, null);
  return (
    <div className="rv-vg__pila">
      <form action={despacharRevision} className="rv-vg__pila" aria-describedby="sin-atender-aviso-prueba">
        {flota && <input type="hidden" name={CAMPO_FLOTA_PINTADA} value={flota} />}
        <p id="sin-atender-aviso-prueba" className="rv-vg__nota">{tx('rest.lo_que_escribas_aqui_es_solo')}</p>
        <div className="rv-vg__cuad">
          <CampoTexto etiqueta={tx('rest.plazo_normal_min')} name="umbralMin" inputMode="numeric" />
          <CampoTexto etiqueta={tx('rest.plazo_de_clientes_criticos_min')} name="umbralCriticoMin" inputMode="numeric" />
          <CampoTexto etiqueta={tx('rest.plazo_de_lo_urgente_min')} name="umbralUrgenteMin" inputMode="numeric" />
          <CampoTexto etiqueta={tx('rest.mensajes_seguidos_sin_respuesta_que_cuentan')} name="insistenciaMin" inputMode="numeric" />
          <CampoTexto etiqueta={tx('rest.ventana_de_insistencia_min')} name="insistenciaVentanaMin" inputMode="numeric" />
        </div>
        <div className="rv-vg__cuad">
          <CampoTexto etiqueta={tx('rest.palabras_que_marcan_urgencia_separadas_por')} name="palabrasUrgentes" />
          <CampoTexto etiqueta={tx('rest.palabras_de_temas_importantes_separadas_por')} name="palabrasClave" placeholder="embarque" />
        </div>
        <CampoTexto etiqueta={tx('rest.nombres_de_tu_equipo_como_salen_2')} name="equipo"
          ayuda={tx('rest.se_suman_a_los_nombres_que')} />
        {puedeEnviar && (
          <CampoTexto etiqueta={tx('rest.fecha_de_corte_para_el_resumen')} name="fechaCorte" inputMode="numeric" placeholder="AAAA-MM-DD"
            ayuda={tx('rest.no_se_avisa_de_conversaciones_anteriores')} />
        )}
        <div className="rv-vg__linea">
          <Boton Ic={Search} secundario>{tx('rest.revisar_con_estos_ajustes')}</Boton>
          {puedeEnviar && <Boton Ic={Mail} formAction={despacharEnvio}>{tx('rest.enviar_resumen_por_correo')}</Boton>}
        </div>
        <div aria-live="polite">{envio && <AvisoResultado estado={envio} />}</div>
      </form>
      {revision === null ? inicial : revision.ok ? (
        <div className="rv-vg__pila" aria-live="polite">
          {revision.notas.map((n) => <p key={n} className="rv-vg__nota" data-tono="warn">{n}</p>)}
          <p className="rv-vg__nota">{tx('rest.resultado_de_esta_revision_no_se')}</p>
          <TablaSinAtender alertas={revision.resultado.alertas} />
        </div>
      ) : <AvisoResultado estado={revision} />}
    </div>
  );
}
