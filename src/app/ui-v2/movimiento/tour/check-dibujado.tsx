// Marca de «hecho» que se dibuja en 380 ms (SPEC 4.1): SVG en línea, decorativo (`aria-hidden`); el estado «Hecho» lo dice el texto
// de al lado, nunca solo el dibujo. Sin movimiento (reduced-motion) aparece ya dibujada.
export function CheckDibujado({ tamano = 18, className }: { tamano?: number; className?: string }) {
  return (
    <svg className={['rv-onb-check', className].filter(Boolean).join(' ')} width={tamano} height={tamano} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle className="rv-onb-check__aro" cx="12" cy="12" r="10.5" />
      <path className="rv-onb-check__marca" d="M7 12.5L10.5 16L17 8.5" pathLength={1} />
    </svg>
  );
}
