import { ShieldAlert } from 'lucide-react';
import { EstadoVacio } from '../ui/kit';

export const dynamic = 'force-dynamic';

/**
 * Trust & Safety — `requireSuperadmin()` ya lo hizo el layout, esta página
 * no trae datos porque no existe pipeline de detección detrás de ninguna
 * de estas métricas: ni intentos de jailbreak, ni fugas de PII, ni cuentas
 * bloqueadas por abuso, ni rate limiting por cuenta.
 *
 * Lo único real y verificado (leído en `src/lib/agents/prompts.ts`, sección
 * SEGURIDAD del prompt de cuadre): el prompt SÍ trae mitigación explícita
 * contra inyección — trata folios/tickets/mensajes del operador como datos,
 * nunca como instrucciones. Eso es mitigación en el prompt, no detección ni
 * alertas, y se dice así de claro para no confundir una cosa con la otra.
 */
export default function TrustSafetyPage() {
  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <ShieldAlert width={16} height={16} strokeWidth={1.75} />
        <span className="text-sm font-medium">Trust & Safety</span>
      </header>

      <div className="glass-panel overflow-hidden">
        <section className="p-5">
          <EstadoVacio icono={<ShieldAlert width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}>
            Intentos de jailbreak bloqueados, fugas de PII detectadas, cuentas bloqueadas por abuso/spam, rate
            limiting por cuenta — Likida no tiene un pipeline de detección de esto hoy.
          </EstadoVacio>
        </section>
        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            El prompt del Agente de Cuadre ya incluye instrucciones anti-inyección explícitas — trata folios,
            tickets y mensajes del operador como datos, nunca como instrucciones
            (<code className="font-mono">src/lib/agents/prompts.ts</code>) — pero eso es mitigación en el prompt,
            no detección ni alertas: no hay panel de eso hoy.
          </p>
        </section>
      </div>
    </div>
  );
}
