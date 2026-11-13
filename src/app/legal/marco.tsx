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
import './publico-r2.css';
import './marco-legal.css';

export interface SeccionLegal {
  titulo: string;
  /** El artículo que sostiene la sección. Vacío cuando es contractual y no legal. */
  fundamento?: string;
  parrafos: string[];
}

/** El círculo de color que marcaba lo pendiente se queda en el texto (la huella del documento lo cuenta) pero no se ve: lo pendiente se dice con negritas y con el aviso ámbar, sin emojis. */
function conMarca(texto: string) {
  if (!texto.includes('\u{1F534}')) return texto;
  return texto.split('\u{1F534}').flatMap((trozo, i) => (i === 0 ? [trozo] : [<span key={`m${i}`} className="rv-pub__marca-falta" aria-hidden="true">{'\u{1F534}'}</span>, trozo]));
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
          : <span key={i}>{conMarca(t)}</span>,
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
  // Aviso ÁMBAR (Rovaq: #fff7e5 con borde rgba(134,88,13,.22)), nunca un emoji de color: las faltas se marcan con el aviso, no con un círculo rojo.
  return (
    <p className="rv-pub__aviso-falta" data-ambar="">{children}</p>
  );
}

// Los mismos dos enlaces de siempre: el texto visible de /terminos y /privacidad tiene huella registrada (lib/legal/huella_texto).
const ENLACES_LEGALES = [
  { href: '/terminos', texto: 'Términos de servicio' },
  { href: '/privacidad', texto: 'Política de privacidad' },
] as const;

export function PaginaLegal({
  etiqueta, bajada, secciones, aviso, pie, vigenteDesde, piel = 'documento', titulo, rotulo, etiquetaIndice,
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
  /**
   * `documento` (por omisión): la piel de los textos con HUELLA (/terminos, /privacidad): h1 = nombre del documento, logo en una
   * cabecera de sitio pintada por CSS (sin texto) y sin índice, porque cualquier texto nuevo cambia la huella y obliga a todos a aceptar de nuevo (`lib/legal/huella_texto`).
   * `sitio`: la piel del resto de las públicas (Rovaq `access-flow`): cabecera con el logo, h1 = el nombre del documento (`titulo`),
   * eyebrow (`rotulo`) e ÍNDICE de secciones. Solo para documentos SIN huella (hoy: /aviso/prospectos).
   */
  piel?: 'documento' | 'sitio';
  titulo?: string;
  rotulo?: string;
  /** Nombre accesible/encabezado del índice (solo piel `sitio`). */
  etiquetaIndice?: string;
}) {
  const sitio = piel === 'sitio' && titulo !== undefined;
  const textoVigencia = `Vigente desde el ${fechaMx(vigenteDesde)} · ${bajada}`;
  // Piel `documento`: el <h1> es el NOMBRE del documento («Términos de servicio»), como en las demás públicas; «Likida» (la marca) va dentro del
  // apoyo como nombre accesible del logo. Mismo texto y mismo ORDEN que antes (rótulo, «Likida», vigencia) → la huella no cambia.
  return (
    <MarcoPublico
      rotulo={sitio ? (rotulo ?? etiqueta) : undefined}
      titulo={sitio ? titulo : etiqueta}
      apoyo={sitio ? textoVigencia : <><span className="rv-legal__marca">Likida</span>{' '}{textoVigencia}</>}
      pie={pie ?? undefined}
      enlaces={sitio ? undefined : ENLACES_LEGALES}
      documento={!sitio}
    >
      {/* Marca de la piel `documento` para el CSS (logo arriba y el nombre del documento como título visible): un div vacío, sin atributos con texto, así la huella del documento no cambia. */}
      {sitio ? null : <div className="rv-legal__doc" aria-hidden="true" />}
      {aviso}

      {sitio ? (
        <nav className="rv-legal__indice" aria-label={etiquetaIndice}>
          <ol>
            {secciones.map((s, i) => <li key={s.titulo}><a href={`#seccion-${i + 1}`}>{s.titulo}</a></li>)}
          </ol>
        </nav>
      ) : null}

      <div className="rv-pub__prosa">
        {secciones.map((s, i) => (
          <section key={s.titulo} className="rv-pub__sec" id={sitio ? `seccion-${i + 1}` : undefined}>
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
