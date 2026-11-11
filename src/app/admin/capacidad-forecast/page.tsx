import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { getResumenNegocio, costoIaPorDiaDesde } from '@/lib/admin/negocio';
import { getUnidadesMedidas, escenarioDe, ESCENARIOS_VIAJES_DIA, SUPUESTOS_CAPACIDAD, LIMITES_NOMINALES } from '@/lib/admin/capacidad';
import { ahoraMs } from '@/lib/saludo';
import { numero } from '@/lib/formato';
import { usd } from '@/lib/utils';
import { proyectarCosto } from './proyeccion';
import { BarraFiltros, EstadoVacio, FiltroOpciones, StatusChip, TablaBase, Tarjeta, type ColumnaBase } from '../../ui-v2/componentes';
import { AreaMini, type PropsCifra } from '../../ui-v2/graficas';
import { uniformes } from '../cifras-uniformes';
import { observadas } from '../sello-observado';
import { EsqueletoPanelCifras } from '../../ui-v2/esqueletos';
import { getT } from '@/lib/i18n/servidor';
import { type TSistema, T_SISTEMA_ES } from '@/lib/i18n/sistema_tr';
import type { Idioma } from '@/lib/i18n/idioma';
import '../resumen.css';

export const dynamic = 'force-dynamic';

const HORIZONTES = ['7', '14', '30'] as const;

