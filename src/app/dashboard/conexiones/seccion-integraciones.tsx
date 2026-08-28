import { Blocks } from 'lucide-react';
import { porCategoria, ESTADO_INTEGRACION, type Integracion } from '@/lib/likida/integraciones';

// ═══════════════════════════════════════════════════════════════════════════
// «CON QUÉ SISTEMAS CONECTA LIKIDA» — lo que era /dashboard/integraciones.
//
// ── POR QUÉ SE FUSIONÓ (agosto-2026) ─────────────────────────────────────
//
// Eran dos pantallas gemelas con la misma pregunta y dos respuestas que se
// podían contradecir: Conexiones medía «rastreo» contra `rastreo_credencial` e
// Integraciones medía lo MISMO contra la MISMA tabla, cada una con su propia
// consulta y su propio texto. Dos verdades sobre un solo hecho es una que
// envejece mal, y el dueño no tenía cómo saber cuál mirar.
//
// La separación que justificaba las dos —«Conexiones son CREDENCIALES,
// Integraciones son SISTEMAS»— era real en la arquitectura y falsa en la
// pantalla: quien entra a cualquiera de las dos está haciendo una sola cosa,
// que es conectar su flota. Ahora es una página con tres secciones: el estado
// medido, el catálogo de sistemas, y la captura de accesos.
//
// Lo que NO se fusionó es el módulo: `integraciones.ts` sigue siendo su propia
// capa (el catálogo de PRODUCTO, igual para todas las flotas) y `conexiones.ts`
// la de MEDICIÓN por tenant. Fundirlos obligaría a inventar un conector de
// WhatsApp con credenciales por flota, que no existe.
// ═══════════════════════════════════════════════════════════════════════════

const TONO: Record<string, { fg: string; bg: string }> = {
  ok: { fg: 'var(--ok)', bg: 'var(--okbg)' },
  neutral: { fg: 'var(--muted)', bg: 'var(--canvas)' },
  warn: { fg: 'var(--warn)', bg: 'var(--warnbg)' },
  apagado: { fg: 'var(--faint)', bg: 'var(--canvas)' },
};

/**
 * El catálogo de sistemas con su «Cómo conecta hoy».
 *
 * Esa línea es lo que hace útil a la sección y no se toca: la diferencia entre
 * «subes el archivo del TAG cada 10 días» y «nos conectamos solos a tu TAG» es
 * toda la diferencia para quien va a comprar. Por eso `por_archivo` se pinta
 * NEUTRO y no ámbar — es un estado terminado, no uno a medias.
 */
export function SeccionIntegraciones({ integraciones }: { integraciones: Integracion[] }) {
  return (
    <section className="card p-4">
      <div className="flex items-center gap-2 mb-1">
        <Blocks width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
        <h2 className="font-display text-[14px] font-semibold">Con qué sistemas conecta Likida</h2>
      </div>
      <p className="text-[12px] mb-3 max-w-2xl" style={{ color: 'var(--faint)' }}>
        Likida es una capa sobre lo que ya usas — no reemplaza tu ERP ni tu TMS. Cada renglón dice
        cómo entra el dato <strong>hoy</strong>, no lo que podría llegar a hacer.
      </p>

      <div className="space-y-4">
        {porCategoria(integraciones).map(([categoria, items]) => (
          <div key={categoria} className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              {categoria}
            </h3>

            {items.map((i) => {
              const e = ESTADO_INTEGRACION[i.estado];
              const t = TONO[e.tono];
              return (
                <article key={i.id} className="rounded-lg hairline p-3" style={{ background: 'var(--surface)' }}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <h4 className="text-[13px] font-medium">{i.nombre}</h4>
                    <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0"
                      style={{ color: t.fg, background: t.bg }}>
                      {e.rotulo}
                    </span>
                  </div>

                  <p className="text-[12.5px] mt-1" style={{ color: 'var(--muted)' }}>{i.queHace}</p>

                  <dl className="mt-2 space-y-1.5">
                    <div>
                      <dt className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>
                        Cómo conecta hoy
                      </dt>
                      <dd className="text-[12.5px] mt-0.5">{i.comoConectaHoy}</dd>
                    </div>
                    {i.paraSubirDeEscalon && (
                      <div>
                        <dt className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>
                          Para dar el siguiente paso
                        </dt>
                        <dd className="text-[12.5px] mt-0.5" style={{ color: 'var(--muted)' }}>
                          {i.paraSubirDeEscalon}
                        </dd>
                      </div>
                    )}
                  </dl>
                </article>
              );
            })}
          </div>
        ))}
      </div>

      <p className="text-[11.5px] mt-3" style={{ color: 'var(--faint)' }}>
        ¿Falta el sistema que tú usas? Es exactamente lo que se conecta contigo en el arranque —
        escríbenos desde el Centro de ayuda.
      </p>
    </section>
  );
}
