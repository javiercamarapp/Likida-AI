import type { Metadata } from 'next';
import { requireSuperadmin } from '@/lib/auth/guard';
import { getResumenNegocio, costoIaPorDiaDesde } from '@/lib/admin/negocio';
import { getUnidadesMedidas, escenarioDe, ESCENARIOS_VIAJES_DIA, SUPUESTOS_CAPACIDAD, LIMITES_NOMINALES } from '@/lib/admin/capacidad';
import { ahoraMs } from '@/lib/saludo';
import { numero } from '@/lib/formato';
import { usd } from '@/lib/utils';
import { proyectarCosto } from './proyeccion';
import { AreaChartSimple } from '../charts';
import { EstadoVacio, MarcoPagina, TablaBase, Tarjeta, type ColumnaBase } from '../../ui-v2/componentes';
import { Cifra, TiraCifras } from '../../ui-v2/graficas';
import { getT } from '@/lib/i18n/servidor';
import { type TSistema, T_SISTEMA_ES } from '@/lib/i18n/sistema_tr';
import type { Idioma } from '@/lib/i18n/idioma';

export const dynamic = 'force-dynamic';

export default async function CapacidadForecastPage() {
  const { t, tp, idioma } = await getT('admin_sistema');
  // A37-S05-01/S06-01: puerta propia; el layout puede no ejecutarse en una petición RSC parcial.
  await requireSuperadmin();
  const r = await getResumenNegocio();
  // A37-S05-03: ventana REAL de 30 días (UTC, como la serie) y costo sin redondear.
  // Día UTC A PROPÓSITO (no «hoy» de México): `porDia` viene de la agregación SQL por día UTC y la ventana tiene que casar con sus cubetas.
  const ahoraIso = new Date(ahoraMs()).toISOString();
  const hoyUtc = ahoraIso.slice(0, 10);
  let enVentana: Array<{ dia: string; costoUsd: number }> | null = null;
  try {
    enVentana = await costoIaPorDiaDesde(new Date(new Date(`${hoyUtc}T00:00:00Z`).getTime() - 29 * 86_400_000).toISOString());
  } catch { enVentana = null; }
  const proyeccion = enVentana === null ? null : proyectarCosto(r.porDia, enVentana, hoyUtc);
  // El modelo de capacidad (fase 7): unidades MEDIDAS si hay muestra; si la
  // lectura falla, la sección lo dice — jamás un escenario con base fantasma.
  let unidades: Awaited<ReturnType<typeof getUnidadesMedidas>> | null = null;
  try { unidades = await getUnidadesMedidas(ahoraMs()); } catch { unidades = null; }

  return (
    <MarcoPagina titulo={t('capacidad_forecast.capacidad_forecast')}>
      {enVentana === null ? (
        <EstadoVacio titulo={t('capacidad_forecast.sin_lectura')}>{t('capacidad_forecast.no_se_pudo_leer_el_costo')}</EstadoVacio>
      ) : proyeccion === null ? (
        <EstadoVacio titulo={t('capacidad_forecast.sin_datos')}>{t('capacidad_forecast.sin_datos_de_costo_de_ia')}</EstadoVacio>
      ) : (
        <>
          <TiraCifras>
            <Cifra
              etiqueta={tp('capacidad_forecast.costo_diario_promedio', proyeccion.diasVentana)}
              valor={usd(proyeccion.promedioDiario)}
            />
            <Cifra etiqueta={t('capacidad_forecast.proyeccion_a_30_dias')} valor={usd(proyeccion.proyeccionMensual)} />
          </TiraCifras>

          <Tarjeta titulo={t('capacidad_forecast.costo_de_ia_por_dia')}>
            {r.porDia.length > 1 ? (
              <AreaChartSimple datos={r.porDia.map((d) => ({ dia: d.dia, valor: d.costoUsd }))} etiquetaValor={(v) => usd(v)} etiquetaSerie={t('capacidad_forecast.costo_de_ia_por_dia_usd')} />
            ) : (
              <p className="m-0 flex h-40 items-center text-sm text-muted">{t('capacidad_forecast.sin_historial_suficiente_todavia_para_una')}</p>
            )}
            <p className="m-0 mt-3 text-xs text-muted">{t('capacidad_forecast.proyeccion_simple_costo_diario_promedio_30')}{proyeccion.diasVentana < 7 && t('capacidad_forecast.con_tan_poca_historia_esta_cifra')}
            </p>
          </Tarjeta>
        </>
      )}

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
            <TablaBase
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
    </MarcoPagina>
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
