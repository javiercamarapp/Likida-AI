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

export function generateStaticParams() {
  return ARTICULOS.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const a = articuloPorSlug(slug);
  if (!a) return { title: 'Blog — Likida' };
  return {
    title: `${a.titulo} — Likida`,
    description: a.resumen,
    openGraph: { title: a.titulo, description: a.resumen, type: 'article', publishedTime: a.fecha },
  };
}

function Bloque({ b }: { b: BloqueArticulo }) {
  switch (b.t) {
    case 'h2':
      return <h2 className="mt-8 text-base font-semibold" style={{ color: 'var(--ink)' }}>{b.texto}</h2>;
    case 'p':
      return <p className="mt-3">{b.texto}</p>;
    case 'ul':
      return (
        <ul className="mt-3 list-disc space-y-2 pl-5">
          {b.items.map((i, k) => <li key={k}>{i}</li>)}
        </ul>
      );
    case 'cita':
      return (
        <blockquote className="mt-4 border-l-2 pl-4" style={{ borderColor: 'var(--line)' }}>
          <p className="italic" style={{ color: 'var(--ink)' }}>{b.texto}</p>
          <p className="mt-1 text-xs">{b.fuente}</p>
        </blockquote>
      );
  }
}

export default async function Articulo({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const a = articuloPorSlug(slug);
  if (!a) notFound();

  return (
    <main className="mx-auto max-w-2xl px-5 py-10 text-[15px] leading-relaxed" style={{ color: 'var(--muted)' }}>
      <PulsoSitio pagina={`blog:${a.slug}`} />
      <header className="pb-6" style={{ borderBottom: '1px solid var(--line)' }}>
        <p className="text-xs font-medium uppercase tracking-wider">
          <Link href="/blog" className="underline-offset-2 hover:underline">Blog · Likida</Link>
        </p>
        <h1 className="mt-2 text-2xl font-semibold leading-snug" style={{ color: 'var(--ink)' }}>{a.titulo}</h1>
        <p className="mt-3 text-sm">{fechaMx(a.fecha)}</p>
      </header>

      <article className="mt-2">
        {a.bloques.map((b, i) => <Bloque key={i} b={b} />)}
      </article>

      <section className="mt-10 rounded-md px-4 py-3 text-sm" style={{ border: '1px solid var(--line)' }}>
        <p className="text-xs font-medium uppercase tracking-wider">Fundamento</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {a.fundamento.map((f, i) => <li key={i}>{f}</li>)}
        </ul>
      </section>

      <footer className="mt-10 pt-6 text-sm" style={{ borderTop: '1px solid var(--line)' }}>
        <p>
          ¿Quieres el número con tus datos?{' '}
          <Link href="/calculadora" className="underline underline-offset-2" style={{ color: 'var(--ink)' }}>
            Usa la calculadora
          </Link>{' '}
          y te enseñamos los supuestos junto a cada cifra.
        </p>
      </footer>
    </main>
  );
}
