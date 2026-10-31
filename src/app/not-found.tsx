import type { Metadata } from 'next';
import { MarcoPublico } from './ui-v2/componentes/marco-publico';
import { BotonEnlace } from './ui-v2/componentes/boton';

// ═══════════════════════════════════════════════════════════════════════════
// EL 404 ES UNA PANTALLA DE MARCA, NO UNA PANTALLA DE PANEL.
//
// Sin esta página, una URL mal escrita mostraba el 404 crudo de Next: pantalla
// negra con texto de framework. Delante de un comprador eso se lee como "esto
// está a medio hacer", aunque el 404 sea correcto.
//
// El 17-ago-2026 la landing se mudó a likida.ai con un lenguaje editorial
// —papel, tinta, hairlines, titular en serif, kicker en mono, píldoras de
// tinta con el glifo que asoma—. Esta página lo habla, porque es la única
// superficie del software que puede ver alguien que NO ha entrado nunca: un
// enlace viejo reenviado por WhatsApp, un resultado de buscador, un correo de
// hace tres meses. Las piezas vienen de `editorial.tsx`; los colores, de los
// tokens de `globals.css`, que ya son los mismos hex de la landing.
//
// `tema-neutro` EN LA RAÍZ: es el override que ya usan las dos consolas y que
// vuelve `--marca` tinta. Sin él, el glifo del logo sale naranja (#c2410c) y
// la landing nueva no tiene naranja en ninguna parte.
//
// Sin tarjeta y sin acento de color: un 404 no es una acción que el producto
// quiera que hagas —es un callejón—, así que no lleva el único color de la
// marca, reservado para lo que sí importa.
//
// EL TEMA OSCURO SÍ LLEGA AQUÍ. El script de `layout.tsx` marca
// `data-theme` cuando la ruta empieza con `/dashboard`, y un 404 de
// `/dashboard/liqidaciones` (mal escrito) cae en esta página con el atributo
// puesto. Por eso no hay un solo color literal: todo sale de tokens que
// pivotan solos.
// ═══════════════════════════════════════════════════════════════════════════

export const metadata: Metadata = {
  title: 'Página no encontrada — Likida',
};

/**
 * El diagrama: la ruta se traza hasta el último punto conocido y el destino
 * queda vacío. Es el lenguaje gráfico de la landing (hairlines, un solo trazo,
 * rótulos en mono) contando exactamente lo que dice el titular — no un adorno
 * traído de una librería de ilustraciones.
 *
 * TODO es `currentColor` u opacidad sobre él: la figura entera se invierte con
 * el tema sin una segunda paleta.
 */
function FiguraRutaSinDestino() {
  return (
    // `max-w-xl` abajo de `lg`: en una tableta la figura se comía los 700px de
    // ancho de la columna única y, como el texto de un SVG escala con la caja,
    // los micro-rótulos crecían a 15px — más grandes que el pie de página y ya
    // no se leían como micro-rótulos.
    <figure
      className="relative mt-8 w-full overflow-hidden"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--ink) 4%, var(--bg))',
        border: '1px solid var(--line)',
        borderRadius: '16px',
        padding: 'clamp(20px, 2.6vw, 34px)',
      }}
    >
      <span aria-hidden className="rejilla-punteada absolute inset-0" />

      <div className="relative">
        {/* La hairline NO es `--line`: sobre la lámina de la figura (que ya es
            tinta al 4%) ese gris se pierde. Se mezcla contra `--ink` para que
            tenga el mismo peso en claro y en oscuro. */}
        <figcaption
          className="etiqueta-mono text-[10px] uppercase pb-4"
          style={{
            letterSpacing: '0.14em',
            color: 'var(--faint)',
            borderBottom: '1px solid color-mix(in srgb, var(--ink) 12%, transparent)',
            display: 'block',
          }}
        >
          Ruta solicitada
        </figcaption>

        <svg
          viewBox="0 0 420 156"
          className="mt-5 w-full"
          role="img"
          aria-label="Diagrama: el trazo avanza por tres puntos conocidos, después se vuelve punteado y termina en un punto vacío, sin destino."
          style={{ color: 'var(--ink)' }}
        >
          {/* El tramo que SÍ existe */}
          <line x1="30" y1="78" x2="234" y2="78" stroke="currentColor" strokeWidth="1.25" />
          {/* El tramo que ya no: el mismo trazo, hecho rayas. Más largas que
              los puntos de la rejilla del fondo — con puntos redondos las dos
              texturas se confundían y el corte dejaba de leerse. */}
          <line
            x1="234" y1="78" x2="336" y2="78"
            stroke="currentColor" strokeWidth="1.25"
            strokeDasharray="5 6" opacity="0.42"
          />
          {[30, 132, 234].map((x) => (
            <circle key={x} cx={x} cy="78" r="4.5" fill="currentColor" />
          ))}
          {/* El destino: anillo abierto y punteado, hueco por dentro */}
          <circle
            cx="368" cy="78" r="12.5"
            fill="none" stroke="currentColor" strokeWidth="1.25"
            strokeDasharray="2.5 5" opacity="0.55"
          />

          {/* Rótulos en mono, el registro de estado de cuenta de la marca.
              El tamaño lo pone `globals.css` y NO es uno solo: el texto de un
              SVG escala con el viewBox, así que los 9.5 que en escritorio son
              12px, en un teléfono caían a 6.8px — ilegibles. Bajo 640px suben
              y los dos rótulos de la izquierda se retiran: al tamaño en que sí
              se leen, los cuatro se encimarían. */}
          <g
            className="rotulos-diagrama"
            fill="currentColor" opacity="0.55"
            fontFamily="var(--font-mono), ui-monospace, monospace"
          >
            <text className="rotulo-opcional" x="30" y="118" textAnchor="start">SALIDA</text>
            <text className="rotulo-opcional" x="132" y="118" textAnchor="middle">EN RUTA</text>
            <text x="234" y="118" textAnchor="middle">ÚLTIMO PUNTO</text>
            <text x="368" y="118" textAnchor="middle">SIN DESTINO</text>
          </g>
        </svg>
      </div>
    </figure>
  );
}

export default function NoEncontrado() {
  return (
    <MarcoPublico
      rotulo="Error 404"
      titulo="Esta ruta no está en el mapa."
      apoyo="El enlace pudo cambiar de lugar o venir mal escrito. Vuelve al inicio: te deja en tu panel si ya iniciaste sesión, y en el acceso si no."
      ancho="lectura"
      centrado
      acciones={
        <>
          {/* `/` NO es una landing: es la puerta que reparte por sesión y por rol (`page.tsx` → `puertaDeEntrada`). */}
          <BotonEnlace href="/" variante="primary">Volver al inicio</BotonEnlace>
          <BotonEnlace href="/dashboard/soporte">Ir a soporte</BotonEnlace>
        </>
      }
    >
      <FiguraRutaSinDestino />
    </MarcoPublico>
  );
}
