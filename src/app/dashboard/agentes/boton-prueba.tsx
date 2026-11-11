'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Send } from 'lucide-react';
import { AvisoCompacto, Boton, Icono } from '@/app/ui-v2/componentes';
import './agentes.css';

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
    <div className="rv-ag-prueba">
      <div className="rv-ag-prueba__fila">
        <form action={accion}>
          <BotonMandar apagado={!canalListo} />
        </form>
        <p className="rv-ag-notif__nota">
          Comprueba que estos avisos llegan de verdad: la prueba va solo a tu correo, no al reparto.
        </p>
      </div>
      {estado?.enviado && <AvisoCompacto tono="ok" resumen={estado.enviado} />}
      {estado?.error && <AvisoCompacto tono="error" resumen={estado.error} />}
    </div>
  );
}

function BotonMandar({ apagado }: { apagado: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="secondary" loading={pending} disabled={pending || apagado}
      title={apagado ? 'El correo no está configurado en este entorno' : undefined}
      icono={<Icono icono={Send} tam={14} />}>
      {pending ? 'Mandando…' : 'Mándate una prueba'}
    </Boton>
  );
}
