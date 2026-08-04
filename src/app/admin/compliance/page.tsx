import { ShieldCheck, FileWarning } from 'lucide-react';
import { EstadoVacio } from '../ui/kit';

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
          <EstadoVacio>
            Solicitudes ARCO abiertas, datos por vencer retención, exports pendientes, audit log completo — Likida
            no tiene estos flujos construidos hoy.
          </EstadoVacio>
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <EstadoVacio icono={<FileWarning width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
            Dado que la app sí procesa datos fiscales/personales (RFC, montos, imágenes de comprobantes), esto sube
            de prioridad en cuanto haya un cliente real — no antes, para no construir un sistema de compliance para
            datos que hoy son solo del tenant demo.
          </EstadoVacio>
        </section>
      </div>
    </div>
  );
}
