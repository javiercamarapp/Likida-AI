import { Mail, Download, Trash2, KeyRound } from 'lucide-react';
import type { ConfigEntradas } from '@/lib/likida/peajes/datos';

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

const CSS_INPUT = 'hairline text-[12.5px] px-2.5 py-1.5 rounded-lg';
const ESTILO_INPUT = { background: 'var(--surface)', color: 'var(--ink)' } as const;
const CSS_BOTON = 'inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-lg transition-opacity hover:opacity-85';
const ESTILO_PRIMARIO = { background: 'var(--marca)', color: 'var(--marca-fg)' } as const;
const CSS_SECUNDARIO = 'hairline text-[12.5px] font-medium px-3 py-1.5 rounded-lg transition-colors hover:bg-[var(--canvas)]';
const ESTILO_SECUNDARIO = { background: 'var(--surface)', color: 'var(--muted)' } as const;

function Titulo({ t, nota }: { t: string; nota: React.ReactNode }) {
  return (
    <>
      <h2 className="font-display text-[15px] font-semibold mb-1">{t}</h2>
      <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>{nota}</p>
    </>
  );
}

function SoloAdmin() {
  return <p className="text-[11px]" style={{ color: 'var(--faint)' }}>Solo quien administra la flota cambia esto.</p>;
}

const minutos = (n: number) => (n % 60 === 0 ? `${n / 60} h` : `${n} min`);

