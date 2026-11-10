import { Suspense } from 'react';
import { Chip, EsqCifrasV2, EsqTarjetaV2, FilaTarjetas, MarcoPagina, StatusChip, Tarjeta, TablaBase, Aviso, BotonEnlace, EsqTablaV2, type ColumnaBase } from '@/app/ui-v2/componentes';
import { Columnas, TiraCifras, type PropsCifra } from '@/app/ui-v2/graficas';
import { tenantDemo } from '@/lib/auth/tenant-demo';
import { saludo, ahoraMs } from '@/lib/saludo';
import { fechaCorta, fechaMx, hoyMx, numero, usd } from '@/lib/formato';
import { BloqueCaja, BloqueCalidad, BloquePlataforma, BloqueSemaforo, BloqueTuTurno } from './resumen-mando';
import { conteosPlataforma, mrr as leerMrr, panorama, resumenNegocio, VENTANA_FACTURAS_DIAS } from './resumen-lecturas';
import type { ResumenNegocio } from '@/lib/admin/negocio';

/**
 * Inicio de /admin = el CENTRO DE MANDO (PLAN-MAESTRO §2.1 #1 y §10.1). Orden de lectura: ¿estoy bien? (semáforo) · ¿qué espera mi
 * decisión? (Tu turno, máx. 5, con la caja al lado) · el número norte · gasto y facturas · calidad por agente · plataforma plegada ·
 * flotas con sus paneles. Cada bloque lee lo suyo dentro de su propio <Suspense>: ya no «se cae entera» si una lectura falla.
 *
 * VIVE EN SU PROPIO ARCHIVO, EXPORTADO, y no dentro de `page.tsx`, por la misma razón que los inicios de /dashboard: un preview
 * headless sin sesión monta el componente REAL. El gateo (`requireSuperadmin`) queda en `page.tsx`.
 *
 * Las cifras cruzan TODAS las flotas (`lib/admin/negocio.ts`, la única función con ese permiso). La ventana de «Facturas por día» es
 * fija (30 días, y el rótulo lo dice): el selector `?rango=` se retiró porque ya no hay nada más en la pantalla que él mueva.
 */
export function ConsolaAdmin({ nombre }: { nombre: string | null }) {
  const fechaHoyMx = fechaMx(hoyMx(new Date(ahoraMs())));
  return (
    <MarcoPagina
      titulo="Resumen"
      apoyo={`${saludo()}, ${nombre ?? 'Javier'}. Lo que espera tu decisión, primero.`}
      acciones={<Chip>{fechaHoyMx}</Chip>}
    >
      <Suspense fallback={<EsqTarjetaV2 alto={64} />}><BloqueSemaforo /></Suspense>

      <FilaTarjetas variante="8-4">
        <Suspense fallback={<EsqTarjetaV2 alto={260} />}><BloqueTuTurno /></Suspense>
        <Suspense fallback={<EsqTarjetaV2 alto={260} />}><BloqueCaja /></Suspense>
      </FilaTarjetas>

      <Suspense fallback={<EsqCifrasV2 n={5} />}><BloqueNorte /></Suspense>

      <Suspense fallback={<EsqTarjetaV2 alto={240} />}><BloqueSeries /></Suspense>

      <Suspense fallback={<EsqTablaV2 />}><BloqueCalidad /></Suspense>

      <Suspense fallback={<EsqTarjetaV2 alto={56} />}><BloquePlataforma /></Suspense>

      <Suspense fallback={<EsqTablaV2 />}><BloqueFlotas /></Suspense>
    </MarcoPagina>
  );
}

const ERROR_CIFRA = { estado: 'error' as const, reintentar: true };

