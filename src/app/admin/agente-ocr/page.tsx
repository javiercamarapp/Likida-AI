import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSuperadmin } from '@/lib/auth/guard';
import { getResumenNegocio, getCostoPorFaseModelo } from '@/lib/admin/negocio';
import { leerUltimasLecturas } from '@/lib/admin/qa-storage';
import { agregar, agregarPorCampo, type Agregado, type AgregadoPorCampo } from '@/lib/admin/qa-verdad';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { numero } from '@/lib/formato';
import { MarcoPagina, FilaTarjetas, Tarjeta, Aviso, BotonEnlace } from '@/app/ui-v2/componentes';
import { TiraCifras, Columnas } from '@/app/ui-v2/graficas';
import { TarjetaFase } from '../tarjeta-fase';

import { getT } from '@/lib/i18n/servidor';
export const dynamic = 'force-dynamic';

/**
 * Agente OCR: la fase que lee la foto de un comprobante (diésel, caseta, factura) y extrae monto, folio y CFDI. Todo real:
 * `llm_costo` filtrado por la fase `ocr` y `gasto` para el histórico de facturas. La precisión se mide contra el banco de verdad
 * con las MISMAS funciones que el panel de Calidad › Pruebas reales; su lectura cae por separado y se dice («no se pudo leer»
 * no es «no hay medición»).
 */
export default async function AgenteOcrPage() {
  const { t } = await getT('admin_agentes');
  await requireSuperadmin();
  const [r, porFaseModelo] = await Promise.all([getResumenNegocio(), getCostoPorFaseModelo()]);
  const lecturas = await leerUltimasLecturas(supabaseAdmin()).catch((e) => ({ ok: false as const, error: String(e) }));
  let precision: { global: Agregado; porCampo: AgregadoPorCampo[]; fotos: number } | null = null;
  if (lecturas.ok) {
    const mediciones = [...lecturas.datos.values()].map((l) => l.medicion);
    precision = { global: agregar(mediciones), porCampo: agregarPorCampo(mediciones), fotos: mediciones.length };
  }
  // `exactitud: null` es «sin medir», no 0 %, y no compite en el ranking de los peores campos.
  const peores = precision === null
    ? []
    : precision.porCampo.filter((c): c is AgregadoPorCampo & { exactitud: number } => c.exactitud !== null).sort((a, b) => a.exactitud - b.exactitud).slice(0, 3);
  const pct = (x: number) => `${Math.round(x * 100)} %`;
  const ocr = r.porFase.find((f) => f.fase === 'ocr');
  const modelosOcr = porFaseModelo.filter((m) => m.fase === 'ocr');
  const desgloseSeparable = modelosOcr.length > 0;

  return (
    <MarcoPagina
      area="Agentes"
      titulo={t('agente_ocr.agentes')}
      apoyo={t('agente_ocr.ocr_la_lectura_de')}
      acciones={<BotonEnlace href="/admin/qa" variante="secondary" tamano="sm">{t('agente_ocr.medir_en_calidad')}</BotonEnlace>}
    >
      <TiraCifras
        etiqueta="OCR"
        items={[
          { etiqueta: t('agente_ocr.gastado_en_ocr'), valor: ocr ? ocr.costoUsd : 0, formato: 'usd', nota: t('agente_ocr.costo_medido_en_llm') },
          { etiqueta: t('agente_ocr.llamadas_de_ocr'), valor: ocr ? ocr.n : 0, formato: 'entero' },
          { etiqueta: t('agente_ocr.facturas_procesadas_historico'), valor: r.facturasTotal, formato: 'entero' },
          { etiqueta: t('agente_ocr.exactitud_global'), valor: precision === null ? null : precision.global.exactitud === null ? null : Math.round(precision.global.exactitud * 100), formato: 'porcentaje', estado: precision === null ? 'error' : precision.global.exactitud === null ? 'vacio' : 'ok', mensaje: precision === null ? undefined : t('agente_ocr.sin_medir_todavia'), nota: t('agente_ocr.contra_el_banco_de') },
        ]}
      />

      <FilaTarjetas variante="8-4">
        <Tarjeta titulo={t('agente_ocr.que_tan_bien_lee')} estado={precision === null ? 'error' : precision.global.exactitud === null ? 'vacio' : 'ok'}
          mensaje={precision === null ? t('agente_ocr.no_se_pudo_leer') : t('agente_ocr.el_ocr_todavia_no')}
          detalle={t('agente_ocr.sin_campos_medidos_no')}
          accionVacio={<BotonEnlace href="/admin/qa" variante="secondary" tamano="sm">{t('agente_ocr.abrir_calidad')}</BotonEnlace>}
        >
          {precision !== null && precision.global.exactitud !== null ? (
            <>
              <p>
                <strong>{pct(precision.global.exactitud)}</strong> de exactitud global: {numero(precision.global.medidos)} campos medidos sobre {numero(precision.fotos)}  {t('agente_ocr.fotos_ultima_lectura_de')}
              </p>
              {peores.length > 0 ? (
                <p>
                  
                  {t('agente_ocr.lo_que_peor_se')}{' '}
                  {peores.map((c, i) => (
                    <span key={c.clave}>{i > 0 && ' · '}<strong>{c.clave} {pct(c.exactitud)}</strong> ({numero(c.medidos)} {c.medidos === 1 ? t('agente_ocr.medicion') : 'mediciones'})</span>
                  ))}
                </p>
              ) : null}
              <p>El detalle por foto y el botón para volver a medir viven en <Link href="/admin/qa">Calidad › Pruebas reales</Link>.</p>
            </>
          ) : null}
        </Tarjeta>
        <TarjetaFase
          titulo={desgloseSeparable ? t('agente_ocr.costo_por_modelo_ocr') : t('agente_ocr.costo_por_modelo_todas')}
          queHace="Lee la foto de un comprobante y extrae monto, folio y CFDI."
          datos={ocr}
          modelos={desgloseSeparable ? modelosOcr : r.porModelo}
        />
      </FilaTarjetas>

      <Tarjeta titulo={t('agente_ocr.facturas_procesadas_ultimos_7')} estado={r.facturasPorDia.some((d) => d.n > 0) ? 'ok' : 'vacio'} mensaje={t('agente_ocr.sin_facturas_en_7')} detalle={t('agente_ocr.aparecen_cuando_una_flota')}>
        <Columnas etiqueta={t('agente_ocr.facturas_procesadas_por_dia')} datos={r.facturasPorDia.map((d) => ({ etiqueta: d.dia, valor: d.n }))} formato="numero" />
      </Tarjeta>

      {!desgloseSeparable ? <Aviso tono="info">{t('agente_ocr.el_costo_por_modelo')}</Aviso> : null}
    </MarcoPagina>
  );
}

export const metadata: Metadata = { title: 'OCR' };
