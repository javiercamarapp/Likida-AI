import { ShieldAlert } from 'lucide-react';
import { StatusPill, EstadoError, EstadoVacio, type Estado } from '../ui/kit';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';
import {
  getEventosSeguridad, resumenEventosSeguridad,
  type FilaSeguridad, type ResumenSeguridad,
} from '@/lib/seguridad/eventos';
import { fechaHoraMx, numero } from '@/lib/formato';

export const dynamic = 'force-dynamic';

// ═══════════════════════════════════════════════════════════════════════════
// Trust & Safety — la pantalla que decía «no existe pipeline» mientras el
// pipeline existía (tableros al día, 28-ago-2026).
//
// `evento_seguridad` (0133) lleva desde entonces registrando lo que los
// detectores CABLEADOS atrapan: firmas inválidas de webhooks (WhatsApp,
// Stripe, correo), intents rechazados del copiloto, cifras sin respaldo de la
// guardia del cuadre, rate limits, llaves del worker. Siete escritores — y el
// único lector era una tarjeta de 12 filas en /admin/dev. La pantalla con el
// nombre correcto afirmaba que nada de esto existía; quedó vieja en cuanto la
// 0133 aterrizó, y una pantalla de seguridad desactualizada miente en la
// dirección peligrosa: «aquí no hay nada que mirar».
//
// LO QUE ESTA PANTALLA NO AFIRMA (la mitad honesta de la versión anterior,
// que se conserva a propósito): no hay detección dedicada de jailbreaks ni de
// fugas de PII — la mitigación anti-inyección vive en el prompt del Agente de
// Cuadre (src/lib/agents/prompts.ts) y en la guardia determinista de cifras,
// y eso es mitigación, no detección. La tarjeta de abajo lo dice con esas
// palabras para que este panel nunca dé una seguridad que no se midió.
//
// Contratos de la casa: los conteos se miden EN la base (count exacto, nunca
// contando una rebanada); la lista declara «mostrando N de M» con M exacta;
// una lectura fallida se dice («no se pudo leer» ≠ «no hay eventos»); y el
// vacío de verdad se explica — con los detectores cableados, el silencio aquí
// es bueno de verdad.
// ═══════════════════════════════════════════════════════════════════════════

const LIMITE_LISTA = 50;

const PILL_SEVERIDAD: Record<string, { estado: Estado; etiqueta: string }> = {
  alta: { estado: 'bad', etiqueta: 'Alta' },
  media: { estado: 'warn', etiqueta: 'Media' },
  info: { estado: 'neutral', etiqueta: 'Info' },
};

function Cifra({ etiqueta, valor, tono }: { etiqueta: string; valor: number; tono?: 'bad' | 'warn' }) {
  return (
    <div className="card p-4">
      <div className="text-[12px]" style={{ color: 'var(--muted)' }}>{etiqueta}</div>
      <div className="text-2xl font-semibold tabular mt-1" style={{
        color: valor > 0 && tono === 'bad' ? 'var(--bad)' : 'var(--ink)',
      }}>
        {numero(valor)}
      </div>
    </div>
  );
}

function FilaEvento({ e }: { e: FilaSeguridad }) {
  const pill = PILL_SEVERIDAD[e.severidad] ?? { estado: 'neutral' as Estado, etiqueta: e.severidad };
  return (
    <tr className="hairline-t">
      <td className="py-2 pr-3 align-top text-sm whitespace-nowrap">{fechaHoraMx(e.creadoEn)}</td>
      <td className="py-2 pr-3 align-top">
        <div className="text-sm font-medium">{e.tipo.replace(/_/g, ' ')}</div>
        <div className="text-xs" style={{ color: 'var(--muted)' }}>{e.origen}</div>
      </td>
      <td className="py-2 pr-3 align-top"><StatusPill estado={pill.estado}>{pill.etiqueta}</StatusPill></td>
      <td className="py-2 pr-3 align-top text-xs" style={{ color: 'var(--muted)' }}>
        {/* El actor viene ya truncado a 120 y JAMÁS trae un secreto completo
            (contrato de registrarEventoSeguridad). Sin actor no se inventa. */}
        {e.actor ?? '—'}
      </td>
      <td className="py-2 align-top text-xs cifra-mono" style={{ color: 'var(--faint)' }}>
        {e.tenantId ? e.tenantId.slice(0, 8) : 'sin flota'}
      </td>
    </tr>
  );
}

