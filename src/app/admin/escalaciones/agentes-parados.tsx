import { Aviso, BotonEnlace, EstadoVacio, TablaBase, type ColumnaBase } from '@/app/ui-v2/componentes';
import type { AgenteParado, AgentesParados } from '@/lib/admin/agentes-parados';
import type { ResumenBandejaCola } from '@/lib/admin/cola-aprobacion';
import { fechaHoraMx, numero } from '@/lib/formato';
import '../bandeja.css';

import type { TrDe } from '@/lib/i18n/tr_tipos';
import { trAdminInicioEs } from '@/lib/i18n/tr_admin';
/** Cuántas filas se listan; el conteo de arriba es de TODOS los parados y se dice. */
export const TOPE_PARADOS = 50;

/** La causa estable del runner (`CausaSalto`) en palabras. Una causa desconocida se muestra tal cual, nunca se suaviza. */
const causa = (t: TrDe<'admin_inicio'>): Record<string, string> => ({
  contrapresion_bandeja: t('escalaciones_agentes_parados.frenado_por_la_bandeja'),
  reloj: t('escalaciones_agentes_parados.cortado_por_el_reloj'),
  apagado: t('escalaciones_agentes_parados.apagado_palanca'),
  sin_presupuesto: t('escalaciones_agentes_parados.sin_presupuesto_diario_declarado'),
  techo_diario: t('escalaciones_agentes_parados.llego_a_su_techo'),
  costo_no_medido: t('escalaciones_agentes_parados.costo_no_medido'),
  pausa_por_fallos: t('escalaciones_agentes_parados.en_pausa_por_fallos'),
  lectura_fallida: t('escalaciones_agentes_parados.no_se_pudo_leer'),
  experimental: t('parados.experimental'),
  sin_motor: t('escalaciones_agentes_parados.sin_motor_despachable'),
  otra: t('escalaciones_agentes_parados.otra_causa'),
});
export const etiquetaCausa = (c: string | null, t: TrDe<'admin_inicio'>): string | null => (c === null ? null : (causa(t)[c] ?? c));

function haceHoras(h: number | null, t: TrDe<'admin_inicio'>): string {
  if (h === null) return t('parados.nunca_ha_corrido_min');
  if (h < 48) return t('turno.hace_horas', { n: numero(h) });
  return t('turno.hace_dias', { n: numero(Math.floor(h / 24)) });
}

/** Pura. Cuántos parados hay por causa (los sin motivo cuentan aparte: «sin dato», no una causa inventada). */
export function contarPorCausa(parados: ReadonlyArray<AgenteParado>): { causa: string | null; n: number }[] {
  const m = new Map<string | null, number>();
  for (const p of parados) m.set(p.causa, (m.get(p.causa) ?? 0) + 1);
  return [...m.entries()].map(([causa, n]) => ({ causa, n })).sort((a, b) => b.n - a.n);
}

/**
 * «Agentes que no corrieron y por qué» (auditoría admin, P0 de visibilidad). Lee `getAgentesParados` (catálogo + última corrida +
 * saltados del último latido del runner). Lectura caída = se dice, NO «ningún agente parado». NO toca `LIKIDA_RUNNER_TOPE_BANDEJA_GLOBAL`:
 * la contrapresión es un freno correcto y aquí solo se hace visible, con la salida legítima (resolver la bandeja) enlazada.
 */