/** Los dos canales de entrada nuevos del desglose: correo y pull (0563). */
export function SeccionEntradas({ entradas, acciones }: { entradas: EntradasVista; acciones: AccionesEntradas }) {
  const { config, puedeAdministrar } = entradas;
  if (config === null && entradas.direccionCorreo === null && !puedeAdministrar) return null;
  return (
    <>
      <section className="card p-4" id="correo">
        <Titulo t="Recepción por correo"
          nota="El proveedor (o tú) manda el archivo del corte como adjunto a la dirección de tu flota; el agente lo recibe, lo importa y lo cruza en el siguiente ciclo. La flota se reconoce por la dirección, no por el remitente." />
        <div className="space-y-3 text-[12.5px]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="cifra-mono px-2 py-0.5 rounded-md" style={{ background: 'var(--canvas)', color: config?.correoActivo ? 'var(--ok)' : 'var(--muted)' }}>
              {config?.correoActivo ? 'activo' : 'apagado'}
            </span>
            {puedeAdministrar ? (
              config?.correoActivo ? (
                <>
                  <form action={acciones.rotarCorreo}><button type="submit" className={CSS_SECUNDARIO} style={ESTILO_SECUNDARIO} title="La dirección anterior deja de servir al instante"><KeyRound width={12} height={12} strokeWidth={2} className="inline mr-1" />Cambiar dirección</button></form>
                  <form action={acciones.desactivarCorreo}><button type="submit" className={CSS_SECUNDARIO} style={ESTILO_SECUNDARIO}>Apagar</button></form>
                </>
              ) : (
                <form action={acciones.activarCorreo}><button type="submit" className={CSS_BOTON} style={ESTILO_PRIMARIO}><Mail width={13} height={13} strokeWidth={2} /> Activar correo</button></form>
              )
            ) : <SoloAdmin />}
          </div>
          {config?.correoActivo && (
            entradas.direccionCorreo
              ? (
                <label className="block">
                  <span className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>Dirección de tu flota (quien la conozca puede mandar cortes: compártela solo con el proveedor)</span>
                  <input readOnly value={entradas.direccionCorreo} className={`${CSS_INPUT} w-full cifra-mono mt-0.5`} style={ESTILO_INPUT} />
                </label>
              )
              : <p style={{ color: 'var(--warn)' }}>Falta RESEND_EMAIL_DOMAIN en el servidor: sin el dominio de correo no se puede armar la dirección.</p>
          )}
          {puedeAdministrar && config?.correoActivo && (
            <form action={acciones.guardarRemitentes} className="space-y-1.5">
              <label className="block">
                <span className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>Remitentes permitidos (correo o dominio, uno por línea; vacío = cualquiera con la dirección)</span>
                <textarea name="remitentes" rows={3} defaultValue={config.remitentes.join('\n')} maxLength={2500} className={`${CSS_INPUT} w-full cifra-mono mt-0.5`} style={ESTILO_INPUT} />
              </label>
              <button type="submit" className={CSS_SECUNDARIO} style={ESTILO_SECUNDARIO}>Guardar remitentes</button>
              <p className="text-[11px]" style={{ color: 'var(--faint)' }}>Con lista, un correo de otro remitente se ignora (no entra ni se cruza).</p>
            </form>
          )}
        </div>
      </section>

      <section className="card p-4" id="pull">
        <Titulo t="Consulta automática a tu sistema (pull)"
          nota="Si tu TMS o un script tuyo publica los cortes en una dirección HTTPS, Likida la consulta cada cierto tiempo y lo que traiga entra a la misma cola. Formato en docs/operacion/conciliacion-peajes.md. SFTP no está disponible." />
        {config === null ? (
          <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>No se pudo leer esta configuración ahora mismo.</p>
        ) : (
          <div className="space-y-3 text-[12.5px]">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="cifra-mono px-2 py-0.5 rounded-md" style={{ background: 'var(--canvas)', color: config.pullActivo ? 'var(--ok)' : 'var(--muted)' }}>{config.pullActivo ? 'activo' : 'apagado'}</span>
              {config.pullActivo && <span style={{ color: 'var(--muted)' }}>cada {minutos(config.pullIntervaloMin)}</span>}
              {config.pullUltimoEn && <span className="text-[11px]" style={{ color: 'var(--faint)' }}>última consulta buena: {config.pullUltimoEn.slice(0, 16).replace('T', ' ')} UTC</span>}
              {puedeAdministrar && config.pullActivo && (
                <form action={acciones.apagarPull}><button type="submit" className={CSS_SECUNDARIO} style={ESTILO_SECUNDARIO}>Apagar</button></form>
              )}
            </div>
            {config.pullUltimoError && <p role="alert" className="text-[12px]" style={{ color: 'var(--bad)' }}>Última consulta con problema: {config.pullUltimoError}</p>}
            {puedeAdministrar ? (
              <form action={acciones.guardarPull} className="space-y-2">
                <label className="block">
                  <span className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>Dirección HTTPS que publica los cortes</span>
                  <input name="url" type="url" required defaultValue={config.pullUrl ?? ''} placeholder="https://tms.tuflota.mx/cortes-peaje" maxLength={500} className={`${CSS_INPUT} w-full mt-0.5`} style={ESTILO_INPUT} />
                </label>
                <div className="flex gap-2 flex-wrap items-end">
                  <label className="block">
                    <span className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>Cada (minutos, 15 a 1,440)</span>
                    <input name="intervalo" type="number" min={15} max={1440} step={5} required defaultValue={config.pullIntervaloMin} className={`${CSS_INPUT} w-28 mt-0.5`} style={ESTILO_INPUT} />
                  </label>
                  <label className="block flex-1 min-w-[200px]">
                    <span className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>Token Bearer (opcional){config.pullConCredencial ? ' · ya hay uno guardado; déjalo vacío para conservarlo' : ''}</span>
                    <input name="token" type="password" autoComplete="off" maxLength={500} disabled={!entradas.cofreConfigurado} className={`${CSS_INPUT} w-full mt-0.5`} style={ESTILO_INPUT} />
                  </label>
                  <button type="submit" className={CSS_BOTON} style={ESTILO_PRIMARIO}><Download width={13} height={13} strokeWidth={2} /> Guardar y encender</button>
                </div>
                {!entradas.cofreConfigurado && <p className="text-[11.5px]" style={{ color: 'var(--warn)' }}>Falta LIKIDA_COFRE_LLAVE en el servidor: sin ella no se puede guardar un token de forma segura (el pull sin token sí funciona).</p>}
              </form>
            ) : <SoloAdmin />}
            {puedeAdministrar && config.pullConCredencial && (
              <form action={acciones.borrarCredencialPull}>
                <button type="submit" className={CSS_SECUNDARIO} style={ESTILO_SECUNDARIO}><Trash2 width={11} height={11} strokeWidth={2} className="inline mr-1" />Borrar el token guardado</button>
              </form>
            )}
          </div>
        )}
      </section>
    </>
  );
}
