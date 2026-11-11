'use client';

import { History, PanelRightClose, PencilLine, Search } from 'lucide-react';
import { useMemo, useState, type RefObject } from 'react';
import { Drawer } from '../../ui-v2/componentes/overlay';
import { fechaCorta, numero } from '@/lib/formato';
import type { Conversacion } from './use-analista';
import { useT } from '@/lib/i18n/proveedor';
import { resto as restoEs } from '@/lib/i18n/es/resto';
import { rico } from '@/lib/i18n/rico';

/** El `MAX_LISTA` de los dos listados del servidor (lib/likida/chat/conversaciones.ts y lib/agents/copiloto-historial.ts): la pantalla confiesa el tope. */
export const TOPE_CONVERSACIONES = 100;
const GRUPOS = ['hoy', 'ayer', 'semana', 'mes', 'antes'] as const;
type Grupo = (typeof GRUPOS)[number];
const plano = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** A qué grupo cae una conversación según su última actividad (días calendario locales, como Vexa). */
export function grupoDe(iso: string, ahora: number): Grupo {
  const d = new Date(iso);
  const hoy = new Date(ahora); hoy.setHours(0, 0, 0, 0);
  const dia = new Date(d); dia.setHours(0, 0, 0, 0);
  const dif = Math.round((hoy.getTime() - dia.getTime()) / 86_400_000);
  if (dif <= 0) return 'hoy';
  if (dif === 1) return 'ayer';
  if (dif <= 7) return 'semana';
  if (dif <= 30) return 'mes';
  return 'antes';
}

/** El botón «Historial» con el conteo real (se esconde mientras la columna de escritorio está abierta). */
export function BotonHistorial({ convs, expandido, oculto, onClick, boton }: {
  convs: Conversacion[] | 'error' | null; expandido: boolean; oculto: boolean; onClick: () => void; boton: RefObject<HTMLButtonElement | null>;
}) {
  const { t, idioma } = useT('resto', restoEs);
  return (
    <button ref={boton} type="button" className="rv-btn rv-btn--secondary rv-chat__hist-boton" data-oculto={oculto || undefined}
      aria-expanded={expandido} aria-controls="chat-historial" aria-label={t('ch.historial_de_conversaciones')} onClick={onClick}>
      <History aria-hidden="true" />{rico(t('ch.e0_historial_e0'), { e0: (c) => <span>{c}</span> })}{Array.isArray(convs) && <span className="rv-chat__hist-cuenta">{convs.length >= TOPE_CONVERSACIONES ? `${TOPE_CONVERSACIONES}+` : numero(convs.length, idioma)}</span>}
    </button>
  );
}

