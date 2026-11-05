'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Mail, Search } from 'lucide-react';
import { CAMPO_FLOTA_PINTADA } from '@/lib/auth/flota_cambio';
import { AvisoResultado } from '../../../../admin/ui/aviso-resultado';
import type { EstadoRevisionUI, ResultadoEnvioUI } from '@/lib/likida/vigia/sin_atender_aviso/acciones';
import { TablaSinAtender } from './tabla';

export type AccionRevisar = (previo: EstadoRevisionUI, fd: FormData) => Promise<EstadoRevisionUI>;
export type AccionEnviar = (previo: ResultadoEnvioUI | null, fd: FormData) => Promise<ResultadoEnvioUI>;

const ETIQUETA = 'block text-[11px] font-medium mb-1';
const AYUDA = 'text-[11px] mt-1';

function Boton({ children, Icono, secundario, formAction }: { children: React.ReactNode; Icono: typeof Search; secundario?: boolean; formAction?: (fd: FormData) => void }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} formAction={formAction} className={`rv-btn ${secundario ? 'rv-btn--secondary' : 'rv-btn--primary'}`}>
      <Icono width={14} height={14} strokeWidth={1.75} aria-hidden />{pending ? 'Un momento…' : children}
    </button>
  );
}

/** Los ajustes de esta revisión y, debajo, su resultado. Lo que se escribe NO se guarda: vale para esta revisión y para el resumen que se mande desde aquí. */
export function FormaRevision({ revisar, enviar, flota, puedeEnviar, inicial }: {
  revisar: AccionRevisar; enviar: AccionEnviar; flota?: string; puedeEnviar: boolean; inicial: React.ReactNode;
}) {
  const [revision, despacharRevision] = useActionState(revisar, null);
  const [envio, despacharEnvio] = useActionState(enviar, null);
  return (
    <div className="space-y-4">
      <form action={despacharRevision} className="space-y-3" aria-describedby="sin-atender-aviso-prueba">
        {flota && <input type="hidden" name={CAMPO_FLOTA_PINTADA} value={flota} />}
        <p id="sin-atender-aviso-prueba" className={AYUDA} style={{ color: 'var(--muted)' }}>Lo que escribas aquí no se guarda: vale solo para esta revisión. Los campos vacíos usan los plazos de tu flota.</p>
        <div className="grid sm:grid-cols-3 gap-3">
          <label><span className={ETIQUETA}>Plazo normal (min)</span><input name="umbralMin" inputMode="numeric" className="w-full" /></label>
          <label><span className={ETIQUETA}>Plazo de clientes críticos (min)</span><input name="umbralCriticoMin" inputMode="numeric" className="w-full" /></label>
          <label><span className={ETIQUETA}>Plazo de lo urgente (min)</span><input name="umbralUrgenteMin" inputMode="numeric" className="w-full" /></label>
          <label><span className={ETIQUETA}>Mensajes seguidos sin respuesta que cuentan como insistencia</span><input name="insistenciaMin" inputMode="numeric" className="w-full" /></label>
          <label><span className={ETIQUETA}>Ventana de insistencia (min)</span><input name="insistenciaVentanaMin" inputMode="numeric" className="w-full" /></label>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <label><span className={ETIQUETA}>Palabras que marcan urgencia (separadas por coma)</span><input name="palabrasUrgentes" className="w-full" /></label>
          <label><span className={ETIQUETA}>Palabras de temas importantes (separadas por coma)</span><input name="palabrasClave" className="w-full" placeholder="embarque" /></label>
        </div>
        <label className="block">
          <span className={ETIQUETA}>Nombres de tu equipo, como salen en el chat (separados por coma)</span>
          <input name="equipo" className="w-full" />
          <span className={AYUDA} style={{ color: 'var(--muted)' }}>Sirve para corregir quién es del equipo sin volver a subir el chat.</span>
        </label>
        {puedeEnviar && (
          <label className="block sm:w-1/2">
            <span className={ETIQUETA}>Fecha de corte para el resumen por correo (AAAA-MM-DD)</span>
            <input name="fechaCorte" inputMode="numeric" placeholder="2026-01-31" className="w-full" aria-describedby="sin-atender-corte" />
            <span id="sin-atender-corte" className={AYUDA} style={{ color: 'var(--muted)' }}>No se avisa de conversaciones anteriores a este día.</span>
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          <Boton Icono={Search} secundario>Revisar con estos ajustes</Boton>
          {puedeEnviar && <Boton Icono={Mail} formAction={despacharEnvio}>Enviar resumen por correo</Boton>}
        </div>
        {envio && <AvisoResultado estado={envio} />}
      </form>
      {revision === null ? inicial : revision.ok ? (
        <div className="space-y-2" aria-live="polite">
          {revision.notas.map((n) => <p key={n} className="text-[12px]" style={{ color: 'var(--warn)' }}>{n}</p>)}
          <p className="text-[12px]" style={{ color: 'var(--muted)' }}>Resultado de esta revisión (no se guardó).</p>
          <TablaSinAtender alertas={revision.resultado.alertas} />
        </div>
      ) : <AvisoResultado estado={revision} />}
    </div>
  );
}
