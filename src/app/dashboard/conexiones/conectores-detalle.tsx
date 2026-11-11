'use client';

import { useState } from 'react';
import { Mail, FileText, ShieldCheck, Globe, MapPin, Stamp, type LucideIcon } from 'lucide-react';
import type { Conector } from '@/lib/likida/conexiones';
import { EstadoVacio, Icono, InfoTip, MarcaIntegracion, SegmentedControl, StatusChip } from '@/app/ui-v2/componentes';
import { useT } from '@/lib/i18n/proveedor';
import { resto as restoEs } from '@/lib/i18n/es/resto';
import { estadoConector } from './estado-conector';
import '../estados.css';
import './conexiones.css';

// ═══════════════════════════════════════════════════════════════════════════
// «ESTADO DE LAS CONEXIONES» como maestro-detalle (Rovaq `/connections`): segmentado Todas / Conectadas / Pendientes, a la izquierda las
// conexiones como tarjetas-pestaña de 60 px y a la derecha el detalle de la elegida con pares clave-valor. Cada dato es el medido por la
// lectura del conector; nada se inventa y «no se pudo medir» conserva su rótulo propio (c7-28).
// ═══════════════════════════════════════════════════════════════════════════

/** Logo de marca SOLO donde hay trazado verificable (WhatsApp); el resto lleva un icono sobrio del tema de la conexión. */
const ICONO: Record<Conector['id'], { marca: 'whatsapp' } | { icono: LucideIcon }> = {
  whatsapp: { marca: 'whatsapp' },
  correo: { icono: Mail },
  fiscal: { icono: FileText },
  sat: { icono: ShieldCheck },
  portales: { icono: Globe },
  rastreo: { icono: MapPin },
  timbrado: { icono: Stamp },
};

function Marca({ id }: { id: Conector['id'] }) {
  const m = ICONO[id];
  if ('marca' in m) return <MarcaIntegracion id={m.marca} tam={18} />;
  return <Icono icono={m.icono} tam={18} />;
}

type Grupo = 'todas' | 'conectadas' | 'pendientes';

export function ConectoresDetalle({ conectores }: { conectores: Conector[] }) {
  const { t } = useT('resto', restoEs);
  const [grupo, setGrupo] = useState<Grupo>('todas');
  const [elegido, setElegido] = useState<Conector['id'] | null>(null);
  const rotulos = estadoConector(t);
  const visibles = conectores.filter((c) => grupo === 'todas' ? true : grupo === 'conectadas' ? c.estado === 'listo' : c.estado !== 'listo');
  const actual = visibles.find((c) => c.id === elegido) ?? visibles[0] ?? null;
  const nListas = conectores.filter((c) => c.estado === 'listo').length;
  return (
    <div className="rv-cx__md">
      <SegmentedControl<Grupo> etiqueta={t('cfg.filtrar_conexiones')} tamano="sm" valor={grupo} onChange={setGrupo}
        opciones={[
          { valor: 'todas', etiqueta: t('cfg.todas'), conteo: conectores.length },
          { valor: 'conectadas', etiqueta: t('cfg.conectadas'), conteo: nListas },
          { valor: 'pendientes', etiqueta: t('cfg.pendientes'), conteo: conectores.length - nListas },
        ]} />
      {actual === null ? (
        <EstadoVacio titulo={t('cfg.sin_conexiones_en_el_grupo')}>{t('cfg.cambia_el_filtro')}</EstadoVacio>
      ) : (
        <div className="rv-cx__md-cuerpo">
          <ul className="rv-cx__tabs" aria-label={t('cfg.estado_de_las_conexiones')}>
            {visibles.map((c) => (
              <li key={c.id}>
                <button type="button" className="rv-cx__tab" data-activo={c.id === actual.id || undefined} aria-pressed={c.id === actual.id}
                  onClick={() => setElegido(c.id)}>
                  <span className="rv-cx__marca"><Marca id={c.id} /></span>
                  <span className="rv-cx__tab-texto">
                    <span className="rv-cx__tab-nombre">{c.nombre}</span>
                    <span className="rv-cx__tab-sub" title={c.detalle}>{c.detalle}</span>
                  </span>
                  <StatusChip tono={rotulos[c.estado].tono}>{rotulos[c.estado].rotulo}</StatusChip>
                </button>
              </li>
            ))}
          </ul>
          <section className="rv-cx__panel" aria-live="polite" aria-label={actual.nombre}>
            <p className="rv-cx__panel-titulo"><span className="rv-cx__marca"><Marca id={actual.id} /></span>{actual.nombre}<InfoTip clave="conexiones.conector" /></p>
            <dl className="rv-cx__pares">
              <div><dt>{t('cfg.det.estado')}</dt><dd><StatusChip tono={rotulos[actual.estado].tono}>{rotulos[actual.estado].rotulo}</StatusChip></dd></div>
              <div><dt>{t('cfg.det.detalle')}</dt><dd>{actual.detalle}</dd></div>
              <div><dt>{t('cfg.det.falta')}</dt>
                <dd>{actual.falta.length === 0 ? t('cfg.det.nada') : (
                  <ul className="rv-cx__faltas">{actual.falta.map((f) => <li key={f} className="rv-cx__falta">{f}</li>)}</ul>
                )}</dd></div>
            </dl>
          </section>
        </div>
      )}
      <p className="rv-cx__solo-lectura">{t('cfg.solo_lectura_estado_medido')}</p>
    </div>
  );
}
