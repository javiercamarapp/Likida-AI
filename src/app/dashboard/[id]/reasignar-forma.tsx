'use client';

import { useActionState } from 'react';
import { UserCog } from 'lucide-react';
import { AvisoResultado, Boton, Icono, type ResultadoAccion } from '@/app/ui-v2/componentes';
import { useT } from '@/lib/i18n/proveedor';
import { dinero } from '@/lib/i18n/es/dinero';
import { ComboCatalogo, type BuscarCatalogo } from '../combo-catalogo';
import './liquidacion.css';

// ═══════════════════════════════════════════════════════════════════════════
// REASIGNAR CHOFER — con `pending` y con su rechazo en pantalla (FE-11).
//
// Antes: `<form action={accion}>` con un botón pelón y una server action
// que hacía `await reasignarOperador(...)` sin try/catch. Dos modos de falla,
// los dos vistos en el panel:
//   · un chofer dado de baja o un fallo de red lanzaba DENTRO de la action y
//     `error.tsx` se comía la pantalla entera —«No se pudo cargar el panel»—
//     por un cambio de chofer;
//   · sin `pending`, el doble clic en una red lenta mandaba dos reasignaciones.
//
// Ahora el rechazo se dice donde se pidió el cambio y el botón se apaga
// mientras corre. Mismo patrón que `FormaConAviso`; se escribe aparte porque
// aquí el control y el botón van EN LÍNEA en la tarjeta, no en un grid.
// ═══════════════════════════════════════════════════════════════════════════

export function FormaReasignar({ accion, buscar, actual, actualNombre, total }: {
  accion: (previo: ResultadoAccion, fd: FormData) => Promise<ResultadoAccion>;
  buscar: BuscarCatalogo;
  actual: string;
  actualNombre: string;
  /** Cuántos choferes activos hay; `null` = no se pudo contar. */
  total: number | null;
}) {
  const { t: tr } = useT('dinero', dinero);
  const [resultado, enviar, pendiente] = useActionState<ResultadoAccion, FormData>(accion, null);
  return (
    <>
      <form action={enviar} className="rv-liq__reasignar-forma">
        <label htmlFor="operadorId" className="sr-only">{tr('liquidacion.reasignar.chofer')}</label>
        <ComboCatalogo tipo="operador" name="operadorId" campoId="operadorId"
          buscar={buscar} aria-label={tr('liquidacion.reasignar.chofer')}
          etiquetaVacia={tr('liquidacion.reasignar.escribe')}
          valorInicial={actual} textoInicial={actualNombre}
          total={total}
          className="rv-ctl" />
        <Boton type="submit" variante="secondary" loading={pendiente} icono={<Icono icono={UserCog} />}>
          {pendiente ? tr('liquidacion.reasignar.reasignando') : tr('liquidacion.reasignar.boton')}
        </Boton>
      </form>
      <div aria-live="polite"><AvisoResultado estado={resultado} /></div>
    </>
  );
}
