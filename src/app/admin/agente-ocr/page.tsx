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

export const dynamic = 'force-dynamic';

/**
 * Agente OCR: la fase que lee la foto de un comprobante (diésel, caseta, factura) y extrae monto, folio y CFDI. Todo real:
 * `llm_costo` filtrado por la fase `ocr` y `gasto` para el histórico de facturas. La precisión se mide contra el banco de verdad
 * con las MISMAS funciones que el panel de Calidad › Pruebas reales; su lectura cae por separado y se dice («no se pudo leer»
 * no es «no hay medición»).
 */
export default async function AgenteOcrPage() {
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
      titulo="Agentes"
      apoyo="OCR: la lectura de comprobantes: monto, folio y CFDI. Costo real, histórico, y qué tan bien lee."
      acciones={<BotonEnlace href="/admin/qa" variante="secondary" tamano="sm">Medir en Calidad</BotonEnlace>}
    >
      <TiraCifras
        etiqueta="OCR"
        items={[
          { etiqueta: 'Gastado en OCR', valor: ocr ? ocr.costoUsd : 0, formato: 'usd', nota: 'Costo medido en llm_costo' },
          { etiqueta: 'Llamadas de OCR', valor: ocr ? ocr.n : 0, formato: 'entero' },
          { etiqueta: 'Facturas procesadas, histórico', valor: r.facturasTotal, formato: 'entero' },
          { etiqueta: 'Exactitud global', valor: precision === null ? null : precision.global.exactitud === null ? null : Math.round(precision.global.exactitud * 100), formato: 'porcentaje', estado: precision === null ? 'error' : precision.global.exactitud === null ? 'vacio' : 'ok', mensaje: precision === null ? undefined : 'Sin medir todavía', nota: 'Contra el banco de verdad' },
        ]}
      />

      <FilaTarjetas variante="8-4">
        <Tarjeta titulo="Qué tan bien lee" estado={precision === null ? 'error' : precision.global.exactitud === null ? 'vacio' : 'ok'}
          mensaje={precision === null ? 'No se pudo leer la medición de precisión, que no es lo mismo que «no hay medición».' : 'El OCR todavía no se ha medido'}
          detalle="Sin campos medidos no hay exactitud que reportar (esto NO es un 0%). La medición se corre en Calidad, contra fotos reales con verdad de terreno firmada."
          accionVacio={<BotonEnlace href="/admin/qa" variante="secondary" tamano="sm">Abrir Calidad</BotonEnlace>}
        >
          {precision !== null && precision.global.exactitud !== null ? (
            <>
              <p>
                <strong>{pct(precision.global.exactitud)}</strong> de exactitud global: {numero(precision.global.medidos)} campos medidos sobre {numero(precision.fotos)} fotos (última lectura de cada una).
              </p>
              {peores.length > 0 ? (
                <p>
                  Lo que peor se lee:{' '}
                  {peores.map((c, i) => (
                    <span key={c.clave}>{i > 0 && ' · '}<strong>{c.clave} {pct(c.exactitud)}</strong> ({numero(c.medidos)} {c.medidos === 1 ? 'medición' : 'mediciones'})</span>
                  ))}
                </p>
              ) : null}
              <p>El detalle por foto y el botón para volver a medir viven en <Link href="/admin/qa">Calidad › Pruebas reales</Link>.</p>
            </>
          ) : null}
        </Tarjeta>
        <TarjetaFase
          titulo={desgloseSeparable ? 'Costo por modelo, OCR' : 'Costo por modelo, todas las fases'}
          queHace="Lee la foto de un comprobante y extrae monto, folio y CFDI."
          datos={ocr}
          modelos={desgloseSeparable ? modelosOcr : r.porModelo}
        />
      </FilaTarjetas>

      <Tarjeta titulo="Facturas procesadas, últimos 7 días" estado={r.facturasPorDia.some((d) => d.n > 0) ? 'ok' : 'vacio'} mensaje="Sin facturas en 7 días" detalle="Aparecen cuando una flota manda comprobantes por WhatsApp.">
        <Columnas etiqueta="Facturas procesadas por día" datos={r.facturasPorDia.map((d) => ({ etiqueta: d.dia, valor: d.n }))} formato="numero" />
      </Tarjeta>

      {!desgloseSeparable ? <Aviso tono="info">El costo por modelo de arriba cubre todas las fases: con los datos de hoy no se puede aislar solo el de OCR.</Aviso> : null}
    </MarcoPagina>
  );
}

export const metadata: Metadata = { title: 'OCR' };
