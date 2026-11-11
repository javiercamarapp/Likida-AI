// ═══════════════════════════════════════════════════════════════════════════
// EL BLOG — índice público (A2: plataforma de marketing).
//
// PÚBLICO Y ESTÁTICO: sin sesión, sin datos de nadie. El contenido vive
// tipado en `marketing/articulos.ts` (ver ahí el enganche con la cola de
// aprobación: publicar sigue siendo un PR con el tap de Javier).
//
// La raíz de app.likida.ai es una puerta (page.tsx), no una landing: estas
// rutas de marketing viven aquí y no en el sitio estático porque citan el
// corpus fiscal del producto y capturan a `prospecto` — lo que en el sitio
// estático derivaría en dos verdades. El sitio estático LIGA aquí.
//
// PALETA: tokens de la casa (mismo criterio que legal/marco.tsx) — páginas
// sin sesión que aun así se ven de Likida.
// ═══════════════════════════════════════════════════════════════════════════
import Link from 'next/link';
import type { Metadata } from 'next';
import { ARTICULOS } from '@/lib/likida/marketing/articulos';
import { fechaMx } from '@/lib/formato';
import { PulsoSitio } from '../calculadora/pulso';
import { MarcoPublico } from '../ui-v2/componentes/marco-publico';
import '../legal/publico-r2.css';
import { trPublico } from '@/lib/i18n/publico_tr';
import { rico } from '@/lib/i18n/rico';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await trPublico();
  return { title: t('blog.meta.titulo'), description: t('blog.meta.descripcion') };
}

export default async function Blog() {
  const { t, idioma } = await trPublico();
  return (
    <MarcoPublico
      rotulo={t('blog.rotulo')}
      titulo={t('blog.titulo')}
      apoyo={t('blog.apoyo')}
    >
      <PulsoSitio pagina="blog" />
      <ul className="rv-blog__lista">
        {ARTICULOS.map((a) => (
          <li key={a.slug} className="rv-blog__tarjeta">
            <p className="rv-pub__nota">{fechaMx(a.fecha, idioma)}</p>
            <h2 className="rv-pub__item-titulo">
              <Link href={`/blog/${a.slug}`}>{a.titulo}</Link>
            </h2>
            <p className="rv-pub__resumen">{a.resumen}</p>
          </li>
        ))}
      </ul>

      <p className="rv-pub__prosa rv-pub__sec">
        {rico(t('blog.cta'), { enlace: (c) => <Link href="/calculadora">{c}</Link> })}
      </p>
    </MarcoPublico>
  );
}
