import Link from 'next/link';
import { Settings2, TriangleAlert } from 'lucide-react';
import { BarraPagina } from '../../../resumen-visual';
import type { ConfigConductor } from '@/lib/likida/conductor/config';
import type { ContactoTrafico } from '@/lib/likida/conductor/escalamiento';
import type { ResultadoPreflight } from '@/lib/likida/conductor/preflight_piloto';
import { PanelPreflight } from './preflight';
import { FormaImportarRutas } from './forma_rutas';
import type { AccionSitio } from '../sitios/formas';
import { FormaConfigConductor, SeccionVoluntarios, type AccionConfig, type AccionVoluntario, type DatosVoluntarios } from './forma';

export function VistaConfigConductor({ sufijo, config, valores, contactos, patios, puedeEditar, accionGuardar, voluntarios, accionAlta, accionBaja, preflight, puedeForzarPreflight, accionImportarRutas }: {
  sufijo: string;
  /** `null` = no se pudo leer: se dice, no se enseña un formulario con los defaults como si fueran lo guardado. */
  config: ConfigConductor | null;
  valores: Record<string, string> | null;
  contactos: ContactoTrafico[] | null;
  patios: Array<{ id: string; nombre: string }>;
  puedeEditar: boolean;
  accionGuardar: AccionConfig;
  /** «Operadores del piloto» (0800). `undefined` = la pantalla no la trae; `null` = no se pudo leer. */
  voluntarios?: DatosVoluntarios | null;
  accionAlta?: AccionVoluntario;
  accionBaja?: AccionVoluntario;
  /** T-A5-25: «¿está lista la flota?». `undefined` = la pantalla no la trae (no se pinta); `null` = no se pudo leer. */
  preflight?: ResultadoPreflight | null;
  /** Solo el soporte de Likida (QA): casilla para encender la señal de vida saltando el preflight. */
  puedeForzarPreflight?: boolean;
  /** T-A5-48: importar rutas autorizadas de Google Maps (CSV). `undefined` = no se ofrece (sin permiso de asignar). */
  accionImportarRutas?: AccionSitio;
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
          {preflight !== undefined && <PanelPreflight preflight={preflight} />}
          {legible ? (
            <FormaConfigConductor accion={accionGuardar} config={config} valores={valores} contactos={contactos} patios={patios} puedeEditar={puedeEditar} puedeForzarPreflight={puedeForzarPreflight} />
          ) : (
            <p role="alert" className="flex items-start gap-2 text-[12.5px] px-3.5 py-2.5 rounded-lg" style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>
              <TriangleAlert aria-hidden width={15} height={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />
              No se pudo leer la configuración ahora mismo. No se muestra un formulario con valores por omisión para no confundirlos con lo guardado; intenta de nuevo en un momento.
            </p>
          )}
          {voluntarios === null && (
            <p role="alert" className="flex items-start gap-2 text-[12.5px] px-3.5 py-2.5 rounded-lg" style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>
              <TriangleAlert aria-hidden width={15} height={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />
              No se pudo leer la lista de operadores del piloto ahora mismo (o falta aplicar la migración 0800); intenta de nuevo en un momento.
            </p>
          )}
          {voluntarios && accionAlta && accionBaja && (
            <SeccionVoluntarios datos={voluntarios} puedeEditar={puedeEditar} accionAlta={accionAlta} accionBaja={accionBaja}
              parametros={[...new URLSearchParams(sufijo.replace(/^\?/, '')).entries()].filter(([k]) => k !== 'q')} />
          )}
          {accionImportarRutas && (
            <section aria-labelledby="rutas-titulo" className="space-y-2">
              <h2 id="rutas-titulo" className="text-[13px] font-medium">Rutas autorizadas de Google Maps</h2>
              <p className="text-[12.5px] max-w-[80ch]" style={{ color: 'var(--muted)' }}>
                La base de rutas hechas con anticipación, por corredor (y, si quieres, por sitio de origen y de destino). El agente nunca arma ni
                corrige un link: solo se aceptan links de maps.app.goo.gl o google.com/maps, y una ruta vencida se trata como si no existiera.
                Cada fila se aprueba o se rechaza sola; volver a subir el mismo archivo no cambia nada.
              </p>
              <FormaImportarRutas accion={accionImportarRutas} />
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
