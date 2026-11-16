import Link from 'next/link';
import { destinatarioEnmascarado } from '@/lib/meta/client';
import { Disclosure } from '../../ui-v2/componentes';
import type { ConversacionActiva } from '@/lib/admin/negocio';
import { admin_agentes as dicEs } from '@/lib/i18n/es/admin_agentes';
import './conversaciones.css';

type Turno = ConversacionActiva['turns'][number];

/** Los dos textos de la fila. Las pantallas que ya tienen su traductor los pasan; las demás (WhatsApp Infra) caen al diccionario es. */
export interface TextosFilaConversacion { nMensajes: string; sinMensajes: string }
const TEXTOS_ES: TextosFilaConversacion = { nMensajes: dicEs['conversaciones_pagina.n_mensajes'], sinMensajes: dicEs['conversaciones_pagina.sin_mensajes'] };

/** Burbujas de una conversación de WhatsApp: el chofer a la izquierda, el bot a la derecha. Una sola pieza para el listado,
 *  el detalle y WhatsApp Infra. */
export function HiloMensajes({ turnos }: { turnos: readonly Turno[] }) {
  return (
    <div className="rv-conv-hilo">
      {turnos.map((t, i) => (
        <div key={i} className="rv-conv-fila" data-rol={t.role}>
          <div className="rv-conv-burbuja" data-rol={t.role}>{t.content}</div>
        </div>
      ))}
    </div>
  );
}

/** Una conversación plegable: teléfono ENMASCARADO (LFPDPPP), flota y cuántos mensajes; abierta, el hilo. `completo` muestra todos
 *  los turnos y el enlace a su propia página; sin él, los últimos 6. */
export function FilaConversacion({ c, completo = false, textoEnlace, textos = TEXTOS_ES }: { c: ConversacionActiva; completo?: boolean; textoEnlace?: string; textos?: TextosFilaConversacion }) {
  return (
    <Disclosure
      titulo={
        <span className="rv-conv-cab">
          <span className="rv-conv-tel">{destinatarioEnmascarado(c.telefono)}</span>
          <span className="rv-conv-flota">{c.tenantNombre}</span>
        </span>
      }
      resumen={c.turns.length > 0 ? textos.nMensajes.replace('{n}', String(c.turns.length)) : textos.sinMensajes}
    >
      {c.turns.length > 0 && <HiloMensajes turnos={completo ? c.turns : c.turns.slice(-6)} />}
      {completo && c.tenantId && textoEnlace && (
        <Link href={`/admin/conversaciones/${c.tenantId}/${encodeURIComponent(c.telefono)}`} className="rv-conv-abrir">
          {textoEnlace}
        </Link>
      )}
    </Disclosure>
  );
}
