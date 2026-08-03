import { FlaskConical, ScanText, Calculator, Smartphone, Gauge, Info } from 'lucide-react';
import { EstadoVacio } from '../ui/kit';

export const dynamic = 'force-dynamic';

/**
 * Playground — Likida no tiene sandbox de prueba en vivo hoy. Construir uno
 * de verdad (subir un archivo real y correrlo por OCR/Cuadre sin tocar
 * producción, medir tokens/costo/latencia y guardar la traza) es ingeniería
 * real, no una pantalla: necesita una ruta que ejecute el pipeline en modo
 * aislado, instrumentación de latencia (que hoy no existe — ver Model Ops)
 * y una forma segura de no escribir en las tablas reales. Por eso esta
 * página NO simula un chat ni una caja de prueba: eso sería funcionalidad
 * decorativa que aparenta hacer algo y no hace nada, la regla más estricta
 * de esta noche. Es honesta sobre lo que falta y por qué.
 */
export default function PlaygroundPage() {
  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <FlaskConical width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Playground</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>Sandbox de prueba en vivo — todavía no existe</span>
        </div>
      </header>

      <div className="glass-panel overflow-hidden">
        <section className="p-6">
          <EstadoVacio icono={<Info width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}>
            <span className="block text-sm font-semibold">Esta función no existe en Likida hoy.</span>
            <span className="block text-sm mt-2" style={{ color: 'var(--muted)' }}>
              Cuando exista, el Playground va a servir para probar un agente en vivo con una entrada de prueba
              (una foto de comprobante, un mensaje de WhatsApp) y ver tokens, costo, latencia y la traza paso a
              paso — sin afectar producción ni escribir en las tablas reales de una flota.
            </span>
            <span className="block text-sm mt-2" style={{ color: 'var(--muted)' }}>
              No es una pantalla que falte diseñar: construirlo de verdad requiere una ruta de ejecución aislada
              del pipeline, instrumentar la latencia por llamada (hoy Likida no la registra — ver <span className="font-mono text-xs">Model Ops</span>)
              y garantizar que ninguna prueba toque datos reales de un cliente. Por eso esta página no simula un
              chat ni una caja de prueba: sería una demo que aparenta funcionar sin hacerlo.
            </span>
            <span className="block text-xs mt-4" style={{ color: 'var(--muted)' }}>
              Referencia: <span className="font-mono">docs/superpowers/plans/2026-08-02-roadmap-admin-negocio.md</span>
            </span>
          </EstadoVacio>
        </section>

        <section className="p-6 border-t" style={{ borderColor: 'var(--line)' }}>
          <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Qué SÍ existe hoy</h2>
          <p className="text-sm mt-2" style={{ color: 'var(--muted)' }}>
            Las 3 fases reales del pipeline (OCR → Cuadre → WhatsApp) corren en producción sobre datos reales de
            viajes — su costo y volumen de llamadas ya se ven en <span className="font-medium" style={{ color: 'var(--ink)' }}>Model Ops</span> y
            en cada página de agente. Lo que falta no es esa visibilidad; es un entorno de prueba separado de eso.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
            {[
              { Icono: ScanText, nombre: 'Agente OCR', href: '/admin/agente-ocr' },
              { Icono: Calculator, nombre: 'Agente de Cuadre', href: '/admin/agente-cuadre' },
              { Icono: Smartphone, nombre: 'Agente de WhatsApp', href: '/admin/agente-whatsapp' },
            ].map(({ Icono, nombre, href }) => (
              <a key={nombre} href={href} className="card p-3.5 flex items-center gap-3 hover:shadow-md transition-shadow">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
                  <Icono width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />
                </div>
                <span className="text-sm font-medium">{nombre}</span>
              </a>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-4 text-xs" style={{ color: 'var(--muted)' }}>
            <Gauge width={13} height={13} strokeWidth={1.75} /> Latencia por llamada: sin instrumentar todavía (Model Ops → Roadmap).
          </div>
        </section>
      </div>
    </div>
  );
}
