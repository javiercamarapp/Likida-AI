'use client';

import { useActionState } from 'react';
import { UserCog } from 'lucide-react';
import { Aviso, type ResultadoAccion } from '@/app/admin/ui/forma';
import { ComboCatalogo, type BuscarCatalogo } from '../combo-catalogo';
import { BTN_SECUNDARIO, ESTILO_SECUNDARIO } from './vista';

// ═══════════════════════════════════════════════════════════════════════════
// REASIGNAR CHOFER — con `pending` y con su rechazo en pantalla (FE-11).
//
// Antes: `<form action={accion}>` con un `<button>` pelón y una server action
// que hacía `await reasignarOperador(...)` sin try/catch. Dos modos de falla,
// los dos vistos en el panel:
//   · un chofer dado de baja o un fallo de red lanzaba DENTRO de la action y
//     `error.tsx` se comía la pantalla entera —«No se pudo cargar el panel»—
//     por un cambio de chofer;
//   · sin `pending`, el doble clic en una red lenta mandaba dos reasignaciones.
//
// Ahora el rechazo se dice donde se pidió el cambio y el botón se apaga
// mientras corre. Mismo patrón que `FormaConAviso`; se escribe aparte porque
// aquí el control y el botón van EN LÍNEA en el encabezado, no en un grid.
// ═══════════════════════════════════════════════════════════════════════════

export function FormaReasignar({ accion, buscar, actual, actualNombre, total }: {
  accion: (previo: ResultadoAccion, fd: FormData) => Promise<ResultadoAccion>;
  buscar: BuscarCatalogo;
  actual: string;
  actualNombre: string;
  /** Cuántos choferes activos hay; `null` = no se pudo contar. */
  total: number | null;
}) {
  const [resultado, enviar, pendiente] = useActionState<ResultadoAccion, FormData>(accion, null);
  return (
    <div className="flex flex-col gap-1.5 items-start">
      <form action={enviar} className="flex items-start gap-2">
        <label htmlFor="operadorId" className="sr-only">Chofer</label>
        <ComboCatalogo tipo="operador" name="operadorId" campoId="operadorId"
          buscar={buscar} aria-label="Chofer"
          etiquetaVacia="Escribe el nombre del chofer…"
          valorInicial={actual} textoInicial={actualNombre}
          total={total}
          className="h-8 text-[12.5px] px-2.5 rounded-lg hairline min-w-0 max-w-[220px]"
          estilo={{ background: 'var(--surface)' }} />
        <button type="submit" disabled={pendiente} className={`${BTN_SECUNDARIO} disabled:opacity-60 disabled:cursor-not-allowed`}
          style={ESTILO_SECUNDARIO}>
          <UserCog width={13} height={13} strokeWidth={1.75} aria-hidden />
          {pendiente ? 'Reasignando…' : 'Reasignar chofer'}
        </button>
      </form>
      <Aviso estado={resultado} />
    </div>
  );
}
