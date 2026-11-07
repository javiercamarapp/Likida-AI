// Cursor que muestra el gesto sobre el elemento REAL: llega, aprieta y se queda (2 repeticiones, menos de 3 s: no necesita pausa,
// WCAG 2.2.2). Decorativo y sin clics. Su posición sale de las variables --tour-* de la capa del recorrido (escritas por CSSOM).
// Con «reducir movimiento» no hay trayecto: queda quieto junto al elemento, que ya dice qué hacer en la etiqueta y la tarjeta.
export type GestoCursor = 'clic' | 'escribir' | 'arrastrar';

export function CursorGesto({ gesto = 'clic' }: { gesto?: GestoCursor }) {
  return (
    <div className="rv-onb-cursor" data-gesto={gesto} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="26" height="26" focusable="false">
        <path className="rv-onb-cursor__flecha" d="M5 3L5 18L9.5 14L12.5 21L15 20L12 13L18 13Z" />
      </svg>
      <span className="rv-onb-cursor__toque" />
    </div>
  );
}
