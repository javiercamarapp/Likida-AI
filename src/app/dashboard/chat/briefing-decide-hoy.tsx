'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
// Imports directos y no el barril de ui-v2: el barril arrastra `BotonReintentar` (next/navigation) al paquete del chat.
import { StatusChip } from '../../ui-v2/componentes/status-chip';
import { Boton } from '../../ui-v2/componentes/boton';
import { Icono } from '../../ui-v2/componentes/icono';
import { MessageCircleQuestion } from 'lucide-react';
import { useT } from '@/lib/i18n/proveedor';
import { resto as restoEs } from '@/lib/i18n/es/resto';
import { type TResto, T_RESTO_ES } from '@/lib/i18n/resto_tr';
import { rico } from '@/lib/i18n/rico';

// ═══════════════════════════════════════════════════════════════════════════
// «DECIDE HOY» en la portada del Copiloto (F5, mejora 3). Lee /api/admin/copiloto/briefing (lectores reales, cada fuente por
// separado) y pinta una tarjeta por decisión: qué pasa, qué se propone y dónde se toma. No ejecuta nada: «Preguntar» solo le hace la
// pregunta al Copiloto. Una fuente caída se dice; jamás «sin pendientes» sobre una lectura que falló. También ofrece preguntar
// sobre la pantalla que Javier tiene abierta (el contexto de pantalla viaja en cada pregunta).
// ═══════════════════════════════════════════════════════════════════════════

interface Tarjeta {
  id: string;
  severidad: 'alta' | 'media' | 'info';
  titulo: string;
  detalle: string;
  decision: string;
  href: string | null;
  pregunta: string;
}
interface Briefing { tarjetas: Tarjeta[]; fuentesCiegas: string[] }

const TONO = { alta: 'bad', media: 'warn', info: 'ok' } as const;
const rotulo = (t: TResto = T_RESTO_ES) => ({ alta: t('op.urgente'), media: t('ch.pendiente'), info: t('ch.al_dia') } as const);

export default function BriefingDecideHoy({ onPreguntar, deshabilitado, endpoint = '/api/admin/copiloto' }: {
  onPreguntar: (q: string) => void;
  deshabilitado: boolean;
  endpoint?: string;
}) {
  const { t } = useT('resto', restoEs);
  const [b, setB] = useState<Briefing | 'error' | null>(null);
  const [intento, setIntento] = useState(0);
  useEffect(() => {
    let vivo = true;
    fetch(`${endpoint}/briefing`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (vivo) setB(Array.isArray(d?.tarjetas) ? { tarjetas: d.tarjetas, fuentesCiegas: Array.isArray(d.fuentesCiegas) ? d.fuentesCiegas : [] } : 'error'); })
      .catch(() => { if (vivo) setB('error'); });
    return () => { vivo = false; };
  }, [endpoint, intento]);
  const cargar = () => { setB(null); setIntento((i) => i + 1); };

  return (
    <section className="rv-chat__briefing" aria-label={t('ch.decide_hoy')} aria-busy={b === null || undefined}>
      {/* sin-info: portada del Copiloto, no es una cifra del dashboard del cliente */}
      <h2 className="rv-chat__briefing-titulo">{t('ch.decide_hoy')}</h2>
      {b === null && <p className="rv-chat__nota">{t('ch.leyendo_lo_que_espera_tu_decision')}</p>}
      {b === 'error' && (
        <p className="rv-chat__nota" role="alert">{t('ch.no_disponible_ahora_no_es_cero')}{' '}<button type="button" className="rv-btn rv-btn--ghost rv-btn--sm" onClick={cargar}>{t('cfg.reintentar')}</button>
        </p>
      )}
      {b !== null && b !== 'error' && (
        <>
          <ul className="rv-chat__briefing-lista">
            {b.tarjetas.map((tarjeta) => (
              <li key={tarjeta.id} className="rv-tarjeta rv-chat__briefing-tarjeta" data-severidad={tarjeta.severidad}>
                <div className="rv-chat__briefing-cab">
                  <StatusChip tono={TONO[tarjeta.severidad]}>{rotulo(t)[tarjeta.severidad]}</StatusChip>
                  <strong>{tarjeta.titulo}</strong>
                </div>
                <p className="rv-chat__nota">{tarjeta.detalle}</p>
                {tarjeta.severidad !== 'info' && <p className="rv-chat__nota">{rico(t('ch.b_propuesta_b'), { b: (c) => <b>{c}</b> })}{' '}{tarjeta.decision}</p>}
                <div className="rv-chat__briefing-acciones">
                  {tarjeta.href && <Link href={tarjeta.href} className="rv-btn rv-btn--secondary rv-btn--sm">{t('ch.abrir_pantalla')}</Link>}
                  <Boton tamano="sm" variante="ghost" disabled={deshabilitado} onClick={() => onPreguntar(tarjeta.pregunta)} icono={<Icono icono={MessageCircleQuestion} />}>{t('ch.preguntar')}</Boton>
                </div>
              </li>
            ))}
          </ul>
          {b.fuentesCiegas.length > 0 && (
            <p className="rv-chat__nota" role="status">{t('ch.no_se_pudo_leer_de_esas', { b: b.fuentesCiegas.join(', ') })}</p>
          )}
        </>
      )}
      <div className="rv-chat__briefing-acciones">
        <Boton tamano="sm" variante="secondary" disabled={deshabilitado} onClick={() => onPreguntar(t('ch.que_debo_mirar_en_la_pantalla'))}>{t('ch.preguntar_sobre_esta_pantalla')}</Boton>
      </div>
    </section>
  );
}
