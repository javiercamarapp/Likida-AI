import Link from 'next/link';
import { Settings2, TriangleAlert } from 'lucide-react';
import { BarraPagina } from '../../../resumen-visual';
import type { ConfigConductor } from '@/lib/likida/conductor/config';
import type { ContactoTrafico } from '@/lib/likida/conductor/escalamiento';
import { FormaConfigConductor, type AccionConfig } from './forma';

export function VistaConfigConductor({ sufijo, config, valores, contactos, patios, puedeEditar, accionGuardar }: {
  sufijo: string;
  /** `null` = no se pudo leer: se dice, no se enseña un formulario con los defaults como si fueran lo guardado. */
  config: ConfigConductor | null;
  valores: Record<string, string> | null;
  contactos: ContactoTrafico[] | null;
  patios: Array<{ id: string; nombre: string }>;
  puedeEditar: boolean;
  accionGuardar: AccionConfig;
}) {
  const legible = config !== null && valores !== null && contactos !== null;
  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina icono={<Settings2 width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />} titulo="Configuración del agente Conductor" />
        <div className="px-5 py-5 flex-1 space-y-4 max-w-[980px]">
          <p className="text-[12.5px] max-w-[80ch]" style={{ color: 'var(--muted)' }}>
            Cuándo y cuánto insiste el agente con tus choferes, en qué horario, y a quién avisa cuando nadie contesta. Lo que guardes aplica desde
            la próxima corrida (cada 5 minutos). <Link href={`/dashboard/agentes/conductores${sufijo}`} className="underline">Volver al tablero</Link>
          </p>
          {legible ? (
            <FormaConfigConductor accion={accionGuardar} config={config} valores={valores} contactos={contactos} patios={patios} puedeEditar={puedeEditar} />
          ) : (
            <p role="alert" className="flex items-start gap-2 text-[12.5px] px-3.5 py-2.5 rounded-lg" style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>
              <TriangleAlert aria-hidden width={15} height={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />
              No se pudo leer la configuración ahora mismo. No se muestra un formulario con valores por omisión para no confundirlos con lo guardado; intenta de nuevo en un momento.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