/** 3. El número norte: MRR contra la meta, % sin humano, flotas, viajes y facturas procesadas (total histórico). */
async function BloqueNorte() {
  const [r, conteos, mrr, pan] = await Promise.all([resumenNegocio(), conteosPlataforma(), leerMrr(), panorama()]);

  // "Solo el demo" es una afirmación verificable: se comprueba contra el id real del tenant demo, no se asume que el único tenant
  // que hay siempre es el demo. (`tenants_reales.test.ts` evalúa la expresión de la etiqueta con 0.)
  const esSoloDemo = r !== null && r.tenants === 1 && r.flotas[0]?.id === tenantDemo();

  // Métrica norte: numerador y denominador de lecturas que ya se pagaron. NO afirma «nunca la tocó un humano»: un re-cuadre
  // reescribe el estatus sin dejar rastro; por eso el rótulo dice «hoy» y la nota dice de dónde sale.
  const liqTotal = conteos ? conteos.liquidaciones : null;
  const liqEnRevision = pan.bandeja ? pan.bandeja.conteos.liquidacionesRevisar : null;
  const liqSinHumano = liqTotal === null || liqEnRevision === null ? null : liqTotal - liqEnRevision;

  const cifras: PropsCifra[] = [
    mrr === null
      ? { etiqueta: 'MRR', valor: null, ...ERROR_CIFRA }
      : mrr.totalMxn === null
        ? { etiqueta: 'MRR — meta $1,000,000', valor: null, estado: 'vacio', mensaje: 'Algún plan activo no tiene precio configurado.' }
        : { etiqueta: 'MRR — meta $1,000,000', valor: mrr.totalMxn, formato: 'mxn', nota: `${numero((mrr.totalMxn / 1_000_000) * 100)} % de la meta`, href: '/admin/costos-facturacion' },
    liqTotal === null || liqEnRevision === null
      ? { etiqueta: 'Liquidaciones sin humano — hoy', valor: null, estado: 'error', mensaje: 'No se pudo medir: falta el total o la bandeja «revisar».', reintentar: true }
      : liqTotal === 0
        ? { etiqueta: 'Liquidaciones sin humano — hoy', valor: null, estado: 'vacio', mensaje: 'Aún no hay liquidaciones: no hay porcentaje que afirmar.' }
        : {
          etiqueta: 'Liquidaciones sin humano — hoy', valor: (liqSinHumano! / liqTotal) * 100, formato: 'porcentaje',
          nota: `${numero(liqSinHumano!)} de ${numero(liqTotal)} fuera de la bandeja «revisar» ahora; es el estatus actual, no historial.`,
        },
    r === null
      ? { etiqueta: 'Flotas', valor: null, ...ERROR_CIFRA }
      : { etiqueta: r.tenants === 0 ? 'Flotas (ninguna dada de alta)' : esSoloDemo ? 'Flota (solo el demo)' : 'Flotas', valor: r.tenants, formato: 'entero', href: '/admin/flotas' },
    r === null
      ? { etiqueta: 'Viajes procesados', valor: null, ...ERROR_CIFRA }
      : { etiqueta: 'Viajes procesados', valor: r.viajesProcesados, formato: 'entero', nota: liqTotal === null ? undefined : `${numero(liqTotal)} ${liqTotal === 1 ? 'liquidación generada' : 'liquidaciones generadas'}` },
    r === null
      ? { etiqueta: 'Facturas procesadas — histórico', valor: null, ...ERROR_CIFRA }
      : { etiqueta: 'Facturas procesadas — histórico', valor: r.facturasTotal, formato: 'entero' },
  ];
  return (
    <>
      {/* ADM-5 (auditoría 24): `esSoloDemo`, no `r.tenants <= 1`: con el PRIMER cliente real seguía afirmando «solo el demo». */}
      {esSoloDemo && (
        <Aviso tono="info">Cifras reales, no de ejemplo: Likida todavía no tiene clientes, así que son bajas a propósito.</Aviso>
      )}
      <TiraCifras items={cifras} etiqueta="Número norte" />
    </>
  );
}

