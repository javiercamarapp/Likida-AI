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

export const metadata: Metadata = {
  title: 'Blog — Likida',
  description:
    'Fiscal de transporte sin inflar cifras: peajes, IEPS de diésel, Carta Porte. Cada pieza cita su fundamento.',
};

export default function Blog() {
  return (
    <MarcoPublico
      rotulo="Blog"
      titulo="Likida"
      apoyo="Fiscal de transporte sin inflar cifras. Cada pieza cita su fundamento; lo que el corpus no cubre, se manda al contador."
    >
      <PulsoSitio pagina="blog" />
      <ul className="rv-pub__lista rv-pub__sec">
        {ARTICULOS.map((a) => (
          <li key={a.slug}>
            <p className="rv-pub__nota">{fechaMx(a.fecha)}</p>
            <h2 className="rv-pub__item-titulo">
              <Link href={`/blog/${a.slug}`}>{a.titulo}</Link>
            </h2>
            <p className="rv-pub__resumen">{a.resumen}</p>
          </li>
        ))}
      </ul>

      <p className="rv-pub__prosa rv-pub__sec">
        ¿Cuánto estás dejando ir en peajes y diésel? <Link href="/calculadora">Calcúlalo con tus números</Link>.
      </p>
    </MarcoPublico>
  );
}
