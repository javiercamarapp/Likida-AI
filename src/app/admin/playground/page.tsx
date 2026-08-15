import Link from 'next/link';
import { FlaskConical, ScanText, Calculator, MessagesSquare, Gauge, Info, ArrowRight } from 'lucide-react';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';
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
 * decorativa que aparenta hacer algo y no hace nada. Es honesta sobre lo
 * que falta y por qué.
 *
 * Re-envuelta en la anatomía FlowAI (14-ago): lienzo `--g1` + `BarraPagina`
 * con el ícono de `rutas.ts`. El mensaje honesto es el mismo de antes.
 */
export default function PlaygroundPage() {
  return (
    <main className="h-full">
      <div className="rounded-2xl overflow-hidden min-h-full flex flex-col hairline" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<FlaskConical width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Playground"
        />
        <div className="px-5 py-5 flex-1 space-y-2.5">
          <p className="text-xs" style={{ color: 'var(--muted)' }}>Sandbox de prueba en vivo — todavía no existe</p>

          <EstadoVacio icono={<Info width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
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

          <div className="card p-3">
            <TituloSeccion>Qué SÍ existe hoy</TituloSeccion>
            <p className="text-sm mt-2" style={{ color: 'var(--muted)' }}>
              Las 3 fases reales del pipeline (OCR → Cuadre → WhatsApp) corren en producción sobre datos reales de
              viajes — su costo y volumen de llamadas ya se ven en <span className="font-medium" style={{ color: 'var(--ink)' }}>Model Ops</span> y
              en cada página de agente. Lo que falta no es esa visibilidad; es un entorno de prueba separado de eso.
            </p>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-1.5">
              {[
                { Icono: ScanText, nombre: 'Agente OCR', href: '/admin/agente-ocr' },
                { Icono: Calculator, nombre: 'Agente de Cuadre', href: '/admin/agente-cuadre' },
                { Icono: MessagesSquare, nombre: 'Agente de WhatsApp', href: '/admin/agente-whatsapp' },
              ].map(({ Icono, nombre, href }) => (
                <Link key={nombre} href={href}
                  className="hairline rounded-lg px-3 py-2.5 flex items-center gap-2.5 transition-colors hover:bg-[var(--canvas)]"
                  style={{ background: 'var(--surface)' }}>
                  <Icono width={15} height={15} strokeWidth={1.75} className="shrink-0" style={{ color: 'var(--muted)' }} />
                  <span className="text-[13px] font-medium truncate">{nombre}</span>
                  <ArrowRight width={13} height={13} strokeWidth={1.75} className="ml-auto shrink-0" style={{ color: 'var(--muted)' }} />
                </Link>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-3 text-xs" style={{ color: 'var(--muted)' }}>
              <Gauge width={13} height={13} strokeWidth={1.75} /> Latencia por llamada: sin instrumentar todavía (Model Ops → Roadmap).
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
