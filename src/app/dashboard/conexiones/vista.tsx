import { Plug, CircleCheck, CircleAlert, CircleDashed, CircleHelp, FlaskConical } from 'lucide-react';
import type { Conector } from '@/lib/likida/conexiones';
import { BarraPagina } from '../resumen-visual';

const ESTADO: Record<Conector['estado'], { rotulo: string; fg: string; bg: string; Icono: typeof CircleCheck }> = {
  listo: { rotulo: 'Listo', fg: 'var(--ok)', bg: 'var(--okbg)', Icono: CircleCheck },
  incompleto: { rotulo: 'Incompleto', fg: 'var(--warn)', bg: 'var(--warnbg)', Icono: CircleAlert },
  sin_configurar: { rotulo: 'Sin conectar', fg: 'var(--muted)', bg: 'var(--canvas)', Icono: CircleDashed },
  // «No se pudo medir» tiene rótulo y tono PROPIOS (c7-28). Pintarlo con el
  // gris de «Sin conectar» decía sobre la flota lo que solo se sabía de la
  // consulta, y mandaba a recapturar credenciales que ya existían. Va en
  // ámbar y con el icono de la pregunta, no con el del hueco: aquí no falta
  // nada, falta la lectura.
  no_medible: { rotulo: 'No se pudo medir', fg: 'var(--warn)', bg: 'var(--warnbg)', Icono: CircleHelp },
  ensayo: { rotulo: 'En ensayo', fg: 'var(--warn)', bg: 'var(--warnbg)', Icono: FlaskConical },
};

/**
 * La pantalla de Conexiones (F7): cada renglón es un estado MEDIDO con su
 * fuente en el detalle — nunca un semáforo decorativo. Lo que falta se dice
 * en palabras de persona; las decisiones de negocio (el candado del
 * timbrado) se declaran como decisiones, no como fallas.
 */
export function VistaConexiones({ conectores, credenciales, integraciones }: {
  conectores: Conector[];
  /** La sección "Credenciales de tus sistemas", ya armada en el servidor
   *  (`SeccionCredenciales` + acciones). Entra como ReactNode y no como
   *  datos: esta vista no debe importar el motor, que trae `supabaseAdmin`
   *  (mismo patrón que `notificaciones` en el Agente de Proveedores). */
  credenciales?: React.ReactNode;
  /** La sección "Con qué sistemas conecta Likida", que era la pantalla gemela
   *  `/dashboard/integraciones` hasta la fusión de agosto-2026. Mismo criterio
   *  de ReactNode que la de credenciales. */
  integraciones?: React.ReactNode;
}) {
  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Plug width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Conexiones"
        />
        <div className="px-5 py-5 flex-1 space-y-3">
          <p className="text-[12px]" style={{ color: 'var(--faint)' }}>
            Lo que tu flota tiene conectado y lo que le falta — cada estado sale de una medición,
            no de un semáforo de adorno.
          </p>

          {conectores.map((c) => {
            const e = ESTADO[c.estado];
            return (
              <section key={c.id} className="card p-4">
                <div className="flex items-start gap-3">
                  <e.Icono width={16} height={16} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: e.fg }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <h2 className="font-display text-[14px] font-semibold">{c.nombre}</h2>
                      <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium"
                        style={{ color: e.fg, background: e.bg }}>{e.rotulo}</span>
                    </div>
                    <p className="text-[12.5px] mt-1" style={{ color: 'var(--muted)' }}>{c.detalle}</p>
                    {c.falta.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5">
                        {c.falta.map((f) => (
                          <li key={f} className="text-[12px] flex items-start gap-1.5" style={{ color: 'var(--warn)' }}>
                            <span className="mt-1.5 w-1 h-1 rounded-full shrink-0" style={{ background: 'var(--warn)' }} />
                            {f}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </section>
            );
          })}

          {/* El orden es el del trabajo: primero QUÉ está medido, luego CON
              QUÉ sabe conectar Likida, y al final DÓNDE se capturan los
              accesos — que es lo que se hace después de leer las otras dos. */}
          {integraciones}

          {credenciales}
        </div>
      </div>
    </main>
  );
}
