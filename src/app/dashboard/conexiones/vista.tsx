import { Mail, FileText, ShieldCheck, Globe, MapPin, Stamp, type LucideIcon } from 'lucide-react';
import type { Conector } from '@/lib/likida/conexiones';
import { Icono, InfoTip, MarcoPagina, MarcaIntegracion, StatusChip, Tarjeta, type TonoEstado } from '@/app/ui-v2/componentes';
import './conexiones.css';

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
  return <Icono icono={I} tam={18} />;
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
      <div data-tour="conexiones.estado">
        <Tarjeta titulo="Estado de las conexiones">
          <ul className="rv-cx__lista">
            {conectores.map((c) => {
              const e = ESTADO[c.estado];
              return (
                <li key={c.id} className="rv-cx__fila">
                  <span className="rv-cx__marca"><Marca id={c.id} /></span>
                  <div className="rv-cx__cuerpo">
                    <span className="rv-cx__nombre">{c.nombre}<InfoTip clave="conexiones.conector" /></span>
                    <p className="rv-cx__detalle">{c.detalle}</p>
                    {c.falta.length > 0 && (
                      <ul className="rv-cx__faltas">
                        {c.falta.map((f) => <li key={f} className="rv-cx__falta">{f}</li>)}
                      </ul>
                    )}
                  </div>
                  <StatusChip tono={e.tono}>{e.rotulo}</StatusChip>
                </li>
              );
            })}
          </ul>
        </Tarjeta>
      </div>

      {/* El orden es el del trabajo: primero QUÉ está medido, luego CON
          QUÉ sabe conectar Likida, y al final DÓNDE se capturan los
          accesos — que es lo que se hace después de leer las otras dos. */}
      {integraciones}

      {gps}

      <div data-tour="conexiones.credenciales">{credenciales}</div>
    </MarcoPagina>
  );
}
