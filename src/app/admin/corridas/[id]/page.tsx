import { uniformes } from '@/app/admin/cifras-uniformes';
import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { notFound } from 'next/navigation';
import { trazaDeCorrida, type TrazaCorrida } from '@/lib/admin/corridas-cruzadas';
import { fechaHoraMx, numero } from '@/lib/formato';
import { usd } from '@/lib/utils';
import { valorLegible } from '../../valor-legible';
import { Aviso, BotonEnlace, EstadoError, StatusChip, Tarjeta, type TonoEstado } from '../../../ui-v2/componentes';
import type { ComponentProps } from 'react';
import { EsqueletoFicha } from '../../../ui-v2/esqueletos';
import { etiquetaContadorVigia, etiquetaInterruptor } from '../../observabilidad/etiquetas';
import '../../sistema.css';
import { getT } from '@/lib/i18n/servidor';
import { type TSistema, T_SISTEMA_ES } from '@/lib/i18n/sistema_tr';
import { rico } from '@/lib/i18n/rico';

export const dynamic = 'force-dynamic';

const chipTr = (t: TSistema = T_SISTEMA_ES): Record<string, { tono: TonoEstado; etiqueta: string }> => ({
  ok: { tono: 'ok', etiqueta: 'OK' },
  parcial: { tono: 'warn', etiqueta: t('observabilidad.parcial') },
  fallo: { tono: 'bad', etiqueta: t('observabilidad.fallo') },
});

const disparo = (t: TSistema = T_SISTEMA_ES): Record<string, string> => ({
  cron: t('corridas_id.programado'),
  manual: t('corridas_id.manual_ejecutar_ahora'),
  correo: t('corridas_id.por_correo_entrante'),
  whatsapp: t('corridas_id.confirmado_por_whatsapp'),
});

function duracion(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 60_000) return `${Math.round(ms / 100) / 10} s`;
  return `${Math.round(ms / 6_000) / 10} min`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * LA TRAZA DE UNA CORRIDA — misma anatomía que
 * /admin/soporte: una fila de `agente_corrida` (0102) abierta con todo lo
 * que se puede AFIRMAR de ella: agente, flota, estado, duración, tareas, su
 * resumen, su error redactado, y el costo de IA de esa flota EN LA VENTANA
 * de la corrida.
 *
 * El costo es CORRELACIÓN POR TIEMPO, no un join: `llm_costo` no tiene
 * `corrida_id` y no se le inventa — la cifra se rotula "en la ventana", con
 * su supuesto a la vista (ver corridas-cruzadas.ts). `requireSuperadmin()`
 * ya lo hizo el layout de /admin.
 */
