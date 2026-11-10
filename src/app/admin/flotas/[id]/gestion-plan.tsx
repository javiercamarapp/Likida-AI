import { FormaConAviso, Selector, type AccionDeForma } from '../../ui/forma';

/**
 * Asignar / cambiar / activar / pausar / cancelar el plan de ESTA flota. Presentacional: la acción de servidor (`accionGestionarPlan`,
 * con su puerta, su segundo factor y su bitácora) llega por prop. Nada de aquí llama a Stripe: crea o mueve la suscripción local que
 * `emitirMensualidad` sabe cobrar por transferencia. Si el plan no tiene price ligado, la acción lo dice y no escribe.
 */
export function GestionPlan({ tenantId, planes, accion }: {
  tenantId: string;
  /** `null` = no se pudieron leer los planes: se dice, no se ofrece un selector vacío como si no hubiera. */
  planes: Array<{ clave: string; nombre: string }> | null;
  accion: AccionDeForma;
}) {
  const operacion = (op: string, boton: string, confirmar?: { titulo: string; descripcion: string; etiquetaConfirmar: string }) => (
    <FormaConAviso accion={accion} boton={boton} enLinea={!confirmar} columnas="md:grid-cols-1" confirmar={confirmar}>
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="operacion" value={op} />
    </FormaConAviso>
  );

  return (
    <div className="mt-3 pt-3 border-t space-y-2" style={{ borderColor: 'var(--line2)' }}>
      <div className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>Plan de esta flota</div>
      {planes === null ? (
        <p className="m-0 text-[12.5px]" style={{ color: 'var(--muted)' }}>No se pudieron leer los planes ahora mismo — reintenta.</p>
      ) : (
        <FormaConAviso accion={accion} boton="Asignar / cambiar plan" columnas="md:grid-cols-1">
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="operacion" value="asignar" />
          <Selector
            nombre="planClave" etiqueta="Plan" requerido
            opciones={planes.map((p) => ({ valor: p.clave, texto: p.nombre }))}
            ayuda="Empieza en «prueba»: no cuenta para el MRR hasta que lo actives. Solo se asignan planes con price de Stripe ligado."
          />
        </FormaConAviso>
      )}
      <div className="flex flex-wrap gap-2">
        {operacion('activar', 'Activar')}
        {operacion('pausar', 'Pausar')}
        {operacion('cancelar', 'Cancelar suscripción', {
          titulo: 'Cancelar la suscripción de esta flota',
          descripcion: 'La suscripción queda cancelada y la flota vuelve al plan de demostración. No se borra su historial de cobro. Para volver a cobrarle habrá que asignarle un plan de nuevo.',
          etiquetaConfirmar: 'Sí, cancelar',
        })}
      </div>
    </div>
  );
}
