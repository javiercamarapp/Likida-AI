import Link from 'next/link';
import { CircleCheck, CircleAlert } from 'lucide-react';
import '../conductores.css';
import { AvisoCompacto, Chip, Icono, Tarjeta } from '@/app/ui-v2/componentes';
import type { Comprobacion, IdComprobacion, ResultadoPreflight } from '@/lib/likida/conductor/preflight_piloto';
import { type TAgentes, type TrAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';
import { rico as ricoT } from '@/lib/i18n/rico';

// ═══════════════════════════════════════════════════════════════════════════
// «¿ESTÁ LISTA LA FLOTA?» (T-A5-25). Presentación pura del preflight del piloto: sin hooks ni datos propios (el servidor
// lee y juzga). `null` = no se pudo leer: se dice, no se pinta una lista en verde ni en rojo inventada.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lo que el cliente NUNCA debe leer: nombres internos de plantilla (`algo_v1`), rutas del repositorio (`docs/…md`) y números de migración.
 * El texto de `preflight_piloto.ts` está escrito para el equipo; aquí se limpia antes de pintarlo (solo presentación: la lógica no cambia).
 */
export function lenguajeLlano(texto: string): string {
  return texto
    .replace(/\s*\([^)]*docs\/[^)]*\)/gi, '')
    .replace(/\s*\([^)]*\)/g, (m) => (/\b[a-z]+_[a-z0-9_]*[a-z0-9]\b/.test(m) ? '' : m))
    .replace(/\s*\(\d{3,4}\)/g, '')
    .replace(/\b[a-z]+_[a-z0-9_]*[a-z0-9]\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .trim();
}

type Guia = { quien: Parameters<TAgentes>[0]; ir?: { ancla?: string; ruta?: string } };
/** Quién puede resolver cada punto y a dónde ir (anclas de la propia pantalla o la ruta que lo resuelve). */
const GUIA: Record<IdComprobacion, Guia> = {
  activo: { quien: 'f26d2.pre.quien_dueno_trafico', ir: { ancla: '#cfg-estado' } },
  agente_habilitado: { quien: 'f26d2.pre.quien_likida' },
  compuerta_movimiento: { quien: 'f26d2.pre.quien_dueno_trafico', ir: { ancla: '#cfg-ubicacion' } },
  zona: { quien: 'f26d2.pre.quien_dueno', ir: { ruta: '/dashboard/configuracion' } },
  cohorte: { quien: 'f26d2.pre.quien_dueno_trafico', ir: { ancla: '#cfg-voluntarios' } },
  voluntarios: { quien: 'f26d2.pre.quien_dueno_trafico', ir: { ancla: '#cfg-voluntarios' } },
  sitios: { quien: 'f26d2.pre.quien_dueno_trafico', ir: { ruta: '/dashboard/agentes/conductores/sitios' } },
  gps_unidades: { quien: 'f26d2.pre.quien_dueno_trafico', ir: { ruta: '/dashboard/conexiones' } },
  calidad_gps: { quien: 'f26d2.pre.quien_dueno_trafico', ir: { ruta: '/dashboard/conexiones' } },
  escalamiento: { quien: 'f26d2.pre.quien_dueno_trafico', ir: { ancla: '#cfg-contactos' } },
  plantillas: { quien: 'f26d2.pre.quien_likida_meta' },
};

