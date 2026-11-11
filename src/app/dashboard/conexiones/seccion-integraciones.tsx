import { MarcaIntegracion, StatusChip, Tarjeta, type MarcaId, type TonoEstado } from '@/app/ui-v2/componentes';
import './conexiones.css';
import { porCategoria, ESTADO_INTEGRACION, type Integracion } from '@/lib/likida/integraciones';
import { type TResto, T_RESTO_ES } from '@/lib/i18n/resto_tr';
import { rico } from '@/lib/i18n/rico';

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
export function SeccionIntegraciones({ integraciones, t = T_RESTO_ES }: { integraciones: Integracion[]; t?: TResto }) {
  return (
    <Tarjeta titulo={t('cfg.con_que_sistemas_conecta_likida')}>
      <p className="rv-cx__apoyo">{rico(t('cfg.likida_es_una_capa_sobre_lo'), { strong: (c) => <strong>{c}</strong> })}</p>

      {porCategoria(integraciones).map(([categoria, items]) => (
        <div key={categoria} className="rv-cx__grupo">
          <p className="rv-cx__categoria">{categoria}</p>

          {items.map((i) => {
            const e = ESTADO_INTEGRACION[i.estado];
            return (
              <article key={i.id} className="rv-cx__sistema">
                <div className="rv-cx__sistema-cab">
                  <MarcaIntegracion id={MARCA[i.id] ?? 'generico'} tam={18} />
                  <h4>{i.nombre}</h4>
                  <StatusChip tono={TONO[e.tono] ?? 'neutral'}>{e.rotulo}</StatusChip>
                </div>

                <p className="rv-cx__detalle">{i.queHace}</p>

                <dl className="rv-cx__datos">
                  <div>
                    <dt>{t('cfg.como_conecta_hoy')}</dt>
                    <dd>{i.comoConectaHoy}</dd>
                  </div>
                  {i.paraSubirDeEscalon && (
                    <div>
                      <dt>{t('cfg.para_dar_el_siguiente_paso')}</dt>
                      <dd data-tenue>{i.paraSubirDeEscalon}</dd>
                    </div>
                  )}
                </dl>
              </article>
            );
          })}
        </div>
      ))}

      <p className="rv-cx__pie">{t('cfg.falta_el_sistema_que_tu_usas')}</p>
    </Tarjeta>
  );
}
