import { ShieldCheck, Info, FileWarning } from 'lucide-react';

export const dynamic = 'force-dynamic';

/**
 * Compliance & Datos — sin sistema de ARCO/retención construido, pero a
 * diferencia de Soporte o Comunicación, esta página SÍ merece una nota más
 * sustantiva: Likida procesa datos fiscales y personales de verdad (OCR de
 * comprobantes, RFC y montos en `gasto`). No inventamos un flujo que no
 * existe, pero tampoco lo tratamos como "no aplica" — se marca como algo
 * que sube de prioridad en cuanto haya un cliente real.
 */
export default function CompliancePage() {
  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <ShieldCheck width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Compliance & Datos</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>ARCO, retención y manejo de datos fiscales/personales</span>
        </div>
      </header>

      <div className="glass-panel overflow-hidden">
        <section className="p-5">
          <div className="card p-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
                <Info width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />
              </div>
              <p className="text-sm">
                Solicitudes ARCO abiertas, datos por vencer retención, exports pendientes, audit log completo — Likida
                no tiene estos flujos construidos hoy.
              </p>
            </div>
          </div>
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <div className="card p-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
                <FileWarning width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />
              </div>
              <p className="text-sm">
                Dado que la app sí procesa datos fiscales/personales (RFC, montos, imágenes de comprobantes), esto sube
                de prioridad en cuanto haya un cliente real — no antes, para no construir un sistema de compliance para
                datos que hoy son solo del tenant demo.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
