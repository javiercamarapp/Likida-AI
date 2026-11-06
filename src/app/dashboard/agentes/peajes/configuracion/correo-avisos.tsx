import type { ConfigCorreoAvisos } from '@/lib/likida/peajes/aviso_correo';
import { MAX_DESTINATARIOS_CORREO_AVISOS } from '@/lib/likida/peajes/aviso_correo';

type Accion = (fd: FormData) => Promise<void>;

export interface CorreoAvisosVista {
  /** `null` = no se pudo leer. */
  config: ConfigCorreoAvisos | null;
  puedeAdministrar: boolean;
  /** ¿Está activado el envío de correos en la cuenta? Solo informa: la prueba lo vuelve a comprobar. */
  servicioActivo: boolean;
  acciones: { guardar: Accion; enviarPrueba: Accion };
}

const ESTILO_PRIMARIO = { background: 'var(--marca)', color: 'var(--marca-fg)' } as const;
const ESTILO_SECUNDARIO = { background: 'var(--surface)', color: 'var(--muted)' } as const;
const ESTILO_INPUT = { background: 'var(--surface)', color: 'var(--ink)' } as const;

/**
 * AVISOS DE PEAJES POR CORREO: a quién le llegan, desde qué fecha y el interruptor (apagado de origen).
 * El aviso es una señal para revisar, nunca una acusación. La prueba se manda a los destinatarios ya guardados.
 */
export function SeccionCorreoAvisos({ datos }: { datos: CorreoAvisosVista }) {
  const { config, puedeAdministrar, servicioActivo, acciones } = datos;
  return (
    <section className="card p-4" id="correo-avisos">
      <h2 className="font-display text-[15px] font-semibold mb-1">Avisos de Peajes por correo</h2>
      <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>
        A qué correos llega el aviso de cobros sin reclamar cerca de su plazo y el del archivo que falta. Viene <b>apagado</b>: mientras no lo enciendas no se manda
        ningún correo. Los avisos son una señal para revisar, nunca una acusación.
      </p>

      {config === null ? (
        <p className="text-[12px]" style={{ color: 'var(--muted)' }}>No se pudo leer la configuración ahora mismo.</p>
      ) : !puedeAdministrar ? (
        <p className="text-[12px]" style={{ color: 'var(--muted)' }}>Solo quien administra la flota cambia estos valores.</p>
      ) : (
        <div className="space-y-4">
          <form action={acciones.guardar} className="space-y-3" id="correo-avisos-guardar">
            <label className="block">
              <span className="etiqueta-mono text-[11px] uppercase block" style={{ color: 'var(--faint)' }}>Correos que reciben el aviso (uno por línea, hasta {MAX_DESTINATARIOS_CORREO_AVISOS})</span>
              <textarea name="correo_destinatarios" defaultValue={config.destinatarios.join('\n')} rows={4} maxLength={2000}
                placeholder="nombre@empresa.com" className="w-full max-w-[420px] mt-0.5" style={ESTILO_INPUT} />
            </label>
            <label className="block">
              <span className="etiqueta-mono text-[11px] uppercase block" style={{ color: 'var(--faint)' }}>Fecha de corte</span>
              <input type="date" name="correo_corte" defaultValue={config.noEnviarAntes ?? ''} className="w-[170px] mt-0.5" style={ESTILO_INPUT}
                aria-label="Fecha de corte: no se avisa de nada anterior a este día" />
              <span className="block text-[11px] mt-0.5" style={{ color: 'var(--faint)' }}>No se avisa de archivos cuyo periodo terminó antes de este día. Es obligatoria para encender los avisos.</span>
            </label>
            <label className="flex items-start gap-2 text-[12px]">
              <input type="checkbox" name="correo_activo" value="1" defaultChecked={config.activo} className="mt-0.5" />
              <span>
                <span className="font-medium">Mandar los avisos por correo</span>
                <span className="block text-[11px]" style={{ color: 'var(--faint)' }}>Apagado de origen. Para encenderlo hacen falta al menos un correo y la fecha de corte.</span>
              </span>
            </label>
            <button type="submit" className="rv-btn rv-btn--primary" style={ESTILO_PRIMARIO}>Guardar avisos por correo</button>
          </form>

          <form action={acciones.enviarPrueba} className="space-y-1" id="correo-avisos-prueba">
            <button type="submit" className="rv-btn" style={ESTILO_SECUNDARIO}>Enviar correo de prueba</button>
            <p className="text-[11px]" style={{ color: 'var(--faint)' }}>
              Manda un correo de ejemplo a los correos ya guardados (guarda primero los cambios). No enciende los avisos ni habla de ningún cobro.
              {!servicioActivo && ' Ahora mismo el envío de correos no está activado en esta cuenta: la prueba no saldría.'}
            </p>
          </form>
        </div>
      )}
    </section>
  );
}
