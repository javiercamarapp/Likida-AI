'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Send } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// EL BOTÓN «MÁNDATE UNA PRUEBA» (auditoría 4, B5).
//
// Cierra la pregunta que la pestaña dejaba abierta: todo lo de arriba dice a
// quién LE LLEGARÍA un aviso, pero nada probaba que un correo aterrice de
// verdad en una bandeja — hasta hoy la única prueba era esperar a que algo se
// rompiera. La prueba va SOLO a quien aprieta el botón (a su propio correo de
// `app_user`), nunca al reparto: la pregunta que contesta es «¿me llega a
// MÍ?», y un botón que le manda correos de mentira a todo el equipo entrena a
// ignorar los reales.
//
// Sin confirmación en dos pasos a propósito, a diferencia del «Ejecutar
// ahora» de Cobranza/Peajes: aquéllos escriben conciliaciones o mandan
// WhatsApp a terceros; esto manda UN correo inofensivo al propio usuario, y
// el freno de una por minuto ya vive en la action.
// ═══════════════════════════════════════════════════════════════════════════

export type EstadoPrueba = { enviado?: string; error?: string } | null;
export type AccionPrueba = (prev: EstadoPrueba, fd: FormData) => Promise<EstadoPrueba>;

export function BotonPrueba({ mandarPrueba, canalListo }: {
  mandarPrueba: AccionPrueba;
  /** `correoConfigurado()`. Apagado, el botón se deshabilita y lo dice —
   *  mismo criterio que el Guardar de la forma: no ofrecer lo que no hace
   *  nada. El acuse cubre igual el caso (el render puede quedar viejo). */
  canalListo: boolean;
}) {
  const [estado, accion] = useActionState(mandarPrueba, null);

  return (
    <div className="mt-4 pt-3.5 border-t" style={{ borderColor: 'var(--line)' }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <form action={accion} className="shrink-0">
          <BotonMandar apagado={!canalListo} />
        </form>
        <p className="text-[11.5px]" style={{ color: 'var(--faint)' }}>
          Comprueba que estos avisos llegan de verdad: la prueba va solo a tu correo, no al reparto.
        </p>
      </div>
      {estado?.enviado && (
        <p className="text-[12px] mt-1.5" style={{ color: 'var(--muted)' }}>{estado.enviado}</p>
      )}
      {estado?.error && (
        <p className="text-[12px] mt-1.5" style={{ color: 'var(--bad)' }}>{estado.error}</p>
      )}
    </div>
  );
}

function BotonMandar({ apagado }: { apagado: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit" disabled={pending || apagado}
      title={apagado ? 'El correo no está configurado en este entorno' : undefined}
      className="inline-flex items-center gap-1.5 hairline text-[12.5px] font-medium px-3 py-1.5 rounded-lg transition-colors hover:bg-[var(--canvas)] disabled:opacity-40"
      style={{ background: 'var(--surface)', color: 'var(--ink)' }}>
      <Send width={13} height={13} strokeWidth={2} />
      {pending ? 'Mandando…' : 'Mándate una prueba'}
    </button>
  );
}
