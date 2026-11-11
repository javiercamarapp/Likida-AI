import type { ConfigCorreoAvisos } from '@/lib/likida/peajes/aviso_correo';
import { MAX_DESTINATARIOS_CORREO_AVISOS } from '@/lib/likida/peajes/aviso_correo';
import { Tarjeta } from '@/app/ui-v2/componentes';
import '../peajes.css';
import { type TrAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';
import { rico as ricoT } from '@/lib/i18n/rico';

type Accion = (fd: FormData) => Promise<void>;

export interface CorreoAvisosVista {
  /** `null` = no se pudo leer. */
  config: ConfigCorreoAvisos | null;
  puedeAdministrar: boolean;
  /** ¿Está activado el envío de correos en la cuenta? Solo informa: la prueba lo vuelve a comprobar. */
  servicioActivo: boolean;
  acciones: { guardar: Accion; enviarPrueba: Accion };
}


/**
 * AVISOS DE PEAJES POR CORREO: a quién le llegan, desde qué fecha y el interruptor (apagado de origen).
 * El aviso es una señal para revisar, nunca una acusación. La prueba se manda a los destinatarios ya guardados.
 */
export function SeccionCorreoAvisos({ datos, tr = TR_ES }: { datos: CorreoAvisosVista; tr?: TrAgentes }) {
  const { t: tx } = tr;
  const { config, puedeAdministrar, servicioActivo, acciones } = datos;
  return (
    <div id="correo-avisos">
    <Tarjeta titulo={tx('rest.avisos_de_peajes_por_correo')}>
      <p className="text-[11px] mb-3 rv-pj-c-faint">{ricoT(tx('rest.a_que_correos_llega_el_aviso'), { b: (c) => <b>{c}</b> })}</p>

      {config === null ? (
        <p className="text-[12px] rv-pj-c-muted">{tx('rest.no_se_pudo_leer_la_configuracion_6')}</p>
      ) : !puedeAdministrar ? (
        <p className="text-[12px] rv-pj-c-muted">{tx('rest.solo_quien_administra_la_flota_cambia')}</p>
      ) : (
        <div className="space-y-4">
          <form action={acciones.guardar} className="space-y-3" id="correo-avisos-guardar">
            <label className="block">{ricoT(tx('rest.e0_correos_que_reciben_el_aviso', { maxDestinatariosCorreoAvisos: MAX_DESTINATARIOS_CORREO_AVISOS }), { e0: (c) => <span className="etiqueta-mono text-[11px] uppercase block rv-pj-c-faint">{c}</span> })}<textarea name="correo_destinatarios" defaultValue={config.destinatarios.join('\n')} rows={4} maxLength={4000}
                placeholder="nombre@empresa.com" className="w-full max-w-[420px] mt-0.5 rv-ctl" />
            </label>
            <label className="block">{ricoT(tx('rest.e0_fecha_de_corte_e0'), { e0: (c) => <span className="etiqueta-mono text-[11px] uppercase block rv-pj-c-faint">{c}</span> })}<input type="date" name="correo_corte" defaultValue={config.noEnviarAntes ?? ''} className="w-[170px] mt-0.5 rv-ctl rv-ctl--fecha"
                aria-label={tx('rest.fecha_de_corte_no_se_avisa')} />{ricoT(tx('rest.e0_no_se_avisa_de_archivos'), { e0: (c) => <span className="block text-[11px] mt-0.5 rv-pj-c-faint">{c}</span> })}</label>
            <label className="flex items-start gap-2 text-[12px]">
              <input type="checkbox" name="correo_activo" value="1" defaultChecked={config.activo} className="mt-0.5" />
              <span>{ricoT(tx('rest.e0_mandar_los_avisos_por_correo'), { e0: (c) => <span className="font-medium">{c}</span>, e1: (c) => <span className="block text-[11px] rv-pj-c-faint">{c}</span> })}</span>
            </label>
            <button type="submit" className="rv-btn rv-btn--primary">{tx('rest.guardar_avisos_por_correo')}</button>
          </form>

          <form action={acciones.enviarPrueba} className="space-y-1" id="correo-avisos-prueba">
            <button type="submit" className="rv-btn">{tx('rest.enviar_correo_de_prueba')}</button>
            <p className="text-[11px] rv-pj-c-faint">{tx('rest.manda_un_correo_de_ejemplo_a')}{!servicioActivo && tx('rest.ahora_mismo_el_envio_de_correos')}
            </p>
          </form>
        </div>
      )}
    </Tarjeta>
    </div>
  );
}