export default async function CapacidadForecastPage({ searchParams }: { searchParams?: Promise<{ h?: string }> }) {
  const { t, tp, idioma } = await getT('admin_sistema');
  // A37-S05-01/S06-01: puerta propia; el layout puede no ejecutarse en una petición RSC parcial.
  await requireSuperadmin();
  // El horizonte de la proyección (días de historia que se promedian): 7, 14 o 30 (por omisión). Vive en la URL.
  const pedido = (await searchParams)?.h ?? '30';
  const horizonte = Number((HORIZONTES as readonly string[]).includes(pedido) ? pedido : '30');
  const r = await getResumenNegocio();
  // A37-S05-03: ventana REAL de 30 días (UTC, como la serie) y costo sin redondear.
  // Día UTC A PROPÓSITO (no «hoy» de México): `porDia` viene de la agregación SQL por día UTC y la ventana tiene que casar con sus cubetas.
  const ahoraIso = new Date(ahoraMs()).toISOString();
  const hoyUtc = ahoraIso.slice(0, 10);
  let enVentana: Array<{ dia: string; costoUsd: number }> | null = null;
  try {
    enVentana = await costoIaPorDiaDesde(new Date(new Date(`${hoyUtc}T00:00:00Z`).getTime() - (horizonte - 1) * 86_400_000).toISOString());
  } catch { enVentana = null; }
  const proyeccion = enVentana === null ? null : proyectarCosto(r.porDia, enVentana, hoyUtc, horizonte);
  // El modelo de capacidad (fase 7): unidades MEDIDAS si hay muestra; si la
  // lectura falla, la sección lo dice — jamás un escenario con base fantasma.
  let unidades: Awaited<ReturnType<typeof getUnidadesMedidas>> | null = null;
  try { unidades = await getUnidadesMedidas(ahoraMs()); } catch { unidades = null; }

  // La tira se pinta siempre con cuatro celdas (Rovaq): lo que no tiene base dice «sin dato» y por qué, nunca 0.
  const sinProy = { valor: null, estado: 'vacio' as const, mensaje: enVentana === null ? t('capacidad_forecast.sin_lectura') : t('capacidad_forecast.sin_datos') };
  const cifras: PropsCifra[] = uniformes([
    proyeccion === null
      ? { etiqueta: t('capacidad_forecast.costo_diario_promedio_corto'), ...sinProy }
      : { etiqueta: tp('capacidad_forecast.costo_diario_promedio', proyeccion.diasVentana), valor: usd(proyeccion.promedioDiario) },
    proyeccion === null
      ? { etiqueta: t('capacidad_forecast.proyeccion_a_30_dias'), ...sinProy }
      : { etiqueta: t('capacidad_forecast.proyeccion_a_30_dias'), valor: usd(proyeccion.proyeccionMensual), tipo: 'estimado' as const },
    unidades === null
      ? { etiqueta: t('capacidad_forecast.costo_ia_por_viaje'), valor: null, estado: 'error' as const, mensaje: t('capacidad_forecast.no_se_pudieron_leer_las_unidades') }
      : unidades.costoIaPorViaje === null
        ? { etiqueta: t('capacidad_forecast.costo_ia_por_viaje'), valor: null, estado: 'vacio' as const, mensaje: t('capacidad_forecast.sin_base_medida') }
        : { etiqueta: t('capacidad_forecast.costo_ia_por_viaje'), valor: usd(unidades.costoIaPorViaje) },
    unidades === null
      ? { etiqueta: t('capacidad_forecast.viajes_en_la_muestra'), valor: null, estado: 'error' as const, mensaje: t('capacidad_forecast.no_se_pudieron_leer_las_unidades') }
      : { etiqueta: t('capacidad_forecast.viajes_en_la_muestra'), valor: unidades.muestraViajes, formato: 'entero' as const },
  ]);

  return (
    <EsqueletoPanelCifras
      titulo={t('capacidad_forecast.capacidad_forecast')}
      cifras={observadas(cifras, t('a1r4.observado'))}
      variante="12"
      filtros={(
        <BarraFiltros accion="/admin/capacidad-forecast" enLinea etiqueta={t('capacidad_forecast.filtros_proyeccion')} nActivos={horizonte !== 30 ? 1 : 0} limpiarHref="/admin/capacidad-forecast">
          <FiltroOpciones etiqueta={t('capacidad_forecast.horizonte')} valor={String(horizonte)} porDefecto="30" nombre="h"
            opciones={HORIZONTES.map((h) => ({ valor: h, rotulo: t('capacidad_forecast.dias_horizonte', { n: h }), href: h === '30' ? '/admin/capacidad-forecast' : `/admin/capacidad-forecast?h=${h}` }))} />
        </BarraFiltros>
      )}
      graficas={[
        // La gráfica de proyección SIEMPRE está en su tarjeta (sin lectura o sin datos lo dice dentro, no suelto sobre el lienzo) y va sellada «Estimado».
        <Tarjeta key="costo" titulo={t('capacidad_forecast.costo_de_ia_por_dia')}
          acciones={<StatusChip tono="muted">{t('capacidad_forecast.estimado')}</StatusChip>}
          estado={enVentana === null ? 'error' : proyeccion === null ? 'vacio' : 'ok'}
          mensaje={enVentana === null ? t('capacidad_forecast.no_se_pudo_leer_el_costo') : t('capacidad_forecast.sin_datos')}
          detalle={t('capacidad_forecast.sin_datos_de_costo_de_ia')}>
          {proyeccion !== null ? (
            <>
              {r.porDia.length > 1 ? (
                <AreaMini valores={r.porDia.slice(-horizonte).map((d) => d.costoUsd)} etiquetas={r.porDia.slice(-horizonte).map((d) => d.dia)} formato="usd" etiqueta={t('capacidad_forecast.costo_de_ia_por_dia_usd')} />
              ) : (
                <EstadoVacio titulo={t('capacidad_forecast.sin_datos')} contenido>{t('capacidad_forecast.sin_historial_suficiente_todavia_para_una')}</EstadoVacio>
              )}
              <p className="m-0 mt-3 text-xs text-muted">{t('capacidad_forecast.proyeccion_simple_costo_diario_promedio_30')}{proyeccion.diasVentana < 7 && t('capacidad_forecast.con_tan_poca_historia_esta_cifra')}
              </p>
            </>
          ) : null}
        </Tarjeta>,
      ]}
    >
      {/* ── EL MODELO DE CAPACIDAD (fase 7): escenarios con supuestos A LA VISTA. Las unidades salen de lo medido cuando hay
            muestra; los límites de proveedor son nominales y se dice. ── */}
      <Tarjeta titulo={t('capacidad_forecast.modelo_de_capacidad_escenarios_de_escala')}>
        {unidades === null ? (
          <p className="m-0 text-[13px] text-muted">{t('capacidad_forecast.no_se_pudieron_leer_las_unidades')}</p>
        ) : (
          <>
            <p className="m-0 mb-3 text-[13px] text-muted">
              {unidades.costoIaPorViaje !== null
                ? <>{t('capacidad_forecast.costo_de_ia_medido_por_viaje', { usd: usd(unidades.costoIaPorViaje), numero: numero(unidades.muestraViajes, idioma) })}{unidades.muestraViajes < 30 ? t('capacidad_forecast.muestra_chica_apenas_indicativo') : ''}).</>
                : <>{t('capacidad_forecast.sin_liquidaciones_en_30d_el_costo')}</>}
            </p>
            <TablaBase tarjetaMovil
              etiqueta={t('capacidad_forecast.proyeccion_de_capacidad_por_escenario')}
              columnas={columnasEscenario(unidades.costoIaPorViaje, t, idioma)}
              filas={ESCENARIOS_VIAJES_DIA}
              idFila={(v) => String(v)}
              altoMaximo={false}
            />
            <p className="m-0 mt-3 text-xs text-muted">{t('capacidad_forecast.supuestos_declarados_mensajes_y_comprobantes_por', { mensajesPorViaje: SUPUESTOS_CAPACIDAD.mensajesPorViaje, comprobantesPorViaje: SUPUESTOS_CAPACIDAD.comprobantesPorViaje, Math: Math.round(SUPUESTOS_CAPACIDAD.bytesPorComprobante / 1000), llamadasLlmPorViaje: SUPUESTOS_CAPACIDAD.llamadasLlmPorViaje, horasPicoDia: SUPUESTOS_CAPACIDAD.horasPicoDia })}</p>
            <div className="mt-3 border-t border-[var(--line)] pt-3">
              <p className="etiqueta-mono m-0 mb-1 text-[11px] uppercase text-muted">{t('capacidad_forecast.limites_nominales_del_proveedor_documentacion_no')}</p>
              {LIMITES_NOMINALES.map((l) => (
                <p key={l.recurso} className="m-0 text-[12px] text-muted">· {l.recurso}: {l.limite} <span>({l.fuente})</span></p>
              ))}
            </div>
          </>
        )}
      </Tarjeta>
    </EsqueletoPanelCifras>
  );
}

