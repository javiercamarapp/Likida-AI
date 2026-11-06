'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Save } from 'lucide-react';
import { CAMPO_FLOTA_PINTADA } from '@/lib/auth/flota_cambio';
import { AvisoResultado } from '../../../../admin/ui/aviso-resultado';
import type { ConfigGuardadaSinAtender } from '@/lib/likida/vigia/sin_atender_aviso/motor';
import type { ResultadoGuardadoUI } from '@/lib/likida/vigia/sin_atender_aviso/acciones';

export type AccionGuardarConfig = (previo: ResultadoGuardadoUI | null, fd: FormData) => Promise<ResultadoGuardadoUI>;

const ETIQUETA = 'block text-[11px] font-medium mb-1';
const AYUDA = 'text-[11px] mt-1';
const DIAS = [['1', 'Lun'], ['2', 'Mar'], ['3', 'Mié'], ['4', 'Jue'], ['5', 'Vie'], ['6', 'Sáb'], ['0', 'Dom']] as const;

function BotonGuardar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rv-btn rv-btn--primary">
      <Save width={14} height={14} strokeWidth={1.75} aria-hidden />{pending ? 'Un momento…' : 'Guardar configuración'}
    </button>
  );
}

/**
 * La configuración que la flota deja fija para «sin atender». Solo quien administra la ve. Se manda el estado completo: una casilla sin marcar es «apagado».
 * Los nombres del equipo se guardan tal como se escriben (son del personal de la flota); los mensajes de los chats nunca se guardan aquí.
 */
export function FormaConfiguracion({ guardar, flota, guardada, configLeida }: {
  guardar: AccionGuardarConfig; flota?: string; guardada: ConfigGuardadaSinAtender; configLeida: boolean;
}) {
  const [resultado, despachar] = useActionState(guardar, null);
  const h = guardada.horarioAtencion;
  return (
    <form action={despachar} className="space-y-3" aria-describedby="sin-atender-config-ayuda">
      {flota && <input type="hidden" name={CAMPO_FLOTA_PINTADA} value={flota} />}
      <p id="sin-atender-config-ayuda" className={AYUDA} style={{ color: 'var(--muted)' }}>
        Lo que guardes aquí se usa en cada revisión de tu flota, también al subir un chat. Los campos vacíos usan los valores de arranque.
      </p>
      {!configLeida && (
        <p className="text-[12px]" role="note" style={{ color: 'var(--warn)' }}>
          No se pudo leer la configuración guardada: lo que ves abajo son los valores de arranque y no la que tenías. Recarga la página antes de guardar.
        </p>
      )}
      <fieldset className="space-y-2">
        <legend className={ETIQUETA}>Horario de atención</legend>
        <label className="flex items-center gap-2 text-[12px]">
          <input type="checkbox" name="horarioActivo" defaultChecked={h !== null} />
          Mi equipo atiende solo en este horario: la espera fuera de él no cuenta
        </label>
        <div className="grid sm:grid-cols-3 gap-3">
          <label><span className={ETIQUETA}>Abre a las (hora, 0 a 23)</span><input name="desdeHora" inputMode="numeric" defaultValue={h?.desdeHora ?? ''} className="w-full" /></label>
          <label><span className={ETIQUETA}>Cierra a las (hora, 1 a 24)</span><input name="hastaHora" inputMode="numeric" defaultValue={h?.hastaHora ?? ''} className="w-full" /></label>
        </div>
        <div role="group" aria-label="Días hábiles" className="flex flex-wrap gap-3 text-[12px]">
          {DIAS.map(([v, n]) => (
            <label key={v} className="flex items-center gap-1">
              <input type="checkbox" name="diaHabil" value={v} defaultChecked={h?.diasHabiles?.includes(Number(v)) ?? false} />{n}
            </label>
          ))}
        </div>
        <p className={AYUDA} style={{ color: 'var(--muted)' }}>Si no marcas ningún día, cuentan todos. Los festivos que ya registraste en el tablero del Vigía tampoco cuentan.</p>
      </fieldset>
      <div className="grid sm:grid-cols-2 gap-3">
        <label><span className={ETIQUETA}>Mensajes seguidos sin respuesta que cuentan como insistencia (0 la apaga)</span><input name="insistenciaMin" inputMode="numeric" defaultValue={guardada.insistenciaMin} className="w-full" /></label>
        <label><span className={ETIQUETA}>Plazo de lo urgente (min)</span><input name="umbralUrgenteMin" inputMode="numeric" defaultValue={guardada.umbralUrgenteMin} className="w-full" /></label>
        <label><span className={ETIQUETA}>Palabras que marcan urgencia (separadas por coma)</span><input name="palabrasUrgentes" defaultValue={guardada.palabrasUrgentes.join(', ')} className="w-full" /></label>
        <label><span className={ETIQUETA}>Palabras de temas importantes (separadas por coma; si las dejas vacías se usan «embarque» y «embarques»)</span><input name="palabrasClave" defaultValue={guardada.palabrasClave.join(', ')} placeholder="embarque" className="w-full" /></label>
      </div>
      <label className="block">
        <span className={ETIQUETA}>Nombres de tu equipo, como salen en el chat (separados por coma)</span>
        <textarea name="equipo" rows={2} defaultValue={guardada.equipoNombres.join(', ')} className="w-full" aria-describedby="sin-atender-config-equipo" />
        <span id="sin-atender-config-equipo" className={AYUDA} style={{ color: 'var(--muted)' }}>Se guardan tal como los escribes, para no teclearlos en cada revisión. Quien no esté en la lista se cuenta como cliente.</span>
      </label>
      <label className="flex items-center gap-2 text-[12px]">
        <input type="checkbox" name="resumenCorreo" defaultChecked={guardada.resumenCorreoHabilitado} />
        Permitir que se mande el resumen por correo desde esta pantalla (sigue saliendo solo por clic)
      </label>
      <BotonGuardar />
      <div aria-live="polite">{resultado && <AvisoResultado estado={resultado} />}</div>
    </form>
  );
}
