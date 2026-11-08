import { Mail, FileText, ShieldCheck, Globe, MapPin, Stamp, type LucideIcon } from 'lucide-react';
import type { Conector } from '@/lib/likida/conexiones';
import { MarcoPagina, MarcaIntegracion, StatusChip, TituloRecuadro, type TonoEstado } from '@/app/ui-v2/componentes';

// El estado se dice con una pastilla a la derecha (texto + punto, nunca solo color). «No se pudo medir» tiene rótulo y tono PROPIOS
// (c7-28): pintarlo con el gris de «Sin conectar» decía sobre la flota lo que solo se sabía de la consulta, y mandaba a recapturar
// credenciales que ya existían. Aquí no falta nada, falta la lectura.
const ESTADO: Record<Conector['estado'], { rotulo: string; tono: TonoEstado }> = {
  listo: { rotulo: 'Listo', tono: 'ok' },
  incompleto: { rotulo: 'Incompleto', tono: 'warn' },
  sin_configurar: { rotulo: 'Sin conectar', tono: 'muted' },
  no_medible: { rotulo: 'No se pudo medir', tono: 'warn' },
  ensayo: { rotulo: 'En ensayo', tono: 'info' },
};

/** Logo de marca SOLO donde hay trazado verificable (WhatsApp); el resto lleva un icono sobrio del tema de la conexión. Nunca un logo inventado. */
const ICONO: Record<Conector['id'], { marca: 'whatsapp' } | { icono: LucideIcon }> = {
  whatsapp: { marca: 'whatsapp' },
  correo: { icono: Mail },
  fiscal: { icono: FileText },
  sat: { icono: ShieldCheck },
  portales: { icono: Globe },
  rastreo: { icono: MapPin },
  timbrado: { icono: Stamp },
};

function Marca({ id }: { id: Conector['id'] }) {
  const m = ICONO[id];
  if ('marca' in m) return <MarcaIntegracion id={m.marca} tam={18} />;
  const I = m.icono;
  return <I width={18} height={18} strokeWidth={1.75} aria-hidden="true" style={{ color: 'var(--muted)' }} />;
}

/**
 * La pantalla de Conexiones (F7): cada renglón es un estado MEDIDO con su
 * fuente en el detalle — nunca un semáforo decorativo. Lo que falta se dice
 * en palabras de persona; las decisiones de negocio (el candado del
 * timbrado) se declaran como decisiones, no como fallas.
 */
export function VistaConexiones({ conectores, credenciales, integraciones, gps }: {
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
  /** La sección «GPS»: salud por integración, push propio, huérfanos y mapeo (W3). */
  gps?: React.ReactNode;
}) {
  return (
    <MarcoPagina titulo="Conexiones" apoyo="Lo que tu flota tiene conectado y lo que le falta; cada estado sale de una medición, no de un semáforo de adorno.">
      <section className="card" data-tour="conexiones.estado" aria-label="Estado de las conexiones">
        <ul className="divide-y" style={{ borderColor: 'var(--line2)' }}>
          {conectores.map((c) => {
            const e = ESTADO[c.estado];
            return (
              <li key={c.id} className="flex items-start gap-3 px-4 py-2.5" style={{ borderColor: 'var(--line2)' }}>
                <span className="mt-0.5 shrink-0 inline-flex" style={{ width: 18, height: 18 }}><Marca id={c.id} /></span>
                <div className="min-w-0 flex-1">
                  <TituloRecuadro nivel="h3" info="conexiones.conector">{c.nombre}</TituloRecuadro>
                  <p className="text-[12px] mt-0.5" style={{ color: 'var(--muted)' }}>{c.detalle}</p>
                  {c.falta.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {c.falta.map((f) => (
                        <li key={f} className="text-[12px] flex items-start gap-1.5" style={{ color: 'var(--warn)' }}>
                          <span className="mt-1.5 w-1 h-1 rounded-full shrink-0" style={{ background: 'var(--warn)' }} />
                          {f}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <StatusChip tono={e.tono} className="shrink-0">{e.rotulo}</StatusChip>
              </li>
            );
          })}
        </ul>
      </section>

      {/* El orden es el del trabajo: primero QUÉ está medido, luego CON
          QUÉ sabe conectar Likida, y al final DÓNDE se capturan los
          accesos — que es lo que se hace después de leer las otras dos. */}
      {integraciones}

      {gps}

      <div data-tour="conexiones.credenciales">{credenciales}</div>
    </MarcoPagina>
  );
}
