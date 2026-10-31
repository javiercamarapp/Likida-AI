import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '../../logo';
import '../tokens.css';
import '../fonts.css';
import '../componentes.css';
import '../marco-publico.css';

const ENLACES_PIE = [
  { href: '/terminos', texto: 'Términos' },
  { href: '/privacidad', texto: 'Privacidad' },
  { href: '/seguridad', texto: 'Seguridad' },
  { href: '/estado', texto: 'Estado' },
] as const;

/**
 * EL MARCO ÚNICO de las páginas de acceso y públicas (L9a): cabecera con el logo oficial, columna de lectura, rótulo mono +
 * título + UNA línea de apoyo, acciones (con `.rv-btn`) y pie con los enlaces legales. Se pinta bajo `data-ui="v2"` y `tema-neutro`
 * (negro/gris/blanco; sin azul), con la tipografía de `ui-v2/fonts.css`. Respeta el tema guardado del navegador igual que el
 * panel; el login es la excepción (siempre claro, como Vexa) y tiene su propio marco.
 *
 * `ancho`: `estrecho` (440, tarjetas de cuenta) · `lectura` (680, texto) · `ancho` (1040, listas y formularios).
 */
export function MarcoPublico({
  rotulo, titulo, idTitulo = 'titulo-pagina', apoyo, acciones, children, ancho = 'lectura', centrado = false, derecha, pie, sinCabecera = false, enlaces = ENLACES_PIE,
}: {
  rotulo?: string;
  titulo: string;
  idTitulo?: string;
  apoyo?: ReactNode;
  acciones?: ReactNode;
  children?: ReactNode;
  ancho?: 'estrecho' | 'lectura' | 'ancho';
  /** Centra la columna en vertical (callejones: 403, 404, cuenta). */
  centrado?: boolean;
  derecha?: ReactNode;
  pie?: ReactNode;
  sinCabecera?: boolean;
  /** Enlaces del pie. Los documentos legales con huella de texto (`lib/legal/huella_texto`) pasan los suyos para no cambiar su texto visible. */
  enlaces?: ReadonlyArray<{ href: string; texto: string }>;
}) {
  return (
    <div data-ui="v2" className="tema-neutro rv-pub">
      <a href="#contenido-publico" className="rv-pub__salto" aria-label="Saltar al contenido" />
      {!sinCabecera && (
        <header className="rv-pub__cab">
          <Link href="/" aria-label="Likida, inicio"><Logo alto="h-6" /></Link>
          {derecha ? <div className="rv-pub__cab-der">{derecha}</div> : null}
        </header>
      )}
      <div className="rv-pub__cuerpo" data-centrado={centrado || undefined}>
        <main id="contenido-publico" tabIndex={-1} className="rv-pub__main" data-ancho={ancho} aria-labelledby={idTitulo}>
          <header>
            {rotulo ? <p className="rv-pub__rotulo">{rotulo}</p> : null}
            <h1 id={idTitulo} className="rv-pub__titulo">{titulo}</h1>
            {apoyo ? <p className="rv-pub__apoyo">{apoyo}</p> : null}
          </header>
          {acciones ? <div className="rv-pub__acciones">{acciones}</div> : null}
          {children}
        </main>
      </div>
      <footer className="rv-pub__pie">
        {pie ?? <p>Likida · Liquidación de viajes por WhatsApp</p>}
        <nav aria-label="Legal">
          {enlaces.map((e) => <Link key={e.href} href={e.href}>{e.texto}</Link>)}
        </nav>
      </footer>
    </div>
  );
}
