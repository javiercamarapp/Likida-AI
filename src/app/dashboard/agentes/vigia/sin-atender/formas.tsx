'use client';

import { useActionState, useId, useState } from 'react';
import { Mail, Search } from 'lucide-react';
import { CAMPO_FLOTA_PINTADA } from '@/lib/auth/flota_cambio';
import '../vigia.css';
import { AvisoResultado, Boton as BotonV2, CampoTexto, Drawer, Icono } from '@/app/ui-v2/componentes';
import type { EstadoRevisionUI, ResultadoEnvioUI } from '@/lib/likida/vigia/sin_atender_aviso/acciones';
import { TablaSinAtender } from './tabla';
import { useT } from '@/lib/i18n/proveedor';
import { agentes as agentesEs } from '@/lib/i18n/es/agentes';

export type AccionRevisar = (previo: EstadoRevisionUI, fd: FormData) => Promise<EstadoRevisionUI>;
export type AccionEnviar = (previo: ResultadoEnvioUI | null, fd: FormData) => Promise<ResultadoEnvioUI>;

/** Los ajustes de esta revisión y, debajo, su resultado. Lo que se escribe aquí es una PRUEBA: vale para esta revisión y para el resumen que se mande desde aquí, y se suma a lo guardado en la configuración de la flota. */
export function FormaRevision({ revisar, enviar, flota, puedeEnviar, inicial }: {
  revisar: AccionRevisar; enviar: AccionEnviar; flota?: string; puedeEnviar: boolean; inicial: React.ReactNode;
}) {
  const { t: tx } = useT('agentes', agentesEs);
  const [revision, despacharRevision, revisando] = useActionState(revisar, null);
  const [envio, despacharEnvio, enviando] = useActionState(enviar, null);
  const idForma = useId();
  // Al llegar el resultado de una revisión el cajón se cierra solo (la apertura recuerda la revisión vigente) y la lista queda a la vista;
  // el resultado de un envío se queda en el cajón, junto a su botón.
  const [apertura, setApertura] = useState<{ revision: unknown } | null>(null);
  const abierto = apertura !== null && apertura.revision === revision;
  const setAbierto = (v: boolean) => setApertura(v ? { revision } : null);
  return (
    <div className="rv-vg__pila">
      <div className="rv-vg__linea">
        <BotonV2 type="button" variante="secondary" tamano="sm" aria-haspopup="dialog" icono={<Icono icono={Search} tam={14} />} onClick={() => setAbierto(true)}>{tx('f26d5.vg.ajustes_revision')}</BotonV2>
      </div>
      <Drawer
        abierto={abierto} onCerrar={() => setAbierto(false)} cierraConFondo={false} titulo={tx('f26d5.vg.ajustes_revision')}
        pie={(
          <>
            <BotonV2 type="button" variante="ghost" onClick={() => setAbierto(false)}>{tx('f26d4.cajon.cancelar')}</BotonV2>
            {puedeEnviar && (
              <BotonV2 type="submit" form={idForma} formAction={despacharEnvio} variante="secondary" loading={enviando} icono={<Icono icono={Mail} tam={14} />}>
                {enviando ? 'Un momento…' : tx('rest.enviar_resumen_por_correo')}
              </BotonV2>
            )}
            <BotonV2 type="submit" form={idForma} variante="primary" loading={revisando} icono={<Icono icono={Search} tam={14} />}>
              {revisando ? 'Un momento…' : tx('rest.revisar_con_estos_ajustes')}
            </BotonV2>
          </>
        )}
      >
        <form id={idForma} action={despacharRevision} className="rv-vg__pila" aria-describedby="sin-atender-aviso-prueba">
          {flota && <input type="hidden" name={CAMPO_FLOTA_PINTADA} value={flota} />}
          <p id="sin-atender-aviso-prueba" className="rv-vg__nota">{tx('rest.lo_que_escribas_aqui_es_solo')}</p>
          <CampoTexto etiqueta={tx('rest.plazo_normal_min')} name="umbralMin" inputMode="numeric" />
          <CampoTexto etiqueta={tx('rest.plazo_de_clientes_criticos_min')} name="umbralCriticoMin" inputMode="numeric" />
          <CampoTexto etiqueta={tx('rest.plazo_de_lo_urgente_min')} name="umbralUrgenteMin" inputMode="numeric" />
          <CampoTexto etiqueta={tx('rest.mensajes_seguidos_sin_respuesta_que_cuentan')} name="insistenciaMin" inputMode="numeric" />
          <CampoTexto etiqueta={tx('rest.ventana_de_insistencia_min')} name="insistenciaVentanaMin" inputMode="numeric" />
          <CampoTexto etiqueta={tx('rest.palabras_que_marcan_urgencia_separadas_por')} name="palabrasUrgentes" />
          <CampoTexto etiqueta={tx('rest.palabras_de_temas_importantes_separadas_por')} name="palabrasClave" placeholder="embarque" />
          <CampoTexto etiqueta={tx('rest.nombres_de_tu_equipo_como_salen_2')} name="equipo"
            ayuda={tx('rest.se_suman_a_los_nombres_que')} />
          {puedeEnviar && (
            <CampoTexto etiqueta={tx('rest.fecha_de_corte_para_el_resumen')} name="fechaCorte" inputMode="numeric" placeholder="AAAA-MM-DD"
              ayuda={tx('rest.no_se_avisa_de_conversaciones_anteriores')} />
          )}
          <div aria-live="polite">{envio && <AvisoResultado estado={envio} />}</div>
        </form>
      </Drawer>
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
