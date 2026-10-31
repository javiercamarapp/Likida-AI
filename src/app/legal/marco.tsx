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

import { fechaMx } from '@/lib/formato';
import { MarcoPublico } from '../ui-v2/componentes/marco-publico';

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
          ? <strong key={i}>{t.slice(2, -2)}</strong>
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
    <p className="rv-pub__aviso-falta">{children}</p>
  );
}

export function PaginaLegal({
  etiqueta, bajada, secciones, aviso, pie, vigenteDesde,
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
  /**
   * AUDITORÍA 24 (LEG-12, BAJO, reincidente): esta prop antes no existía —
   * el encabezado imprimía `fechaMx(new Date())`, así que "Vigente al"
   * cambiaba cada día que alguien abriera la página, sin decir nunca cuándo
   * cambió el TEXTO. Cada llamador declara aquí la fecha del último cambio
   * sustantivo de su propio contenido (ISO, YYYY-MM-DD) — un rótulo que sea
   * verdad en vez de uno que se actualiza solo con el reloj.
   */
  vigenteDesde: string;
}) {
  return (
    <MarcoPublico
      rotulo={etiqueta}
      titulo="Likida"
      apoyo={`Vigente desde el ${fechaMx(vigenteDesde)} · ${bajada}`}
      pie={pie ?? undefined}
    >
      {aviso}

      <div className="rv-pub__prosa">
        {secciones.map((s) => (
          <section key={s.titulo} className="rv-pub__sec">
            <h2>{s.titulo}</h2>
            {s.fundamento && <p className="rv-pub__nota">{s.fundamento}</p>}
            {s.parrafos.map((p, i) => (
              <p key={i}><ConNegritas texto={p} /></p>
            ))}
          </section>
        ))}
      </div>
    </MarcoPublico>
  );
}