/** Gasto de IA por día y facturas por día (ventana fija de 30 días, y el rótulo lo dice). */
async function BloqueSeries() {
  const r = await resumenNegocio();
  if (r === null) {
    return (
      <FilaTarjetas variante="6-6">
        <Tarjeta titulo="Gasto de IA por día" estado="error" reintentar />
        <Tarjeta titulo={`Facturas procesadas por día — últimos ${VENTANA_FACTURAS_DIAS} días`} estado="error" reintentar />
      </FilaTarjetas>
    );
  }
  const costo = r.porDia.map((d) => ({ etiqueta: fechaCorta(d.dia), valor: d.costoUsd }));
  const facturas = r.facturasPorDia.map((d) => ({ etiqueta: fechaCorta(d.dia), valor: d.n }));
  return (
    <FilaTarjetas variante="6-6">
      {r.porDia.length > 1
        ? <Tarjeta titulo="Gasto de IA por día"><Columnas datos={costo} etiqueta="Gasto de IA por día" formato="usd" matiz={2} /></Tarjeta>
        : <Tarjeta titulo="Gasto de IA por día" estado="vacio" mensaje="Sin historial suficiente" detalle="Se dibuja cuando haya al menos dos días con llamadas al modelo." />}
      {r.facturasPorDia.some((d) => d.n > 0)
        ? <Tarjeta titulo={`Facturas procesadas por día — últimos ${VENTANA_FACTURAS_DIAS} días`}><Columnas datos={facturas} etiqueta="Facturas procesadas por día" formato="numero" matiz={1} /></Tarjeta>
        : <Tarjeta titulo={`Facturas procesadas por día — últimos ${VENTANA_FACTURAS_DIAS} días`} estado="vacio" mensaje="Sin facturas en el periodo" detalle="Cada comprobante que pasa por el pipeline suma aquí." />}
    </FilaTarjetas>
  );
}

type FilaFlota = ResumenNegocio['flotas'][number];

const COLUMNAS_FLOTAS: ColumnaBase<FilaFlota>[] = [
  { id: 'flota', titulo: 'Flota', principal: true, celda: (f) => f.nombre },
  { id: 'plan', titulo: 'Plan', celda: (f) => <>{f.plan}</> },
  { id: 'viajes', titulo: 'Viajes', alinear: 'der', celda: (f) => numero(f.viajes) },
  { id: 'costo', titulo: 'Costo de IA (histórico)', alinear: 'der', celda: (f) => usd(f.costoIaUsd) },
  {
    id: 'paneles', titulo: 'Paneles',
    // Los TRES paneles del cliente, con la sesión del superadmin (`?tenant=`). El dueño LLEVA `?rol=flota_admin`: sin él el superadmin
    // no entra al chat de perfil (dashboard/page.tsx solo redirige a onboarding si el rol efectivo es flota_admin).
    celda: (f) => (
      <span className="adm-res-paneles">
        <BotonEnlace tamano="sm" variante="ghost" href={`/dashboard?tenant=${f.id}&rol=flota_admin`} target="_blank">Dueño</BotonEnlace>
        <BotonEnlace tamano="sm" variante="ghost" href={`/dashboard?tenant=${f.id}&rol=encargado`} target="_blank">Jefe de flota</BotonEnlace>
        <BotonEnlace tamano="sm" variante="ghost" href={`/dashboard/contador?tenant=${f.id}&rol=contador`} target="_blank">Contador</BotonEnlace>
      </span>
    ),
  },
];

async function BloqueFlotas() {
  const r = await resumenNegocio();
  return (
    <section aria-labelledby="res-flotas" id="flotas">
      <h2 id="res-flotas" className="rv-recuadro-tit__texto">Flotas</h2>
      <TablaBase
        etiqueta="Flotas con plan, viajes y costo de IA"
        columnas={COLUMNAS_FLOTAS}
        filas={r ? r.flotas : []}
        idFila={(f) => f.id}
        estado={r === null ? 'error' : 'ok'}
        mensajeError="No disponible ahora. No es cero."
        vacio={{ titulo: 'Sin flotas dadas de alta', texto: 'Aparecen aquí cuando se da de alta la primera flota.', accion: <BotonEnlace tamano="sm" variante="secondary" href="/admin/flotas">Ir a Clientes</BotonEnlace> }}
        densa tarjetaMovil
      />
      <StatusChip tono="muted">Plan, uso contra límite y estado de cuenta viven en la ficha de cada flota.</StatusChip>
    </section>
  );
}
