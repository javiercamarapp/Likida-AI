import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { getConversacionesActivas, contarConversacionesActivas, TOPE_CONVERSACIONES } from '@/lib/admin/negocio';
import { Smartphone, Info } from 'lucide-react';
import { EstadoVacio, MarcoPagina, Tarjeta } from '../../ui-v2/componentes';
import { Cifra, TiraCifras } from '../../ui-v2/graficas';
import { FilaConversacion } from '../conversaciones/hilo';

export const dynamic = 'force-dynamic';

/** Lo que de verdad falta para tratar esto como infraestructura de la Meta
 *  WhatsApp Business API a escala — ninguno de estos existe hoy, y no se
 *  simula: Likida usa UN número para el flujo del bot, sin pool, sin
 *  plantillas administradas, sin métricas de entrega. */
const FUERA_DE_ALCANCE = [
  'Quality rating por número',
  'Pool de números con rotación/balanceo',
  'Plantillas — estado de aprobación, categoría, deliverability',
  'Entrega enviados → entregados → leídos',
  'Ventana de 24h',
  'Opt-ins / opt-outs',
];

/**
 * WhatsApp Infra — el número real que opera el bot de producción es UNO
 * solo, no un pool. No hay el dígito real disponible en este código (vive
 * en la config de Meta, no en una tabla), así que esta página lo describe
 * en vez de inventarlo. Lo único con datos reales aquí son las
 * conversaciones (`wa_conversacion`, vía `getConversacionesActivas`) — no
 * existe todavía una página dedicada de Conversaciones bajo /admin, así
 * que en vez de enlazar a algo que no existe, se enseña la lista completa
 * aquí mismo (mismo patrón que la sección "Conversaciones de WhatsApp" de
 * Inicio).
 *
 * Marco de página único (`MarcoPagina`). Las mitades vacías siguen vacías y lo dicen.
 */
export default async function WhatsappInfraPage() {
  // A37-S05-01/S06-01: puerta propia; el layout puede no ejecutarse en una petición RSC parcial.
  await requireSuperadmin();
  // FE-9: el KPI decía "Conversaciones activas: N" con el N del TOPE (20).
  const [conversaciones, total] = await Promise.all([
    getConversacionesActivas(), contarConversacionesActivas(),
  ]);
  const recortado = total !== null && total > conversaciones.length;

  return (
    <MarcoPagina titulo="WhatsApp Infra">
      {/* El conteo REAL de `wa_conversacion` (count exact, FE-9). Antes esta tarjeta enseñaba el tamaño de la página —20— con una nota
          que confesaba el tope: una cifra de infraestructura que se topa en 20 no sirve para dimensionar infraestructura. */}
      <TiraCifras etiqueta="Conversaciones de WhatsApp">
        <Cifra
          etiqueta="Conversaciones activas" valor={total} formato="entero"
          estado={total === null ? 'vacio' : 'ok'}
          mensaje="no se pudo contar"
          nota="Filas vivas en wa_conversacion (ventana rodante de turnos)"
        />
      </TiraCifras>

      <Tarjeta titulo="Número operativo">
        <p className="m-0 text-xs text-muted">
          El número real que opera el bot, y lo que falta para tratarlo como infraestructura a escala
        </p>
        <div className="mt-2 flex items-center gap-2.5 rounded-lg border border-[var(--line2)] bg-[var(--surface)] px-3 py-2.5">
          <Smartphone width={15} height={15} strokeWidth={1.75} className="shrink-0 text-muted" />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold">1 número operativo</div>
            <div className="mt-0.5 text-xs text-muted">
              El que usa el bot de producción — vía Meta WhatsApp Business API. Sin pool de números, sin rotación.
            </div>
          </div>
        </div>
        <p className="m-0 mt-2 text-xs text-muted">
          El dígito real no vive en este código (es configuración de Meta, no una fila en la base de datos) —
          por eso no se muestra un número aquí, para no inventar uno de ejemplo que se lea como real.
        </p>
      </Tarjeta>

      <Tarjeta titulo={recortado ? `Conversaciones — las ${TOPE_CONVERSACIONES} más recientes de ${total}` : 'Conversaciones'}>
        <div id="conversaciones" className="scroll-mt-24">
          {conversaciones.length === 0 ? (
            <p className="m-0 text-sm text-muted">Sin conversaciones activas.</p>
          ) : (
            <div className="space-y-1.5">
              {conversaciones.map((c) => <FilaConversacion key={`${c.tenantId ?? 'sin-flota'}-${c.telefono}`} c={c} />)}
            </div>
          )}
        </div>
      </Tarjeta>

      <Tarjeta titulo="Fuera de alcance hoy">
        <EstadoVacio titulo="Sin integrar" icono={Info} contenido>
          Ninguno de estos existe todavía en este panel — requieren integrar más a fondo la Meta WhatsApp
          Business API de lo que Likida usa hoy:
        </EstadoVacio>
        <ul className="m-0 mt-3 list-none space-y-2 p-0 text-sm text-muted">
          {FUERA_DE_ALCANCE.map((item) => (
            <li key={item} className="flex items-start gap-2.5">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[var(--muted)]" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </Tarjeta>
    </MarcoPagina>
  );
}

export const metadata: Metadata = { title: 'WhatsApp Infra' };
