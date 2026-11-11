'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { numero } from '@/lib/formato';
import { ETIQUETA_CATEGORIA_COBRO, type CategoriaCobro } from '@/lib/likida/peajes/reglas_cobro';
import { Boton, CampoFecha, CampoSelect, CampoTexto } from '@/app/ui-v2/componentes';
import '../peajes.css';
import { useT } from '@/lib/i18n/proveedor';
import { agentes as agentesEs } from '@/lib/i18n/es/agentes';

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

function BotonRegistrar() {
  const { t: tx } = useT('agentes', agentesEs);
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending}>
      {pending ? 'Registrando…' : tx('rest.registrar_reclamo')}
    </Boton>
  );
}

export function FormaRegistrarReclamo({ accion, desglose, opciones }: {
  accion: Accion;
  desglose: string;
  /** Solo las categorías con candidatos (`conCandidatos` en `revision.tsx`), con su conteo. */
  opciones: ReadonlyArray<{ categoria: CategoriaCobro; n: number }>;
}) {
  const { t: tx } = useT('agentes', agentesEs);
  // El `null` nunca se lee: ver la nota de arriba sobre por qué esta acción no
  // "regresa" un estado útil (siempre redirige).
  const [, despachar] = useActionState(async (_previo: null, fd: FormData) => {
    await accion(fd);
    return null;
  }, null);

  return (
    <form action={despachar} className="rv-pj-forma">
      <input type="hidden" name="desglose" value={desglose} />
      <CampoSelect etiqueta={tx('rest.registrar_reclamo_de')} name="categoria" required>
        {opciones.map(({ categoria, n }) => <option key={categoria} value={categoria}>{ETIQUETA_CATEGORIA_COBRO[categoria]} ({numero(n)})</option>)}
      </CampoSelect>
      <CampoFecha etiqueta={tx('rest.enviado_el_si_ya_lo_enviaste')} name="enviado_en" />
      <CampoTexto etiqueta={tx('rest.folio_del_portal_opc')} name="referencia" maxLength={120} />
      <BotonRegistrar />
    </form>
  );
}
