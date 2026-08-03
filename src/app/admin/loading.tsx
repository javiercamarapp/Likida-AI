/**
 * El tercer estado que faltaba (§E del complemento: "carga/vacío/error en
 * cada widget") — hasta hoy solo existían vacío/error por página, nunca
 * carga: como todas las páginas de /admin son `force-dynamic` (leen
 * Supabase en cada visita), sin esto cada navegación es pantalla EN
 * BLANCO hasta que la consulta responde. `loading.tsx` es la convención
 * de Next.js — Next envuelve `children` en un Suspense boundary y pinta
 * ESTO mientras la página de abajo sigue esperando datos; el sidebar
 * (layout.tsx) NO se desmonta, sigue interactivo.
 *
 * Shimmer (`.skeleton`, globals.css), no spinner — mismo criterio que
 * `EstadoCargando` (ui/kit.tsx). Un esqueleto GENÉRICO (header + grid de
 * 4 tiles + una gráfica), no uno específico por página: cubre la forma
 * real de la enorme mayoría de las 27 páginas (header + KpiTile grid +
 * ChartCard) sin mantener 27 variantes.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="glass-panel h-14 flex items-center px-5">
        <div className="skeleton rounded-md" style={{ width: 180, height: 16 }} />
      </div>

      <div className="glass-panel p-5">
        <div className="skeleton rounded" style={{ width: 140, height: 11, marginBottom: 12 }} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card p-3.5">
              <div className="flex items-center gap-3">
                <div className="skeleton rounded-lg shrink-0" style={{ width: 32, height: 32 }} />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="skeleton rounded" style={{ width: '55%', height: 18 }} />
                  <div className="skeleton rounded" style={{ width: '80%', height: 9 }} />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 card p-4">
          <div className="skeleton rounded" style={{ width: 120, height: 11, marginBottom: 14 }} />
          <div className="skeleton rounded-md" style={{ height: 160 }} />
        </div>
      </div>
    </div>
  );
}