export default async function TrustSafetyPage() {
  // Las dos lecturas caen POR SEPARADO: que los conteos fallen no debe
  // esconder la lista, ni al revés — y cada fallo se dice con su alcance.
  const [eventos, resumen] = await Promise.all([
    getEventosSeguridad(LIMITE_LISTA).catch((): FilaSeguridad[] | null => null),
    resumenEventosSeguridad().catch((): ResumenSeguridad | null => null),
  ]);

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<ShieldAlert width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Trust & Safety"
        />

        <div className="px-5 py-5 flex-1 space-y-5">
          {/* ── Los conteos, medidos en la base ── */}
          {resumen === null ? (
            <EstadoError mensaje="No se pudieron leer los conteos de eventos de seguridad — la base no contestó. Esto NO significa que haya cero eventos: significa que ahora mismo no se sabe." />
          ) : (
            <div>
              <TituloSeccion>Últimos 30 días, por severidad</TituloSeccion>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
                <Cifra etiqueta="Severidad alta · 30 días" valor={resumen.d30.alta} tono="bad" />
                <Cifra etiqueta="Severidad media · 30 días" valor={resumen.d30.media} tono="warn" />
                <Cifra etiqueta="Informativos · 30 días" valor={resumen.d30.info} />
                <Cifra etiqueta="Total histórico" valor={resumen.total} />
              </div>
            </div>
          )}

          {/* ── La lista ── */}
          <section className="card p-4">
            <TituloSeccion>Lo que los detectores atraparon</TituloSeccion>
            {eventos === null ? (
              <p className="text-sm mt-2" style={{ color: 'var(--muted)' }}>
                No se pudieron leer los eventos — que no es lo mismo que «no hay eventos».
              </p>
            ) : eventos.length === 0 ? (
              <div className="mt-2">
                <EstadoVacio icono={<ShieldAlert width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                  Ni un evento registrado. Los detectores están cableados — firmas de webhooks
                  (WhatsApp, Stripe, correo), intents del copiloto, guardia de cifras, rate limits,
                  llaves del worker — así que el silencio aquí es bueno de verdad.
                </EstadoVacio>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto mt-2">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr style={{ color: 'var(--muted)' }}>
                        <th className="py-2 pr-3 font-medium">Cuándo</th>
                        <th className="py-2 pr-3 font-medium">Qué y de dónde</th>
                        <th className="py-2 pr-3 font-medium">Severidad</th>
                        <th className="py-2 pr-3 font-medium">Actor</th>
                        <th className="py-2 font-medium">Flota</th>
                      </tr>
                    </thead>
                    <tbody>
                      {eventos.map((e) => <FilaEvento key={e.id} e={e} />)}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
                  {resumen === null
                    ? `Mostrando los últimos ${numero(eventos.length)} — el total histórico no se pudo contar ahora mismo.`
                    : `Mostrando ${numero(eventos.length)} de ${numero(resumen.total)} eventos históricos, del más reciente al más viejo.`}
                </p>
              </>
            )}
          </section>

          {/* ── Lo que este panel NO afirma — la mitad honesta se conserva ── */}
          <div className="card p-4">
            <TituloSeccion>Qué se detecta y qué no</TituloSeccion>
            <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
              Lo que sí hay: los detectores cableados de arriba escriben aquí (evento_seguridad, 0133) —
              firma inválida, intent inválido, step-up rechazado, rate limit, inyección de prompt marcada
              por la guardia, acceso denegado, cifra sin respaldo, payload excesivo. Lo que NO hay: un
              pipeline dedicado de detección de jailbreaks ni de fugas de PII. La mitigación anti-inyección
              del Agente de Cuadre vive en su prompt (<code className="font-mono">src/lib/agents/prompts.ts</code>)
              y en la guardia determinista de cifras — eso es mitigación, no detección, y este panel no
              afirma seguridad que no se midió.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
