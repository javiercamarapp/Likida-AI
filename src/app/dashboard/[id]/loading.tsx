// Esqueleto del DETALLE. Era una copia byte a byte del de la lista: cuatro
// tarjetas en `grid-cols-2 md:grid-cols-4` dentro de `max-w-6xl`, cuando la
// página que carga es `max-w-4xl` con TRES tarjetas (auditoría 5, frontend,
// BAJO 3). El esqueleto prometía una estructura y llegaba otra, así que se veía
// un salto de layout justo en la transición que el esqueleto existe para
// suavizar — un esqueleto que miente hace más daño que no tenerlo.
//
// Esta versión sigue el andamio real del detalle: encabezado con folio y
// estatus, tres totales, y el bloque de secciones (deducibilidad, acreditables,
// comprobantes) que viene debajo.
export default function Loading() {
  return (
    <div className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto space-y-9">
        {/* Fecha + folio a la izquierda, estatus a la derecha */}
        <div className="flex items-end justify-between gap-3">
          <div className="space-y-2">
            <div className="h-4 w-40 rounded animate-pulse" style={{ background: 'var(--line)' }} />
            <div className="h-8 w-48 rounded animate-pulse" style={{ background: 'var(--line)' }} />
          </div>
          <div className="h-5 w-28 rounded animate-pulse" style={{ background: 'var(--line)' }} />
        </div>

        {/* Comprobado · Anticipo · Diferencia */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card h-24 animate-pulse" style={{ background: 'var(--line)' }} />
          ))}
        </div>

        <div className="card h-40 animate-pulse" style={{ background: 'var(--line)' }} />
        <div className="card h-56 animate-pulse" style={{ background: 'var(--line)' }} />
      </div>
    </div>
  );
}
