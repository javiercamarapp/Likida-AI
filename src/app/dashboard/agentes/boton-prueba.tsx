'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Send } from 'lucide-react';
import { AvisoCompacto, Boton, Icono, Tooltip } from '@/app/ui-v2/componentes';
import './agentes.css';
import { useT } from '@/lib/i18n/proveedor';
import { resto as restoEs } from '@/lib/i18n/es/resto';

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
  const { t } = useT('resto', restoEs);
  const [estado, accion] = useActionState(mandarPrueba, null);

  return (
    <div className="rv-ag-prueba">
      <div className="rv-ag-prueba__fila">
        <form action={accion}>
          <BotonMandar apagado={!canalListo} />
        </form>
        <p className="rv-ag-notif__nota">{t('ch.comprueba_que_estos_avisos_llegan_de')}</p>
      </div>
      {estado?.enviado && <AvisoCompacto tono="ok" resumen={estado.enviado} />}
      {estado?.error && <AvisoCompacto tono="error" resumen={estado.error} />}
    </div>
  );
}

function BotonMandar({ apagado }: { apagado: boolean }) {
  const { t } = useT('resto', restoEs);
  const { pending } = useFormStatus();
  // Disponible: secundario blanco con borde (Rovaq). No disponible de verdad: «No disponible ahora» punteado, que se lee como lo que es
  // y no como un secundario gris que parece apagado sin estarlo.
  const boton = apagado ? (
    <Boton type="submit" variante="secondary" tamano="sm" disabled className="rv-ag-no-disponible">
      {t('f26d2.boton.no_disponible')}
    </Boton>
  ) : (
    <Boton type="submit" variante="secondary" tamano="sm" loading={pending} disabled={pending}
      icono={<Icono icono={Send} tam={14} />}>
      {pending ? 'Mandando…' : t('ch.mandate_una_prueba')}
    </Boton>
  );
  return apagado ? <Tooltip texto={t('ch.el_correo_no_esta_configurado_en')}>{boton}</Tooltip> : boton;
}