export default async function TrazaCorridaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { t, idioma } = await getT('admin_sistema');
  // A37-S05-01/S06-01: puerta propia; el layout puede no ejecutarse en una petición RSC parcial.
  await requireSuperadmin();
  const { id } = await params;
  // Un id que ni siquiera es uuid es un 404, no un error de consulta.
  if (!UUID.test(id)) notFound();

  // Error DICHO, no tragado: una traza en blanco sobre una base caída afirmaría "esta corrida no dejó nada", que es lo contrario de una traza.
  let traza: TrazaCorrida | null | undefined;
  try {
    traza = await trazaDeCorrida(id);
  } catch {
    traza = undefined;
  }
  if (traza === null) notFound();

  const c = traza?.corrida;
  const chip = c ? (chipTr(t)[c.estado] ?? { tono: 'neutral' as TonoEstado, etiqueta: c.estado }) : null;
  const flota = c ? (c.tenantNombre ?? (c.tenantId === null ? t('observabilidad.likida_negocio') : '—')) : '—';
  const volver = { href: '/admin/corridas', etiqueta: t('corridas_id.volver_a_corridas') };
  const titulo = c ? t('corridas_id.traza', { agente: etiquetaInterruptor(`agente:${c.agente}`, t) }) : t('corridas_id.traza_de_la_corrida');
  const apoyo = c ? `${flota} · ${fechaHoraMx(c.inicio, idioma)}` : undefined;

  // Lectura caída: el MISMO esqueleto, sin cifras ni bloques (la lectura caída se dice, no se pinta como una traza vacía).
  if (traza === undefined || !c) {
    return (
      <PantallaCorrida titulo={titulo} apoyo={apoyo} volver={volver}>
        <EstadoError reintentar>{t('corridas_id.no_se_pudo_leer_la_corrida')}</EstadoError>
      </PantallaCorrida>
    );
  }

  const { costo, costoNoDisponible } = traza;
  const resumen = c.resumen ? Object.entries(c.resumen).map(([k, v]) => [etiquetaContadorVigia(k, t), valorLegible(v)] as const).filter((p): p is readonly [string, string] => p[1] !== null) : [];
  return (
    <PantallaCorrida
      titulo={titulo}
      apoyo={apoyo}
      volver={volver}
      chips={chip ? <li><StatusChip tono={chip.tono}>{chip.etiqueta}</StatusChip></li> : null}
      etiquetaCifras={t('corridas_id.la_corrida_en_cifras')}
      cifras={uniformes([
        // NULL ≠ 0: una corrida que no se mide en tareas dice «—», no 0/0.
        { etiqueta: t('observabilidad.tareas'), valor: c.tareasHechas !== null && c.tareasTotal !== null ? `${c.tareasHechas} de ${c.tareasTotal}` : null, estado: c.tareasHechas !== null && c.tareasTotal !== null ? 'ok' : 'vacio', mensaje: t('corridas_id.esta_corrida_no_mide_tareas') },
        { etiqueta: t('observabilidad.duracion'), valor: c.fin === null ? null : duracion(c.duracionMs), estado: c.fin === null ? 'vacio' : 'ok', mensaje: t('corridas_id.sin_fin_registrado') },
        costo
          ? { etiqueta: t('corridas_id.costo_de_ia_en_la_ventana'), valor: usd(costo.costoUsd), nota: t('corridas_id.correlacion_por_tiempo_no_un_cruce') }
          : { etiqueta: t('corridas_id.costo_de_ia_en_la_ventana'), valor: null, estado: 'vacio', mensaje: t('corridas_id.no_se_puede_correlacionar') },
      ])}
      /* El motivo YA redactado para una persona — nunca el stack. */
      avisos={c.error ? <Aviso tono="error" titulo={t('corridas_id.por_que_fallo')}>{c.error}</Aviso> : null}
      bloques={[
        <Tarjeta key="corrida" titulo={t('corridas_id.la_corrida')}>
          <ul className="adm-sis-lista">
            <li>{rico(t('corridas_id.e0_agente_e0'), { e0: (x) => <span>{x}</span> })}<span>{etiquetaInterruptor(`agente:${c.agente}`, t)}</span></li>
            <li>{rico(t('corridas_id.e0_flota_e0'), { e0: (x) => <span>{x}</span> })}<span>{flota}</span></li>
            <li>{rico(t('corridas_id.e0_disparo_e0'), { e0: (x) => <span>{x}</span> })}<span>{disparo(t)[c.disparo] ?? c.disparo}</span></li>
            <li>{rico(t('corridas_id.e0_inicio_e0'), { e0: (x) => <span>{x}</span> })}<span>{fechaHoraMx(c.inicio, idioma)}</span></li>
            <li><span>{t('corridas_id.fin')}</span><span>{c.fin ? fechaHoraMx(c.fin, idioma) : t('corridas_id.sin_fin_registrado_2')}</span></li>
          </ul>
          {resumen.length > 0 ? (
            <>
              <h3 className="adm-sis-titulo">{t('corridas_id.resumen_de_la_corrida')}</h3>
              <ul className="adm-sis-lista">
                {resumen.map(([k, v]) => <li key={k}><span>{k}</span><span className="adm-sis-dato">{v}</span></li>)}
              </ul>
            </>
          ) : null}
        </Tarjeta>,
        /* ── El costo de IA, con su supuesto a la vista ── */
        <Tarjeta key="costo" titulo={t('corridas_id.costo_de_ia_en_la_ventana_2')} estado={costo ? 'ok' : 'vacio'} mensaje={t('corridas_id.no_se_puede_correlacionar_2')} detalle={costoNoDisponible ?? t('corridas_id.el_costo_de_esta_corrida_no')}>
          {costo ? (
            <>
              <ul className="adm-sis-lista">
                <li>{rico(t('corridas_id.e0_llamadas_al_modelo_e0'), { e0: (x) => <span>{x}</span> })}<span>{numero(costo.llamadas, idioma)}</span></li>
                <li>{rico(t('corridas_id.e0_tokens_entrada_salida_e0_e1', { numero: numero(costo.tokensIn, idioma), numero2: numero(costo.tokensOut, idioma) }), { e0: (x) => <span>{x}</span>, e1: (x) => <span>{x}</span> })}</li>
                <li>{rico(t('corridas_id.e0_costo_e0'), { e0: (x) => <span>{x}</span> })}<span>{usd(costo.costoUsd)}</span></li>
              </ul>
              <p className="adm-sis-nota">{t('corridas_id.cifra_honesta_con_su_supuesto_son')}</p>
            </>
          ) : null}
        </Tarjeta>,
      ]}
    >
      {/* ── A dónde seguir desde aquí ── */}
      <Tarjeta titulo={t('corridas_id.seguir_la_pista')}>
        <div className="adm-sis-acciones">
          {c.tenantId !== null ? (
            <BotonEnlace href={`/dashboard?tenant=${c.tenantId}&rol=flota_admin`} variante="secondary" tamano="sm">{t('corridas_id.abrir_el_panel_de_esta_flota')}</BotonEnlace>
          ) : null}
          <BotonEnlace href="/admin/conversaciones" variante="secondary" tamano="sm">{t('whatsapp_infra.conversaciones_de_whatsapp')}</BotonEnlace>
        </div>
        <p className="adm-sis-nota">{t('corridas_id.abrir_el_panel_de_una_flota', { flota })}</p>
      </Tarjeta>
    </PantallaCorrida>
  );
}

function PantallaCorrida(props: ComponentProps<typeof EsqueletoFicha>) {
  // La cifra sin dato conserva la escala de la tira (26/700), como Rovaq: `adm-escala-kpi` (sistema.css) solo cambia el tamaño del «—».
  return <div className="adm-escala-kpi"><EsqueletoFicha {...props} /></div>;
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_sistema');
  return { title: t('qa_pantalla.corrida') };
}
