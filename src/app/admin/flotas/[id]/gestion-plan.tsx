'use client';

import { useActionState } from 'react';
import { CampoSelect } from '../../../ui-v2/componentes/campos';
import { BotonConfirmar } from '../../../ui-v2/componentes/confirmar';
import { Boton, clasesBoton } from '../../../ui-v2/componentes/boton';
import { FormaConAviso, Aviso, type AccionDeForma, type ResultadoAccion } from '../../ui/forma';

/**
 * Asignar / cambiar / activar / pausar / cancelar el plan de ESTA flota (sección «Plan y cobro» de la ficha). Presentacional: la acción de
 * servidor (`accionGestionarPlan`, con su puerta, su segundo factor y su bitácora) llega por prop. Nada de aquí llama a Stripe: crea o mueve
 * la suscripción local que `emitirMensualidad` sabe cobrar por transferencia. Si el plan no tiene price ligado, la acción lo dice y no escribe.
 *
 * Activar y pausar son botones secundarios en UNA fila; «Cancelar suscripción» es el único destructivo: botón de peligro con diálogo que dice
 * el alcance (Rovaq: las acciones destructivas van en peligro, nunca como primario).
 */
export function GestionPlan({ tenantId, planes, accion }: {
  tenantId: string;
  /** `null` = no se pudieron leer los planes: se dice, no se ofrece un selector vacío como si no hubiera. */
  planes: Array<{ clave: string; nombre: string }> | null;
  accion: AccionDeForma;
}) {
  const [estado, enviar, pendiente] = useActionState<ResultadoAccion, FormData>(accion, null);
  const oculto = (op: string) => (
    <>
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="operacion" value={op} />
    </>
  );

  return (
    <div className="adm-plan">
      {planes === null ? (
        <p>No se pudieron leer los planes ahora mismo. Reintenta.</p>
      ) : (
        <FormaConAviso accion={accion} boton="Asignar o cambiar plan" columnas="md:grid-cols-1">
          {oculto('asignar')}
          <CampoSelect etiqueta="Plan" name="planClave" required defaultValue=""
            ayuda="Empieza en «prueba»: no cuenta para el MRR hasta que lo actives. Solo se asignan planes con price de Stripe ligado.">
            <option value="" disabled>Elige un plan</option>
            {planes.map((p) => <option key={p.clave} value={p.clave}>{p.nombre}</option>)}
          </CampoSelect>
        </FormaConAviso>
      )}
      <div className="adm-plan__fila">
        <form action={enviar}>
          {oculto('activar')}
          <Boton type="submit" variante="secondary" tamano="sm" disabled={pendiente}>Activar</Boton>
        </form>
        <form action={enviar}>
          {oculto('pausar')}
          <Boton type="submit" variante="secondary" tamano="sm" disabled={pendiente}>Pausar</Boton>
        </form>
        <form action={enviar}>
          {oculto('cancelar')}
          <BotonConfirmar
            etiqueta="Cancelar suscripción" deshabilitado={pendiente} tono="peligro" className={clasesBoton('danger', 'sm')}
            titulo="Cancelar la suscripción de esta flota"
            descripcion="La suscripción queda cancelada y la flota vuelve al plan de demostración. No se borra su historial de cobro. Para volver a cobrarle habrá que asignarle un plan de nuevo."
            etiquetaConfirmar="Sí, cancelar"
          />
        </form>
      </div>
      <Aviso estado={estado} />
    </div>
  );
}
