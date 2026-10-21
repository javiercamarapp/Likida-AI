'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { numero } from '@/lib/formato';
import { ETIQUETA_CATEGORIA_COBRO, type CategoriaCobro } from '@/lib/likida/peajes/reglas_cobro';

// ═══════════════════════════════════════════════════════════════════════════
// «REGISTRAR RECLAMO» — auditoría adversarial, HALLAZGO ALTO #1.
//
// El botón dispara un INSERT real (`crearReclamoDeCategoria`) y el `<form
// action={...}>` plano de antes nunca se deshabilitaba mientras la acción
// corría: un doble clic en una red lenta mandaba DOS POST y podía crear dos
// reclamos gemelos por el mismo dinero. Mismo molde que `operadores/forma.tsx`:
// `useActionState` para envolver la acción y `useFormStatus` en el botón para
// que sepa que sigue en vuelo.
//
// La acción (`acciones.crearReclamo` en `page.tsx`) es un server action PLANO
// (`fd => Promise<void>`): siempre termina en `redirect()` — el aviso de éxito
// o error de esta página ya vive en la URL y lo pinta `vista.tsx` desde
// `extras.aviso`/`extras.error`. Por eso aquí el estado que regresa
// `useActionState` no se usa para nada: se envuelve SOLO para que el botón
// pueda leer `pending` con `useFormStatus`. Cambiar la firma de la acción para
// que "regrese" un estado duplicaría el único sistema de avisos de esta
// pantalla en vez de arreglar el doble envío.
// ═══════════════════════════════════════════════════════════════════════════

type Accion = (fd: FormData) => Promise<void>;

const CSS_BOTON = 'inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-lg transition-opacity hover:opacity-85 disabled:opacity-50';
const ESTILO_PRIMARIO = { background: 'var(--marca)', color: 'var(--marca-fg)' } as const;
const CSS_INPUT = 'hairline text-[12.5px] px-2.5 py-1.5 rounded-lg';
const ESTILO_INPUT = { background: 'var(--surface)', color: 'var(--ink)' } as const;

function Boton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={CSS_BOTON} style={ESTILO_PRIMARIO}>
      {pending ? 'Registrando…' : 'Registrar reclamo'}
    </button>
  );
}

export function FormaRegistrarReclamo({ accion, desglose, opciones }: {
  accion: Accion;
  desglose: string;
  /** Solo las categorías con candidatos (`conCandidatos` en `revision.tsx`), con su conteo. */
  opciones: ReadonlyArray<{ categoria: CategoriaCobro; n: number }>;
}) {
  // El `null` nunca se lee: ver la nota de arriba sobre por qué esta acción no
  // "regresa" un estado útil (siempre redirige).
  const [, despachar] = useActionState(async (_previo: null, fd: FormData) => {
    await accion(fd);
    return null;
  }, null);

  return (
    <form action={despachar} className="flex items-end gap-2 flex-wrap mt-4">
      <input type="hidden" name="desglose" value={desglose} />
      <label className="block"><span className="etiqueta-mono text-[10px] uppercase block" style={{ color: 'var(--faint)' }}>Registrar reclamo de</span>
        <select name="categoria" required className={`${CSS_INPUT} mt-0.5`} style={ESTILO_INPUT}>
          {opciones.map(({ categoria, n }) => <option key={categoria} value={categoria}>{ETIQUETA_CATEGORIA_COBRO[categoria]} ({numero(n)})</option>)}
        </select></label>
      <label className="block"><span className="etiqueta-mono text-[10px] uppercase block" style={{ color: 'var(--faint)' }}>Enviado el (si ya lo enviaste)</span>
        <input type="date" name="enviado_en" className={`${CSS_INPUT} mt-0.5`} style={ESTILO_INPUT} /></label>
      <label className="block"><span className="etiqueta-mono text-[10px] uppercase block" style={{ color: 'var(--faint)' }}>Folio del portal (opc.)</span>
        <input name="referencia" maxLength={120} className={`${CSS_INPUT} w-[150px] mt-0.5`} style={ESTILO_INPUT} /></label>
      <Boton />
    </form>
  );
}