export function PanelPreflight({ preflight, sufijo = '', tr = TR_ES }: { preflight: ResultadoPreflight | null; sufijo?: string; tr?: TrAgentes }) {
  const { t: tx } = tr;
  if (preflight === null) {
    return (
      <section id="cfg-preflight">
        <Tarjeta titulo={tx('rest.esta_lista_la_flota')} estado="error" mensaje={tx('rest.no_se_pudo_revisar_si_la')} />
      </section>
    );
  }
  const n = preflight.bloqueos.length;
  const hechos = preflight.comprobaciones.length - n;
  return (
    <section id="cfg-preflight">
      <Tarjeta titulo={tx('rest.esta_lista_la_flota')} acciones={<Chip tono={preflight.lista ? 'ok' : 'warn'} tamano="estado">{hechos} / {preflight.comprobaciones.length}</Chip>}>
        <div className="rv-cd__pila">
          <p className="rv-cd__nota">
            {preflight.lista
              ? tx('rest.todo_en_orden_ya_se_puede')
              : tx(n === 1 ? 'rest.falta_n_cosa_antes_de_encender.uno' : 'rest.falta_n_cosa_antes_de_encender.otros', { n })}
          </p>
          <ul className="rv-cd__pasos">
            {preflight.comprobaciones.map((c) => {
              const ok = c.estado === 'ok';
              const g = GUIA[c.id];
              return (
                <li key={c.id} className="rv-cd__paso" data-estado={ok ? 'ok' : 'falta'}>
                  <div className="rv-cd__paso-cab">
                    <h3 className="rv-cd__paso-titulo">{c.titulo}</h3>
                    <Chip tono={ok ? 'ok' : 'warn'} tamano="estado">
                      <Icono icono={ok ? CircleCheck : CircleAlert} tam={14} etiqueta={ok ? tx('rest.en_orden') : tx('rest.falta')} />
                      {ok ? tx('f26d2.pre.hecho') : tx('f26d2.pre.para_revisar')}
                    </Chip>
                  </div>
                  <p className="rv-cd__nota">{textoPaso(c, tx)}</p>
                  {!ok && (
                    <>
                      <dl className="rv-cd__paso-datos">
                        <div><dt>{tx('f26d2.pre.quien')}</dt><dd>{tx(g.quien)}</dd></div>
                        <div><dt>{tx('f26d2.pre.que_se_pide')}</dt><dd>{pideDe(c, tx)}</dd></div>
                      </dl>
                      {g.ir && (
                        <Link href={`${g.ir.ruta ?? ''}${sufijo}${g.ir.ancla ?? ''}`} className="rv-cd__enlace">{tx('f26d2.pre.ir')}</Link>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </Tarjeta>
    </section>
  );
}

/** Lo medido, en llano. El detalle de las plantillas lista nombres internos: se reemplaza por la cuenta, que es lo que importa. */
function textoPaso(c: Comprobacion, tx: TAgentes): string {
  if (c.id === 'plantillas' && c.estado === 'falta') {
    const m = /(\d+)\s+de\s+(\d+)\s+plantillas/.exec(c.detalle);
    if (m) return tx('f26d2.pre.plantillas_faltan', { faltan: m[1], total: m[2] });
  }
  return lenguajeLlano(c.detalle) || tx('f26d2.pre.sin_detalle');
}

function pideDe(c: Comprobacion, tx: TAgentes): string {
  if (c.id === 'plantillas') return tx('f26d2.pre.plantillas_pide');
  if (c.id === 'cohorte') return tx('f26d2.pre.cohorte_pide');
  return lenguajeLlano(c.queHacer ?? '') || tx('f26d2.pre.sin_detalle');
}

/** El aviso del tablero: solo aparece si hay algo en rojo. Todo en verde (o sin lectura) = no se pinta nada. */
export function BannerPreflight({ preflight, sufijo = '', tr = TR_ES }: { preflight: ResultadoPreflight | null; sufijo?: string; tr?: TrAgentes }) {
  const { t: tx } = tr;
  if (preflight === null || preflight.lista) return null;
  const n = preflight.bloqueos.length;
  return (
    <AvisoCompacto tono="warn" resumen={
      <>{tx('rest.la_flota_aun_no_esta_lista')}{' '}{n === 1 ? 'falta 1 cosa' : `faltan ${n} cosas`}{ricoT(tx('rest.e0_ver_que_falta_e0', { detalle: lenguajeLlano(preflight.bloqueos[0].detalle) }), { e0: (c) => <Link href={`/dashboard/agentes/conductores/configuracion${sufijo}#cfg-preflight`} className="rv-cd__enlace">{c}</Link> })}</>
    } />
  );
}
