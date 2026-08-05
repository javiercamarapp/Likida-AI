'use client';

import { useActionState } from 'react';
import { Check, CircleAlert } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// EL BOTÓN GRANDE — el único de esta sección, y por eso es el más grande.
//
// Aceptar el viaje es lo que arranca el reloj de la 0058: sin `aceptado_en`,
// a las 5 h la escalación le avisa al jefe que el chofer no contestó. Hoy eso
// solo se puede hacer respondiendo por WhatsApp; aquí es un botón.
//
// 56 px de alto y ancho completo: es la medida a la que un pulgar acierta sin
// mirar, con el teléfono en una mano y en movimiento. El resto de la sección
// no baja de 44, pero la acción principal se lleva la diferencia.
//
// SE DESHABILITA MIENTRAS CORRE. No es cosmético: en una red de carretera el
// doble toque es la norma, y el segundo envío llegaría a reescribir la hora de
// aceptación — la que mide cuánto tardó en contestar. `aceptarViaje` ya lo
// impide en la base (`.is('aceptado_en', null)`); esto lo impide antes.
//
// El aviso se pinta SIN cambiar de página (`useActionState`) porque el
// resultado tiene tres desenlaces distintos —aceptado, ya estaba, no se pudo—
// y un redirect los aplanaría todos a "recarga y adivina".
// ═══════════════════════════════════════════════════════════════════════════

export type EstadoAceptar = { ok: string } | { error: string } | null;

export default function BotonAceptar({
  accion,
}: {
  accion: (previo: EstadoAceptar, datos: FormData) => Promise<EstadoAceptar>;
}) {
  const [estado, enviar, pendiente] = useActionState<EstadoAceptar, FormData>(accion, null);

  return (
    <form action={enviar} className="flex flex-col gap-3">
      {/* El contenedor existe SIEMPRE, aunque esté vacío: un `aria-live` que
          aparece junto con su texto no se anuncia, y como aquí no hay
          navegación, sin esto un usuario con lector de pantalla no se entera
          de que su viaje quedó aceptado. Mismo criterio que `admin/ui/forma`. */}
      <div aria-live="polite">
        {estado && (
          <div
            className="flex items-start gap-2.5 text-base rounded-xl px-4 py-3"
            style={{
              background: 'error' in estado ? 'var(--badbg)' : 'var(--okbg)',
              color: 'error' in estado ? 'var(--bad)' : 'var(--ok)',
            }}
          >
            {/* Nunca color solo: el ícono y el texto dicen lo mismo que el matiz. */}
            {'error' in estado
              ? <CircleAlert width={20} height={20} strokeWidth={2} className="shrink-0 mt-0.5" />
              : <Check width={20} height={20} strokeWidth={2} className="shrink-0 mt-0.5" />}
            <span>{'error' in estado ? estado.error : estado.ok}</span>
          </div>
        )}
      </div>

      <button
        type="submit"
        disabled={pendiente}
        className="w-full rounded-2xl text-lg font-semibold disabled:opacity-60"
        style={{ minHeight: 56, background: 'var(--marca)', color: 'var(--marca-fg)' }}
      >
        {pendiente ? 'Registrando…' : 'Acepto este viaje'}
      </button>

      <p className="text-sm text-center" style={{ color: 'var(--muted)' }}>
        Tu oficina ve que ya lo aceptaste y deja de insistirte.
      </p>
    </form>
  );
}
