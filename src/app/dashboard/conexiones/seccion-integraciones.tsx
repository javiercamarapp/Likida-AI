import { Blocks } from 'lucide-react';
import { MarcaIntegracion, StatusChip, type MarcaId, type TonoEstado } from '@/app/ui-v2/componentes';
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

const TONO: Record<string, TonoEstado> = { ok: 'ok', neutral: 'neutral', warn: 'warn', apagado: 'muted' };

/** Marca SOLO donde hay trazado verificado (CSV, SAP, WhatsApp); el resto cae al icono genérico de integración, nunca a un logo inventado. */
const MARCA: Record<string, MarcaId> = { export_csv: 'csv', sap_b1: 'sap', whatsapp_docs: 'whatsapp' };

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
              return (
                <article key={i.id} className="rounded-lg hairline px-3 py-2.5" style={{ background: 'var(--surface)' }}>
                  <div className="flex items-center gap-2.5">
                    <MarcaIntegracion id={MARCA[i.id] ?? 'generico'} tam={18} />
                    <h4 className="text-[13px] font-medium min-w-0 flex-1">{i.nombre}</h4>
                    <StatusChip tono={TONO[e.tono] ?? 'neutral'} className="shrink-0">{e.rotulo}</StatusChip>
                  </div>

                  <p className="text-[12px] mt-1" style={{ color: 'var(--muted)' }}>{i.queHace}</p>

                  <dl className="mt-1.5 space-y-1">
                    <div>
                      <dt className="rv-etq" style={{ color: 'var(--faint)' }}>Cómo conecta hoy</dt>
                      <dd className="text-[12px] mt-0.5">{i.comoConectaHoy}</dd>
                    </div>
                    {i.paraSubirDeEscalon && (
                      <div>
                        <dt className="rv-etq" style={{ color: 'var(--faint)' }}>Para dar el siguiente paso</dt>
                        <dd className="text-[12px] mt-0.5" style={{ color: 'var(--muted)' }}>
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

      <p className="text-[11px] mt-3" style={{ color: 'var(--faint)' }}>
        ¿Falta el sistema que tú usas? Es exactamente lo que se conecta contigo en el arranque —
        escríbenos desde el Centro de ayuda.
      </p>
    </section>
  );
}