/** Columnas de la tabla de escenarios: cada fila es un volumen de viajes/día y el resto sale de `escenarioDe`. */
function columnasEscenario(costoIaPorViaje: number | null, t: TSistema = T_SISTEMA_ES, idioma?: Idioma): ColumnaBase<number>[] {
  return [
    { id: 'viajes', titulo: t('capacidad_forecast.viajes_dia'), principal: true, celda: (v) => numero(v, idioma) },
    { id: 'wa', titulo: t('capacidad_forecast.mensajes_wa_dia'), alinear: 'der', celda: (v) => numero(escenarioDe(v, costoIaPorViaje).mensajesDia, idioma) },
    { id: 'pico', titulo: t('capacidad_forecast.pico_msg_min'), alinear: 'der', celda: (v) => numero(escenarioDe(v, costoIaPorViaje).mensajesMinPico, idioma) },
    { id: 'llm', titulo: t('capacidad_forecast.llamadas_llm_dia'), alinear: 'der', celda: (v) => numero(escenarioDe(v, costoIaPorViaje).llamadasLlmDia, idioma) },
    {
      id: 'costo', titulo: t('capacidad_forecast.costo_ia_dia'), alinear: 'der',
      celda: (v) => {
        const c = escenarioDe(v, costoIaPorViaje).costoIaDiaUsd;
        return c === null ? <span className="text-muted">{t('capacidad_forecast.sin_base_medida')}</span> : usd(c);
      },
    },
    { id: 'storage', titulo: t('capacidad_forecast.storage_dia'), alinear: 'der', celda: (v) => `${numero(escenarioDe(v, costoIaPorViaje).storageDiaMb, idioma)} MB` },
  ];
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_sistema');
  return { title: t('capacidad_forecast.capacidad_forecast') };
}