/** El contenido del historial: nuevo chat, búsqueda y las conversaciones guardadas por día. Se define UNA vez y se monta en un solo sitio. */
function CuerpoHistorial({ convs, activa, errorCarga, onNuevo, onAbrir, onCerrar, escritorio }: {
  convs: Conversacion[] | 'error' | null; activa: string | null; errorCarga: string | null;
  onNuevo: () => void; onAbrir: (id: string) => void; onCerrar: () => void; escritorio: boolean;
}) {
  const { t, idioma } = useT('resto', restoEs);
  const [busqueda, setBusqueda] = useState('');
  // `ahora` se fija al montar el panel (la lista es de la sesión; un Date.now() en el render rompería la pureza).
  const [ahora] = useState(() => Date.now());
  const filtradas = useMemo(
    () => (Array.isArray(convs) ? convs.filter((c) => !busqueda.trim() || plano(c.titulo).includes(plano(busqueda))) : []),
    [convs, busqueda],
  );
  const grupos = useMemo(
    () => GRUPOS.map((g) => [g, filtradas.filter((c) => grupoDe(c.actualizadoEn, ahora) === g)] as const).filter(([, l]) => l.length > 0),
    [filtradas, ahora],
  );
  return (
    <>
      <div className="rv-chat__hist-top">
        <button type="button" onClick={onNuevo} data-autofocus className="rv-btn rv-btn--secondary rv-chat__hist-nuevo">
          <PencilLine aria-hidden="true" />{rico(t('ch.e0_nuevo_chat_e0'), { e0: (c) => <span>{c}</span> })}</button>
        {escritorio && (
          <button type="button" aria-label={t('ch.cerrar_historial')} title={t('ch.cerrar_historial')} onClick={onCerrar} className="rv-btn rv-btn--ghost rv-chat__redondo">
            <PanelRightClose aria-hidden="true" />
          </button>
        )}
      </div>
      <label className="rv-chat__hist-buscar">
        <Search width={14} height={14} strokeWidth={2} aria-hidden="true" />{rico(t('ch.e0_buscar_chats_e0'), { e0: (c) => <span className="rv-sr">{c}</span> })}<input type="search" className="bg-transparent border-0" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder={t('ch.buscar_chats')} aria-label={t('ch.buscar_chats')} data-anillo="envolvente" />
      </label>
      {errorCarga && <p className="rv-chat__hist-error" role="alert">{errorCarga}</p>}
      <div className="rv-chat__hist-lista">
        {convs === null && (
          <div className="rv-chat__hist-carga" aria-hidden="true">
            <div className="skeleton h-4 rounded" /><div className="skeleton h-4 rounded w-4/5" /><div className="skeleton h-4 rounded w-3/5" />
          </div>
        )}
        {convs === 'error' && (
          <p className="rv-chat__hist-ayuda" role="status">{t('ch.no_se_pudo_leer_el_historial_2')}</p>
        )}
        {Array.isArray(convs) && filtradas.length === 0 && (
          <p className="rv-chat__hist-ayuda" role="status">
            {convs.length === 0 ? 'Sin chats recientes.' : `Nada coincide con «${busqueda.trim()}».`}
          </p>
        )}
        {Array.isArray(convs) && convs.length >= TOPE_CONVERSACIONES && (
          <p className="rv-chat__hist-ayuda" role="note">{t('ch.las_mas_recientes_las_anteriores_siguen', { topeConversaciones: TOPE_CONVERSACIONES })}</p>
        )}
        {grupos.map(([grupo, lista]) => (
          <section key={grupo} aria-label={t(`ch.grupo.${grupo}`)} className="rv-chat__hist-grupo">
            <p className="rv-chat__hist-titulo" role="heading" aria-level={3}>{t(`ch.grupo.${grupo}`)}</p>
            <ul>
              {lista.map((c) => (
                <li key={c.id}>
                  <button type="button" className="rv-chat__hist-fila" aria-current={c.id === activa ? 'true' : undefined} title={c.titulo} onClick={() => onAbrir(c.id)}>
                    <span className="rv-chat__hist-nombre">{c.titulo}</span>
                    <span className="rv-chat__hist-fecha">{fechaCorta(c.actualizadoEn, idioma)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

/**
 * El panel Historial. Sobre `lg` es una columna EN FLUJO (hermana del hilo: al abrirse el chat se comprime y se re-centra solo, el
 * ancho anima a 352 px con la curva del producto; cerrada es inerte). Bajo `lg` es un Drawer del motor único de overlays (hoja
 * inferior con grabber, Esc, foco atrapado, scroll lock y retorno de foco al botón «Historial»). Todo con clases: sin `style=`.
 */
export default function PanelHistorial({ movil, abierto, onCerrar, ...cuerpo }: {
  movil: boolean; abierto: boolean; onCerrar: () => void;
  convs: Conversacion[] | 'error' | null; activa: string | null; errorCarga: string | null; onNuevo: () => void; onAbrir: (id: string) => void;
}) {
  const { t } = useT('resto', restoEs);
  if (movil) {
    return (
      <Drawer abierto={abierto} onCerrar={onCerrar} titulo={t('ch.historial')}>
        <div className="rv-historial rv-chat__hist-cuerpo"><CuerpoHistorial {...cuerpo} onCerrar={onCerrar} escritorio={false} /></div>
      </Drawer>
    );
  }
  return (
    <div id="chat-historial" className="rv-chat__hist" data-abierto={abierto} inert={!abierto}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCerrar(); } }}>
      <div className="rv-chat__hist-caja rv-chat__hist-cuerpo"><CuerpoHistorial {...cuerpo} onCerrar={onCerrar} escritorio /></div>
    </div>
  );
}
