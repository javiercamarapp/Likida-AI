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

export const metadata: Metadata = {
  title: 'Blog — Likida',
  description:
    'Fiscal de transporte sin inflar cifras: peajes, IEPS de diésel, Carta Porte. Cada pieza cita su fundamento.',
};

export default function Blog() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-10 text-[15px] leading-relaxed" style={{ color: 'var(--muted)' }}>
      <PulsoSitio pagina="blog" />
      <header className="pb-6" style={{ borderBottom: '1px solid var(--line)' }}>
        <p className="text-xs font-medium uppercase tracking-wider">Blog</p>
        <h1 className="mt-2 text-2xl font-semibold" style={{ color: 'var(--ink)' }}>Likida</h1>
        <p className="mt-3 text-sm">
          Fiscal de transporte sin inflar cifras. Cada pieza cita su fundamento; lo que el corpus no cubre, se manda al contador.
        </p>
      </header>

      <ul className="mt-8 space-y-8">
        {ARTICULOS.map((a) => (
          <li key={a.slug}>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>{fechaMx(a.fecha)}</p>
            <Link
              href={`/blog/${a.slug}`}
              className="mt-1 block text-lg font-semibold underline-offset-2 hover:underline"
              style={{ color: 'var(--ink)' }}
            >
              {a.titulo}
            </Link>
            <p className="mt-2 text-sm">{a.resumen}</p>
          </li>
        ))}
      </ul>

      <footer className="mt-12 pt-6 text-sm" style={{ borderTop: '1px solid var(--line)' }}>
        <p>
          ¿Cuánto estás dejando ir en peajes y diésel?{' '}
          <Link href="/calculadora" className="underline underline-offset-2" style={{ color: 'var(--ink)' }}>
            Calcúlalo con tus números
          </Link>
          .
        </p>
      </footer>
    </main>
  );
}
