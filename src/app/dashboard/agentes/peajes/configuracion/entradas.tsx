import { Mail, Download, Trash2, KeyRound } from 'lucide-react';
import type { ConfigEntradas } from '@/lib/likida/peajes/datos';
import { Icono } from '@/app/ui-v2/componentes';
import { type TrAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';
import { rico as ricoT } from '@/lib/i18n/rico';

type Accion = (fd: FormData) => Promise<void>;

export interface AccionesEntradas {
  activarCorreo: Accion; desactivarCorreo: Accion; rotarCorreo: Accion; guardarRemitentes: Accion;
  guardarPull: Accion; apagarPull: Accion; borrarCredencialPull: Accion;
}

export interface EntradasVista {
  /** `null` = no se pudo leer. */
  config: ConfigEntradas | null;
  puedeAdministrar: boolean;
  /** `pj-<token>@dominio`, o null si el dominio de correo no está configurado en el servidor. */
  direccionCorreo: string | null;
  /** ¿Está LIKIDA_COFRE_LLAVE configurada? Sin ella no se puede guardar el token del pull. */
  cofreConfigurado: boolean;
}


function Titulo({ t, nota }: { t: string; nota: React.ReactNode }) {
  return (
    <>
      <h2 className="font-display text-[15px] font-semibold mb-1">{t}</h2>
      <p className="text-[11px] mb-3 rv-pj-c-faint">{nota}</p>
    </>
  );
}

function SoloAdmin({ tr = TR_ES }: { tr?: TrAgentes }) {
  const { t: tx } = tr;
  return <p className="text-[11px] rv-pj-c-faint">{tx('rest.solo_quien_administra_la_flota_cambia_2')}</p>;
}

const minutos = (n: number) => (n % 60 === 0 ? `${n / 60} h` : `${n} min`);

/** Los dos canales de entrada nuevos del desglose: correo y pull (0563). */
export function SeccionEntradas({ entradas, acciones, tr = TR_ES }: { entradas: EntradasVista; acciones: AccionesEntradas; tr?: TrAgentes }) {
  const { t: tx } = tr;
  const { config, puedeAdministrar } = entradas;
  if (config === null && entradas.direccionCorreo === null && !puedeAdministrar) return null;
  return (
    <>
      <section className="rv-tarjeta" id="correo">
        <Titulo t={tx('rest.recepcion_por_correo')}
          nota={tx('rest.el_proveedor_o_tu_manda_el')} />
        <div className="space-y-3 text-[12px]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="cifra-mono rv-pj-pill" data-tono={config?.correoActivo ? 'ok' : undefined}>
              {config?.correoActivo ? 'activo' : 'apagado'}
            </span>
            {puedeAdministrar ? (
              config?.correoActivo ? (
                <>
                  <form action={acciones.rotarCorreo}><button type="submit" className="rv-btn rv-btn--secondary" title={tx('rest.la_direccion_anterior_deja_de_servir')}><Icono icono={KeyRound} />{tx('rest.cambiar_direccion')}</button></form>
                  <form action={acciones.desactivarCorreo}><button type="submit" className="rv-btn rv-btn--secondary">{tx('rest.apagar')}</button></form>
                </>
              ) : (
                <form action={acciones.activarCorreo}><button type="submit" className="rv-btn rv-btn--primary"><Icono icono={Mail} />{' '}{tx('rest.activar_correo')}</button></form>
              )
            ) : <SoloAdmin tr={tr} />}
          </div>
          {config?.correoActivo && (
            entradas.direccionCorreo
              ? (
                <label className="block">{ricoT(tx('rest.e0_direccion_de_tu_flota_quien'), { e0: (c) => <span className="etiqueta-mono text-[11px] uppercase rv-pj-c-faint">{c}</span> })}<input readOnly value={entradas.direccionCorreo} className="w-full cifra-mono mt-0.5 rv-ctl" />
                </label>
              )
              : <p className="rv-pj-c-warn">{tx('rest.falta_configurar_el_dominio_de_correo')}</p>
          )}
          {puedeAdministrar && config?.correoActivo && (
            <form action={acciones.guardarRemitentes} className="space-y-1.5">
              <label className="block">{ricoT(tx('rest.e0_remitentes_permitidos_correo_o_dominio'), { e0: (c) => <span className="etiqueta-mono text-[11px] uppercase rv-pj-c-faint">{c}</span> })}<textarea name="remitentes" rows={3} defaultValue={config.remitentes.join('\n')} maxLength={2500} className="w-full cifra-mono mt-0.5 rv-ctl" />
              </label>
              <button type="submit" className="rv-btn rv-btn--secondary">{tx('rest.guardar_remitentes')}</button>
              <p className="text-[11px] rv-pj-c-faint">{tx('rest.un_correo_de_otro_remitente_se')}</p>
            </form>
          )}
        </div>
      </section>

      <section className="rv-tarjeta" id="pull">
        <Titulo t={tx('rest.consulta_automatica_a_tu_sistema')}
          nota={tx('rest.si_tu_tms_o_un_script')} />
        {config === null ? (
          <p className="text-[12px] rv-pj-c-muted">{tx('rest.no_se_pudo_leer_esta_configuracion')}</p>
        ) : (
          <div className="space-y-3 text-[12px]">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="cifra-mono rv-pj-pill" data-tono={config.pullActivo ? 'ok' : undefined}>{config.pullActivo ? 'activo' : 'apagado'}</span>
              {config.pullActivo && <span className="rv-pj-c-muted">cada {minutos(config.pullIntervaloMin)}</span>}
              {config.pullUltimoEn && <span className="text-[11px] rv-pj-c-faint">{tx('rest.ultima_consulta_buena_utc', { config: config.pullUltimoEn.slice(0, 16).replace('T', ' ') })}</span>}
              {puedeAdministrar && config.pullActivo && (
                <form action={acciones.apagarPull}><button type="submit" className="rv-btn rv-btn--secondary">{tx('rest.apagar')}</button></form>
              )}
            </div>
            {config.pullUltimoError && <p role="alert" className="text-[12px] rv-pj-c-bad">{tx('rest.ultima_consulta_con_problema')}{' '}{config.pullUltimoError}</p>}
            {puedeAdministrar ? (
              <form action={acciones.guardarPull} className="space-y-2">
                <label className="block">{ricoT(tx('rest.e0_direccion_https_que_publica_los'), { e0: (c) => <span className="etiqueta-mono text-[11px] uppercase rv-pj-c-faint">{c}</span> })}<input name="url" type="url" required defaultValue={config.pullUrl ?? ''} placeholder="https://tms.tuflota.mx/cortes-peaje" maxLength={500} className="w-full mt-0.5 rv-ctl" />
                </label>
                <div className="flex gap-2 flex-wrap items-end">
                  <label className="block">{ricoT(tx('rest.e0_cada_minutos_15_a_1'), { e0: (c) => <span className="etiqueta-mono text-[11px] uppercase rv-pj-c-faint">{c}</span> })}<input name="intervalo" type="number" min={15} max={1440} step={5} required defaultValue={config.pullIntervaloMin} className="w-28 mt-0.5 rv-ctl" />
                  </label>
                  <label className="block flex-1 min-w-[200px]">
                    <span className="etiqueta-mono text-[11px] uppercase rv-pj-c-faint">{tx('rest.token_bearer_opcional')}{config.pullConCredencial ? tx('rest.ya_hay_uno_guardado_dejalo_vacio') : ''}</span>
                    <input name="token" type="password" autoComplete="off" maxLength={500} disabled={!entradas.cofreConfigurado} className="w-full mt-0.5 rv-ctl" />
                  </label>
                  <button type="submit" className="rv-btn rv-btn--primary"><Icono icono={Download} />{' '}{tx('rest.guardar_y_encender')}</button>
                </div>
                {!entradas.cofreConfigurado && <p className="text-[11px] rv-pj-c-warn">{tx('rest.falta_configurar_el_cofre_de_credenciales')}</p>}
              </form>
            ) : <SoloAdmin tr={tr} />}
            {puedeAdministrar && config.pullConCredencial && (
              <form action={acciones.borrarCredencialPull}>
                <button type="submit" className="rv-btn rv-btn--secondary"><Icono icono={Trash2} />{tx('rest.borrar_el_token_guardado')}</button>
              </form>
            )}
          </div>
        )}
      </section>
    </>
  );
}
