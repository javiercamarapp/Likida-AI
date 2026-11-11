// ═══════════════════════════════════════════════════════════════════════════
// UN ARTÍCULO DEL BLOG — página pública estática por slug.
// Los bloques tipados de `marketing/articulos.ts` se pintan aquí; el
// fundamento (las fichas citadas) va al pie SIEMPRE — es la firma editorial
// de la casa: ninguna afirmación fiscal sin su fuente a la vista.
// ═══════════════════════════════════════════════════════════════════════════
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ARTICULOS, articuloPorSlug, type BloqueArticulo } from '@/lib/likida/marketing/articulos';
import { fechaMx } from '@/lib/formato';
import { PulsoSitio } from '../../calculadora/pulso';
import { MarcoPublico } from '../../ui-v2/componentes/marco-publico';
import { trPublico } from '@/lib/i18n/publico_tr';
import { rico } from '@/lib/i18n/rico';
import '../../legal/publico-r2.css';

export function generateStaticParams() {
  return ARTICULOS.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const a = articuloPorSlug(slug);
  if (!a) return { title: (await trPublico()).t('blog.meta.titulo') };
  return {
    title: `${a.titulo} — Likida`,
    description: a.resumen,
    openGraph: { title: a.titulo, description: a.resumen, type: 'article', publishedTime: a.fecha },
  };
}

function Bloque({ b }: { b: BloqueArticulo }) {
  switch (b.t) {
    case 'h2':
      return <h2 className="rv-pub__h2">{b.texto}</h2>;
    case 'p':
      return <p>{b.texto}</p>;
    case 'ul':
      return (
        <ul className="rv-pub__vinetas">
          {b.items.map((i, k) => <li key={k}>{i}</li>)}
        </ul>
      );
    case 'cita':
      return (
        <blockquote className="rv-pub__cita">
          <p>{b.texto}</p>
          <p className="rv-pub__nota">{b.fuente}</p>
        </blockquote>
      );
  }
}

export default async function Articulo({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const a = articuloPorSlug(slug);
  if (!a) notFound();
  const { t, idioma } = await trPublico();

  return (
    <MarcoPublico
      rotulo={t('blog.art.rotulo')}
      titulo={a.titulo}
      apoyo={fechaMx(a.fecha, idioma)}
      derecha={<Link href="/blog" className="rv-pub__enlace">{t('blog.art.volver')}</Link>}
    >
      <PulsoSitio pagina={`blog:${a.slug}`} />
      <article className="rv-pub__prosa">
        {a.bloques.map((b, i) => <Bloque key={i} b={b} />)}
      </article>

      <section className="rv-pub__tarjeta">
        <p className="rv-pub__rotulo">{t('blog.art.fundamento')}</p>
        <ul className="rv-pub__vinetas">
          {a.fundamento.map((f, i) => <li key={i}>{f}</li>)}
        </ul>
      </section>

      <p className="rv-pub__prosa rv-pub__sec">
        {rico(t('blog.art.cta'), { enlace: (c) => <Link href="/calculadora">{c}</Link> })}
      </p>
    </MarcoPublico>
  );
}
