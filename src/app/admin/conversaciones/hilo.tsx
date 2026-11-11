import Link from 'next/link';
import { destinatarioEnmascarado } from '@/lib/meta/client';
import { Disclosure } from '../../ui-v2/componentes';
import type { ConversacionActiva } from '@/lib/admin/negocio';

type Turno = ConversacionActiva['turns'][number];

/** Burbujas de una conversación de WhatsApp: el chofer a la izquierda, el bot a la derecha. Una sola pieza para el listado,
 *  el detalle y WhatsApp Infra (antes cada pantalla repetía las burbujas con estilos en línea). */
export function HiloMensajes({ turnos }: { turnos: readonly Turno[] }) {
  return (
    <div className="space-y-2">
      {turnos.map((t, i) => (
        <div key={i} className={`flex ${t.role === 'user' ? 'justify-start' : 'justify-end'}`}>
          <div className={`max-w-[80%] whitespace-pre-wrap rounded-xl px-3.5 py-2 text-sm ${t.role === 'user' ? 'border border-[var(--line2)] bg-[var(--canvas)]' : 'bg-[var(--marca)] text-[var(--marca-fg)]'}`}>
            {t.content}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Una conversación plegable: teléfono ENMASCARADO (LFPDPPP), flota y cuántos mensajes; abierta, el hilo. `completo` muestra todos
 *  los turnos y el enlace a su propia página; sin él, los últimos 6. */
export function FilaConversacion({ c, completo = false, textoEnlace }: { c: ConversacionActiva; completo?: boolean; textoEnlace?: string }) {
  return (
    <Disclosure
      titulo={
        <span className="block">
          <span className="block text-sm font-medium">{destinatarioEnmascarado(c.telefono)}</span>
          <span className="block text-xs font-normal text-muted">{c.tenantNombre}</span>
        </span>
      }
      resumen={c.turns.length > 0 ? `${c.turns.length} mensajes` : 'sin mensajes'}
    >
      {c.turns.length > 0 && <HiloMensajes turnos={completo ? c.turns : c.turns.slice(-6)} />}
      {completo && c.tenantId && textoEnlace && (
        <Link href={`/admin/conversaciones/${c.tenantId}/${encodeURIComponent(c.telefono)}`} className="mt-2 inline-block text-xs text-[var(--marca)]">
          {textoEnlace}
        </Link>
      )}
    </Disclosure>
  );
}
