// ═══════════════════════════════════════════════════════════════════════════
// LA CALCULADORA DE RECUPERACIÓN FISCAL — página pública (A2, lead magnet).
//
// El resultado se enseña ANTES de pedir el contacto (regla anti-abandono del
// blueprint); el contacto es opcional y va a `prospecto` con fuente
// 'landing'. El motor es puro y corre en el navegador — aquí no hay ningún
// dato de nadie hasta que el visitante decide dejarlo.
// ═══════════════════════════════════════════════════════════════════════════
import type { Metadata } from 'next';
import { Calculadora } from './calc';
import { PulsoSitio } from './pulso';
import { MarcoPublico } from '../ui-v2/componentes/marco-publico';
import { trPublico } from '@/lib/i18n/publico_tr';
import '../legal/publico-r2.css';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await trPublico();
  return { title: t('cal.meta.titulo'), description: t('cal.meta.descripcion') };
}

export default async function PaginaCalculadora() {
  const { t } = await trPublico();
  return (
    <MarcoPublico
      rotulo={t('cal.rotulo')}
      titulo={t('cal.titulo')}
      apoyo={t('cal.apoyo')}
    >
      <PulsoSitio pagina="calculadora" />
      <div className="rv-pub__prosa">
        <Calculadora />
      </div>
    </MarcoPublico>
  );
}
