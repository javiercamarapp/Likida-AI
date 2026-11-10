import { Mail, Download, Trash2, KeyRound } from 'lucide-react';
import type { ConfigEntradas } from '@/lib/likida/peajes/datos';
import { Icono } from '@/app/ui-v2/componentes';

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

function SoloAdmin() {
  return <p className="text-[11px] rv-pj-c-faint">Solo quien administra la flota cambia esto.</p>;
}

const minutos = (n: number) => (n % 60 === 0 ? `${n / 60} h` : `${n} min`);

/** Los dos canales de entrada nuevos del desglose: correo y pull (0563). */
export function SeccionEntradas({ entradas, acciones }: { entradas: EntradasVista; acciones: AccionesEntradas }) {
  const { config, puedeAdministrar } = entradas;
  if (config === null && entradas.direccionCorreo === null && !puedeAdministrar) return null;
  return (
    <>
      <section className="rv-tarjeta" id="correo">
        <Titulo t="Recepción por correo"
          nota="El proveedor (o tú) manda el archivo del corte como adjunto a la dirección de tu flota; el agente lo recibe, lo importa y lo cruza en el siguiente ciclo. La flota se reconoce por la dirección, no por el remitente." />
        <div className="space-y-3 text-[12px]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="cifra-mono rv-pj-pill" data-tono={config?.correoActivo ? 'ok' : undefined}>
              {config?.correoActivo ? 'activo' : 'apagado'}
            </span>
            {puedeAdministrar ? (
              config?.correoActivo ? (
                <>
                  <form action={acciones.rotarCorreo}><button type="submit" className="rv-btn rv-btn--secondary" title="La dirección anterior deja de servir al instante"><Icono icono={KeyRound} />Cambiar dirección</button></form>
                  <form action={acciones.desactivarCorreo}><button type="submit" className="rv-btn rv-btn--secondary">Apagar</button></form>
                </>
              ) : (
                <form action={acciones.activarCorreo}><button type="submit" className="rv-btn rv-btn--primary"><Icono icono={Mail} /> Activar correo</button></form>
              )
            ) : <SoloAdmin />}
          </div>
          {config?.correoActivo && (
            entradas.direccionCorreo
              ? (
                <label className="block">
                  <span className="etiqueta-mono text-[11px] uppercase rv-pj-c-faint">Dirección de tu flota (quien la conozca puede mandar cortes: compártela solo con el proveedor)</span>
                  <input readOnly value={entradas.direccionCorreo} className="w-full cifra-mono mt-0.5 rv-ctl" />
                </label>
              )
              : <p className="rv-pj-c-warn">Falta configurar el dominio de correo en el servidor (lo hace el equipo de Likida): sin él no se puede armar la dirección.</p>
          )}
          {puedeAdministrar && config?.correoActivo && (
            <form action={acciones.guardarRemitentes} className="space-y-1.5">
              <label className="block">
                <span className="etiqueta-mono text-[11px] uppercase rv-pj-c-faint">Remitentes permitidos (correo o dominio, uno por línea; sin al menos uno, el buzón no recibe correos)</span>
                <textarea name="remitentes" rows={3} defaultValue={config.remitentes.join('\n')} maxLength={2500} className="w-full cifra-mono mt-0.5 rv-ctl" />
              </label>
              <button type="submit" className="rv-btn rv-btn--secondary">Guardar remitentes</button>
              <p className="text-[11px] rv-pj-c-faint">Un correo de otro remitente se ignora (no entra ni se cruza). Con la lista vacía no entra ninguno.</p>
            </form>
          )}
        </div>
      </section>

      <section className="rv-tarjeta" id="pull">
        <Titulo t="Consulta automática a tu sistema"
          nota="Si tu TMS o un script tuyo publica los cortes en una dirección HTTPS, Likida la consulta cada cierto tiempo y lo que traiga entra a la misma cola. Pide al equipo de Likida el formato exacto del archivo. SFTP no está disponible." />
        {config === null ? (
          <p className="text-[12px] rv-pj-c-muted">No se pudo leer esta configuración ahora mismo.</p>
        ) : (
          <div className="space-y-3 text-[12px]">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="cifra-mono rv-pj-pill" data-tono={config.pullActivo ? 'ok' : undefined}>{config.pullActivo ? 'activo' : 'apagado'}</span>
              {config.pullActivo && <span className="rv-pj-c-muted">cada {minutos(config.pullIntervaloMin)}</span>}
              {config.pullUltimoEn && <span className="text-[11px] rv-pj-c-faint">última consulta buena: {config.pullUltimoEn.slice(0, 16).replace('T', ' ')} UTC</span>}
              {puedeAdministrar && config.pullActivo && (
                <form action={acciones.apagarPull}><button type="submit" className="rv-btn rv-btn--secondary">Apagar</button></form>
              )}
            </div>
            {config.pullUltimoError && <p role="alert" className="text-[12px] rv-pj-c-bad">Última consulta con problema: {config.pullUltimoError}</p>}
            {puedeAdministrar ? (
              <form action={acciones.guardarPull} className="space-y-2">
                <label className="block">
                  <span className="etiqueta-mono text-[11px] uppercase rv-pj-c-faint">Dirección HTTPS que publica los cortes</span>
                  <input name="url" type="url" required defaultValue={config.pullUrl ?? ''} placeholder="https://tms.tuflota.mx/cortes-peaje" maxLength={500} className="w-full mt-0.5 rv-ctl" />
                </label>
                <div className="flex gap-2 flex-wrap items-end">
                  <label className="block">
                    <span className="etiqueta-mono text-[11px] uppercase rv-pj-c-faint">Cada (minutos, 15 a 1,440)</span>
                    <input name="intervalo" type="number" min={15} max={1440} step={5} required defaultValue={config.pullIntervaloMin} className="w-28 mt-0.5 rv-ctl" />
                  </label>
                  <label className="block flex-1 min-w-[200px]">
                    <span className="etiqueta-mono text-[11px] uppercase rv-pj-c-faint">Token Bearer (opcional){config.pullConCredencial ? ' · ya hay uno guardado; déjalo vacío para conservarlo' : ''}</span>
                    <input name="token" type="password" autoComplete="off" maxLength={500} disabled={!entradas.cofreConfigurado} className="w-full mt-0.5 rv-ctl" />
                  </label>
                  <button type="submit" className="rv-btn rv-btn--primary"><Icono icono={Download} /> Guardar y encender</button>
                </div>
                {!entradas.cofreConfigurado && <p className="text-[11px] rv-pj-c-warn">Falta configurar el cofre de credenciales en el servidor (lo hace el equipo de Likida): sin él no se puede guardar un token de forma segura (la lectura sin token sí funciona).</p>}
              </form>
            ) : <SoloAdmin />}
            {puedeAdministrar && config.pullConCredencial && (
              <form action={acciones.borrarCredencialPull}>
                <button type="submit" className="rv-btn rv-btn--secondary"><Icono icono={Trash2} />Borrar el token guardado</button>
              </form>
            )}
          </div>
        )}
      </section>
    </>
  );
}
