import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { ShieldAlert } from 'lucide-react';
import { StatusPill, EstadoError, EstadoVacio, type Estado } from '../ui/kit';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';
import {
  getEventosSeguridad, resumenEventosSeguridad,
  type FilaSeguridad, type ResumenSeguridad,
} from '@/lib/seguridad/eventos';
import { coberturaEventosSeguridad, type CoberturaFuente } from '@/lib/seguridad/cobertura';
import { fechaHoraMx, numero } from '@/lib/formato';

export const dynamic = 'force-dynamic';

// ═══════════════════════════════════════════════════════════════════════════
// Trust & Safety — el registro consultable de lo que los emisores de seguridad atrapan.
//
// CT-SEG-11 (4-nov-2026): esta pantalla decía «los detectores están cableados — así que el
// silencio aquí es bueno de verdad». Era falso en la dirección peligrosa: no había registro
// de login fallido, de llaves de API inválidas, de rutas negadas ni de exportes de dinero, y
// varios tipos (correo entrante, rate limits, inyección de prompt) nunca tuvieron un emisor.
// Un panel vacío no prueba que no pasó nada; prueba que nadie escribió.
//
// Ahora la pantalla MIDE su propia cobertura: `FUENTES_SEGURIDAD` (lib/seguridad/cobertura.ts)
// declara fuente por fuente qué emite y qué no — atado al código por una prueba — y aquí se
// pinta con el conteo real de 30 días. Una fuente que emite y marca 0 es silencio real O una
// fuente rota, y el panel dice que no las distingue.
//
// Contratos de la casa: los conteos se miden EN la base (count exacto, nunca contando una
// rebanada); la lista declara «mostrando N de M» con M exacta; una lectura fallida se dice
// («no se pudo leer» ≠ «no hay eventos»); lo que NO se detecta se dice con esas palabras.
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
        <div className="text-sm font-medium">
          {e.tipo.replace(/_/g, ' ')}
          {/* 0681: una ráfaga de la misma señal es UNA fila con su conteo — el número es lo medido, no una estimación. */}
          {(e.repeticiones ?? 1) > 1 && (
            <span className="ml-1.5 cifra-mono text-xs" style={{ color: 'var(--muted)' }} title="Veces que se vio la misma señal en su ventana">×{e.repeticiones}</span>
          )}
        </div>
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

function FilaCobertura({ f }: { f: CoberturaFuente }) {
  const medida = f.filas30d === null
    ? 'sin evento'
    : f.emite && f.filas30d === 0
      ? '0 en 30 días'
      : numero(f.filas30d);
  return (
    <tr className="hairline-t">
      <td className="py-2 pr-3 align-top text-sm">{f.titulo}</td>
      <td className="py-2 pr-3 align-top"><StatusPill estado={f.emite ? 'ok' : 'bad'}>{f.emite ? 'Emite' : 'No emite'}</StatusPill></td>
      <td className="py-2 pr-3 align-top text-sm tabular whitespace-nowrap">{f.emite && f.filas30d === 0 ? <span style={{ color: 'var(--muted)' }}>{medida}</span> : medida}</td>
      <td className="py-2 align-top text-xs" style={{ color: 'var(--muted)' }}>{f.donde}</td>
    </tr>
  );
}

export default async function TrustSafetyPage() {
  // A37-S05-01/S06-01: puerta propia; el layout puede no ejecutarse en una petición RSC parcial.
  await requireSuperadmin();
  // Las dos lecturas caen POR SEPARADO: que los conteos fallen no debe
  // esconder la lista, ni al revés — y cada fallo se dice con su alcance.
  const [eventos, resumen, cobertura] = await Promise.all([
    getEventosSeguridad(LIMITE_LISTA).catch((): FilaSeguridad[] | null => null),
    resumenEventosSeguridad().catch((): ResumenSeguridad | null => null),
    coberturaEventosSeguridad().catch((): CoberturaFuente[] | null => null),
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

          {/* ── La cobertura REAL, medida ── */}
          <section className="card p-4">
            <TituloSeccion>Cobertura: qué fuentes escriben aquí y cuáles no</TituloSeccion>
            {cobertura === null ? (
              <p className="text-sm mt-2" style={{ color: 'var(--muted)' }}>
                No se pudo medir la cobertura — la base no contestó. Eso no significa que haya cobertura completa ni vacía: significa que ahora mismo no se sabe.
              </p>
            ) : (
              <>
                <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
                  {cobertura.filter((f) => f.emite).length} de {cobertura.length} fuentes emiten. Las filas son señales ya agrupadas
                  (una ráfaga de la misma señal es una fila con su conteo), no intentos. Los exportes de dinero se anotan al
                  autorizar la descarga, no al terminar. Una fuente que emite y marca «0 en 30 días» es silencio real o una
                  fuente rota: no se distingue.
                </p>
                <div className="overflow-x-auto mt-2">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr style={{ color: 'var(--muted)' }}>
                        <th className="py-2 pr-3 font-medium">Fuente</th>
                        <th className="py-2 pr-3 font-medium">Estado</th>
                        <th className="py-2 pr-3 font-medium">Filas · 30 días</th>
                        <th className="py-2 font-medium">Dónde vive o qué falta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cobertura.map((f) => <FilaCobertura key={f.id} f={f} />)}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

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
                  Ningún evento registrado. Eso NO prueba que no haya pasado nada: solo cubre lo que las
                  fuentes de la sección de cobertura emiten, y varias no emiten. Una fuente que emite y marca
                  cero puede ser silencio real o una fuente rota; este panel no las distingue.
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
              Lo que sí hay: las fuentes marcadas «Emite» en la cobertura de arriba (evento_seguridad, 0133 y 0954).
              Lo que NO hay: las marcadas «No emite» — entre ellas rate limits, firma del correo entrante, inyección de
              prompt, lectura de datos personales y segundo factor — ni un pipeline dedicado de detección de jailbreaks
              o de fugas de PII. La mitigación anti-inyección del Agente de Cuadre vive en su prompt
              (<code className="font-mono">src/lib/agents/prompts.ts</code>) y en la guardia determinista de cifras —
              eso es mitigación, no detección, y este panel no afirma seguridad que no se midió. Los avisos por
              correo de severidad alta están apagados hasta que Javier encienda <code className="font-mono">SEGURIDAD_AVISOS</code>.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

export const metadata: Metadata = { title: 'Trust & Safety' };
