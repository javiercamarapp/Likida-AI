'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { SegmentedControl } from '@/app/ui-v2/componentes';
import { useT } from '@/lib/i18n/proveedor';
import { resto as restoEs } from '@/lib/i18n/es/resto';
import './conexiones.css';

/**
 * «Configurar sincronización» (Rovaq `/connections`): UNA zona de configuración con un segmentado, en vez de apilar siete tarjetas bajo
 * el maestro-detalle. Cada sección ya viene armada del servidor y se queda montada (solo se oculta con `hidden`), así lo que la persona
 * esté escribiendo en un formulario no se pierde al cambiar de pestaña. El ancla `#gps` (la usa el Mapa) abre la sección de GPS.
 */
export type IdSeccionConfig = 'estado' | 'sistemas' | 'gps' | 'credenciales';

export function ConfigurarSincronizacion({ secciones }: { secciones: ReadonlyArray<{ id: IdSeccionConfig; nodo: ReactNode }> }) {
  const { t } = useT('resto', restoEs);
  const presentes = secciones.filter((s) => s.nodo !== undefined && s.nodo !== null && s.nodo !== false);
  const [activa, setActiva] = useState<IdSeccionConfig>(presentes[0]?.id ?? 'estado');
  useEffect(() => {
    const h = window.location.hash.replace('#', '') as IdSeccionConfig;
    if (presentes.some((s) => s.id === h)) setActiva(h);
    // Solo al montar: el ancla de la URL decide la sección inicial.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (presentes.length === 0) return null;
  const rotulo: Record<IdSeccionConfig, string> = {
    estado: t('cfg.sec.fuentes'), sistemas: t('cfg.sec.sistemas'), gps: t('cfg.sec.gps'), credenciales: t('cfg.sec.credenciales'),
  };
  return (
    <section className="rv-cx__config" aria-label={t('cfg.configurar_sincronizacion')}>
      <div className="rv-cx__config-cab">
        <h2 className="rv-cx__config-titulo">{t('cfg.configurar_sincronizacion')}</h2>
        <SegmentedControl<IdSeccionConfig> etiqueta={t('cfg.configurar_sincronizacion')} tamano="sm" valor={activa} onChange={setActiva}
          opciones={presentes.map((s) => ({ valor: s.id, etiqueta: rotulo[s.id] }))} />
      </div>
      {presentes.map((s) => (
        <div key={s.id} className="rv-cx__config-panel" hidden={s.id !== activa} data-tour={s.id === 'credenciales' ? 'conexiones.credenciales' : undefined}>{s.nodo}</div>
      ))}
    </section>
  );
}
