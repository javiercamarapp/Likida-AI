// ═══════════════════════════════════════════════════════════════════════════
// EL MARCO COMPARTIDO DE LAS PÁGINAS LEGALES.
//
// Existe porque son DOS documentos (/privacidad y /terminos) y van a ser tres
// (el contrato de encargado). Cada uno con su propio layout se despeina solo:
// el primero que alguien retoque deja a los otros con otra tipografía, y un
// paquete legal que se ve de tres empresas distintas se lee como improvisado
// justo donde más importa parecer serio.
//
// PALETA: la misma del panel, por tokens (`--ink`, `--muted`, `--line`), nunca
// colores literales. Estas páginas las ve alguien que no ha iniciado sesión, y
// aun así tienen que verse de Likida.
// ═══════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import { fechaMx } from '@/lib/formato';

export interface SeccionLegal {
  titulo: string;
  /** El artículo que sostiene la sección. Vacío cuando es contractual y no legal. */
  fundamento?: string;
  parrafos: string[];
}

/**
 * `**negritas**` sin traer un motor de markdown entero a una página estática.
 * Solo negritas a propósito: es lo único que estos documentos necesitan, y un
 * parser más ambicioso en una página legal es superficie para que un texto se
 * renderice distinto de como se redactó.
 */
export function ConNegritas({ texto }: { texto: string }) {
  return (
    <>
      {texto.split(/(\*\*[^*]+\*\*)/g).map((t, i) =>
        t.startsWith('**') && t.endsWith('**')
          ? <strong key={i} className="font-semibold" style={{ color: 'var(--ink)' }}>{t.slice(2, -2)}</strong>
          : <span key={i}>{t}</span>,
      )}
    </>
  );
}

/**
 * El aviso de dato faltante. Se ENSEÑA en vez de rellenarse: una razón social
 * inventada en un documento legal es peor que una que falta, porque la que
 * falta se nota. Mismo criterio que el aviso integral con el contacto del
 * art. 29.
 */
export function FaltaDato({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="mt-6 rounded-md px-4 py-3 text-sm"
      style={{ border: '1px solid var(--color-warn)', color: 'var(--ink)' }}
    >
      {children}
    </p>
  );
}

export function PaginaLegal({
  etiqueta, bajada, secciones, aviso, pie,
}: {
  /** El rótulo chico de arriba: "Términos de servicio", "Política de privacidad". */
  etiqueta: string;
  /**
   * NO hay prop `titulo`: el <h1> siempre dice "Likida". Quien emite los tres
   * documentos es la misma empresa, y dejar que cada página pusiera el suyo
   * abría la puerta a que uno saliera con otro nombre — que en un documento
   * legal no es un detalle de diseño.
   */
  bajada: string;
  secciones: SeccionLegal[];
  /** El recuadro de dato faltante, si aplica. */
  aviso?: React.ReactNode;
  pie?: React.ReactNode;
}) {
  return (
    <main
      className="mx-auto max-w-2xl px-5 py-10 text-[15px] leading-relaxed"
      style={{ color: 'var(--muted)' }}
    >
      <header className="pb-6" style={{ borderBottom: '1px solid var(--line)' }}>
        <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
          {etiqueta}
        </p>
        <h1 className="mt-2 text-2xl font-semibold" style={{ color: 'var(--ink)' }}>Likida</h1>
        <p className="mt-3 text-sm" style={{ color: 'var(--muted)' }}>
          Vigente al {fechaMx(new Date().toISOString())} · {bajada}
        </p>
      </header>

      {aviso}

      {secciones.map((s) => (
        <section key={s.titulo} className="mt-8">
          <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>{s.titulo}</h2>
          {s.fundamento && (
            <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>{s.fundamento}</p>
          )}
          {s.parrafos.map((p, i) => (
            <p key={i} className="mt-3"><ConNegritas texto={p} /></p>
          ))}
        </section>
      ))}

      <footer className="mt-12 pt-6 text-sm" style={{ borderTop: '1px solid var(--line)', color: 'var(--muted)' }}>
        {pie}
        <p className="mt-4 flex gap-4">
          <Link href="/terminos" className="underline underline-offset-2 hover:opacity-70 transition-opacity">
            Términos de servicio
          </Link>
          <Link href="/privacidad" className="underline underline-offset-2 hover:opacity-70 transition-opacity">
            Política de privacidad
          </Link>
        </p>
      </footer>
    </main>
  );
}