export function BloqueAgentesParados({ datos, cola, t = trAdminInicioEs, resumen = false, tope = TOPE_PARADOS }: {
  datos: AgentesParados | null; cola: ResumenBandejaCola | null; t?: TrDe<'admin_inicio'>;
  /** Solo el aviso con el conteo por causa y la salida a Escalaciones: la tabla completa vive en una sola página (no se repite en tres). */
  resumen?: boolean;
  /** Cuántas filas se listan en la tabla (el conteo sigue siendo de todos los parados y se dice). */
  tope?: number;
}) {
  const titulo = <h2 className="bj-titulo" id="agentes-parados">{t('escalaciones_agentes_parados.agentes_que_no_corrieron')}</h2>;
  if (datos === null) {
    return (
      <section className="bj-bloque" aria-labelledby="agentes-parados">
        {titulo}
        <Aviso tono="warn">
          
          {t('escalaciones_agentes_parados.no_se_pudo_leer_2')}
        </Aviso>
      </section>
    );
  }
  const { parados, habilitados, umbralHoras } = datos;
  if (parados.length === 0) {
    return (
      <section className="bj-bloque" aria-labelledby="agentes-parados">
        {titulo}
        <EstadoVacio titulo={t('escalaciones_agentes_parados.ningun_agente_parado')}>
          {habilitados === 0
            ? t('escalaciones_agentes_parados.no_hay_agentes_vivos')
            : t('escalaciones_agentes_parados.los_agentes_habilitados_corrieron', { habilitados: numero(habilitados), umbralHoras: numero(umbralHoras) })}
        </EstadoVacio>
      </section>
    );
  }
  const filas = parados.slice(0, tope);
  const columnas: ColumnaBase<AgenteParado>[] = [
    { id: 'agente', titulo: t('escalaciones_agentes_parados.agente'), principal: true, celda: (p) => p.nombre ?? p.agente },
    {
      id: 'ultima', titulo: t('escalaciones_agentes_parados.ultima_corrida'),
      celda: (p) => (p.ultimaCorrida ? `${fechaHoraMx(p.ultimaCorrida)} · ${haceHoras(p.horasSinCorrer, t)}` : t('escalaciones_agentes_parados.nunca_ha_corrido')),
    },
    {
      id: 'motivo', titulo: t('escalaciones_agentes_parados.por_que'),
      celda: (p) => (p.causa === null && p.motivo === null
        ? (datos.latidoDelRunner === null
          ? t('escalaciones_agentes_parados.sin_dato_no_se')
          : t('escalaciones_agentes_parados.sin_dato_no_figura'))
        : <>{etiquetaCausa(p.causa, t)}{p.motivo ? <span className="bj-nota"> {p.motivo}</span> : null}</>),
    },
  ];
  const porCausa = contarPorCausa(parados);
  return (
    <section className="bj-bloque" aria-labelledby="agentes-parados">
      {titulo}
      <Aviso tono="warn">
        {t('parados.resumen_llevan', { n: numero(parados.length), habilitados: numero(habilitados), umbral: numero(umbralHoras) })}{' '}
        {t('parados.por_causa', { causas: porCausa.map((c) => `${etiquetaCausa(c.causa, t) ?? t('turno.sin_dato_del_motivo')} (${numero(c.n)})`).join(' · ') })}
      </Aviso>
      {cola?.frenaAlRunner && (
        <Aviso
          tono="error"
          titulo="La bandeja de aprobación está frenando a los agentes."
          acciones={<BotonEnlace href="/admin/aprobaciones" variante="secondary" tamano="sm">Ir a Aprobaciones</BotonEnlace>}
        >
          {t('parados.piezas_pendientes', { n: numero(cola.pendientes) })}
          {cola.diasMasVieja !== null ? t('parados.mas_vieja', { dias: numero(Math.floor(cola.diasMasVieja)) }) : ''}
          {t('parados.tope_runner')}
        </Aviso>
      )}
      {resumen ? (
        <p className="bj-nota">
          <BotonEnlace href="/admin/escalaciones#agentes-parados" variante="ghost" tamano="sm">{t('parados.ver_todos_en_escalaciones')}</BotonEnlace>
        </p>
      ) : (
        <>
          <TablaBase etiqueta="Agentes que no corrieron" columnas={columnas} filas={filas} idFila={(p) => p.agente} densa />
          <p className="bj-nota">
        {parados.length > tope
          ? t('parados.se_listan', { tope: numero(tope), total: numero(parados.length) })
          : ''}
        {t('parados.motivo_ultima_vuelta', { latido: datos.latidoDelRunner ? ` (${fechaHoraMx(datos.latidoDelRunner)})` : '' })}
          </p>
        </>
      )}
    </section>
  );
}
