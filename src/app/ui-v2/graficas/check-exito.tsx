/** Check de éxito: el trazo se dibuja UNA vez (380 ms, solo con
 *  no-preference); con reduce queda estático. Decorativo salvo que se pase
 *  `etiqueta`. */
export function CheckExito({ tamano = 28, etiqueta }: { tamano?: number; etiqueta?: string }) {
  return (
    <svg className="rv-check" width={tamano} height={tamano} viewBox="0 0 28 28"
      role={etiqueta ? 'img' : undefined} aria-label={etiqueta} aria-hidden={etiqueta ? undefined : true}>
      <circle className="rv-check__aro" cx="14" cy="14" r="12" fill="none" strokeWidth="2" />
      <path className="rv-check__trazo" d="M8.5 14.5 12.5 18.5 19.5 10" fill="none" strokeWidth="2.4"
        strokeLinecap="round" strokeLinejoin="round" pathLength={1} />
    </svg>
  );
}
