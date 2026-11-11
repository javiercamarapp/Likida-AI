import { Suspense } from 'react';
import { EsqCifrasV2, EsqTarjetaV2, FilaTarjetas, StatusChip, Tarjeta, TablaBase, Aviso, BotonEnlace, EsqTablaV2, type ColumnaBase } from '@/app/ui-v2/componentes';
import { Columnas, TiraCifras, type PropsCifra } from '@/app/ui-v2/graficas';
import { uniformes } from './cifras-uniformes';
import { EsqueletoPortada } from '@/app/ui-v2/esqueletos';
import { tenantDemo } from '@/lib/auth/tenant-demo';
import { saludoTr } from '@/lib/i18n/operacion_tr';
import { fechaCorta, numero, usd } from '@/lib/formato';
import { BloqueCaja, BloqueCalidad, BloquePlataforma, BloqueSemaforo, BloqueTuTurno } from './resumen-mando';
import { conteosPlataforma, costoIaMes, mrr as leerMrr, panorama, resumenNegocio, VENTANA_FACTURAS_DIAS } from './resumen-lecturas';
import type { ResumenNegocio } from '@/lib/admin/negocio';
import type { TrDe } from '@/lib/i18n/tr_tipos';

import { getT } from '@/lib/i18n/servidor';
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
export async function ConsolaAdmin({ nombre }: { nombre: string | null }) {
  const [{ t }, tr] = await Promise.all([getT('admin_inicio'), getT('operacion')]);
  return (
    <EsqueletoPortada
      area={t('consola.eyebrow')}
      titulo={t('consola.resumen')}
      apoyo={t('consola.apoyo', { saludo: saludoTr(tr), nombre: nombre ?? 'Javier' })}
      acciones={<BotonEnlace tamano="sm" variante="secondary" href="/admin/copiloto">{t('consola.copiloto')}</BotonEnlace>}
      avisos={(
        <>
          <Aviso tono="info">{t('consola.acceso_admin')}</Aviso>
          <Suspense fallback={<EsqTarjetaV2 alto={48} />}><BloqueSemaforo /></Suspense>
        </>
      )}
    >
      {/* Consola de plataforma (Rovaq P1): seis tarjetas de cifra en 3 columnas, luego los paneles con filas-tarjeta. */}
      <Suspense fallback={<EsqCifrasV2 n={6} />}><BloqueNorte /></Suspense>

      <FilaTarjetas variante="6-6">
        <Suspense fallback={<EsqTarjetaV2 alto={240} />}><BloqueTuTurno /></Suspense>
        <Suspense fallback={<EsqTarjetaV2 alto={240} />}><BloqueCaja /></Suspense>
      </FilaTarjetas>

      <Suspense fallback={<EsqTarjetaV2 alto={240} />}><BloqueSeries /></Suspense>

      <Suspense fallback={<EsqTablaV2 />}><BloqueCalidad /></Suspense>

      <Suspense fallback={<EsqTarjetaV2 alto={60} />}><BloquePlataforma /></Suspense>

      <Suspense fallback={<EsqTablaV2 />}><BloqueFlotas /></Suspense>
    </EsqueletoPortada>
  );
}

const ERROR_CIFRA = { estado: 'error' as const, reintentar: true };

/** 3. El número norte: MRR contra la meta, % sin humano, flotas, viajes y facturas procesadas (total histórico). */
async function BloqueNorte() {
  const { t } = await getT('admin_inicio');
  const [r, conteos, mrr, pan, mes] = await Promise.all([resumenNegocio(), conteosPlataforma(), leerMrr(), panorama(), costoIaMes()]);

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
        ? { etiqueta: t('consola.mrr_meta_1_000'), valor: null, estado: 'vacio', mensaje: t('consola.algun_plan_activo_no') }
        : { etiqueta: t('consola.mrr_meta_1_000'), valor: mrr.totalMxn, formato: 'mxn', nota: t('consola.de_la_meta', { totalMxn: numero((mrr.totalMxn / 1_000_000) * 100) }), href: '/admin/costos-facturacion' },
    liqTotal === null || liqEnRevision === null
      ? { etiqueta: t('consola.liquidaciones_sin_humano_hoy'), valor: null, estado: 'error', mensaje: t('consola.no_se_pudo_medir'), reintentar: true }
      : liqTotal === 0
        ? { etiqueta: t('consola.liquidaciones_sin_humano_hoy'), valor: null, estado: 'vacio', mensaje: t('consola.aun_no_hay_liquidaciones') }
        : {
          etiqueta: t('consola.liquidaciones_sin_humano_hoy'), valor: (liqSinHumano! / liqTotal) * 100, formato: 'porcentaje',
          nota: t('consola.de_fuera_de_la', { liqSinHumano: numero(liqSinHumano!), liqTotal: numero(liqTotal) }),
        },
    r === null
      ? { etiqueta: t('consola.flotas'), valor: null, ...ERROR_CIFRA }
      : { etiqueta: r.tenants === 0 ? t('consola.flotas_ninguna_dada_de') : esSoloDemo ? t('consola.flota_solo_el_demo') : t('consola.flotas'), valor: r.tenants, formato: 'entero', href: '/admin/flotas' },
    r === null
      ? { etiqueta: t('consola.viajes_procesados'), valor: null, ...ERROR_CIFRA }
      : { etiqueta: t('consola.viajes_procesados'), valor: r.viajesProcesados, formato: 'entero', nota: liqTotal === null ? undefined : `${numero(liqTotal)} ${liqTotal === 1 ? t('consola.liquidacion_generada') : t('consola.liquidaciones_generadas')}` },
    r === null
      ? { etiqueta: t('consola.facturas_procesadas_historico'), valor: null, ...ERROR_CIFRA }
      : { etiqueta: t('consola.facturas_procesadas_historico'), valor: r.facturasTotal, formato: 'entero' },
    mes === null
      ? { etiqueta: t('consola.gasto_ia_mes'), valor: null, ...ERROR_CIFRA }
      : { etiqueta: t('consola.gasto_ia_mes_de', { etiquetaMes: mes.etiquetaMes }), valor: mes.mesUsd, formato: 'usd', href: '/admin/consumo' },
  ];
  return (
    <>
      {/* ADM-5 (auditoría 24): `esSoloDemo`, no `r.tenants <= 1`: con el PRIMER cliente real seguía afirmando «solo el demo». */}
      {esSoloDemo && (
        <Aviso tono="info">{t('consola.cifras_reales_no_de')}</Aviso>
      )}
      <div className="rv-esq__cifras-sueltas adm-res-tiles" role="group" aria-label={t('consola.numero_norte')}>
        {uniformes(cifras).map((c) => <TiraCifras key={c.etiqueta} items={[c]} etiqueta={c.etiqueta} elevar entra="tarjeta" />)}
      </div>
    </>
  );
}

/** Gasto de IA por día y facturas por día (ventana fija de 30 días, y el rótulo lo dice). */
async function BloqueSeries() {
  const { t } = await getT('admin_inicio');
  const r = await resumenNegocio();
  if (r === null) {
    return (
      <FilaTarjetas variante="6-6">
        <Tarjeta titulo={t('consola.gasto_de_ia_por')} estado="error" reintentar />
        <Tarjeta titulo={t('consola.facturas_procesadas_por_dia', { VENTANA_FACTURAS_DIAS })} estado="error" reintentar />
      </FilaTarjetas>
    );
  }
  const costo = r.porDia.map((d) => ({ etiqueta: fechaCorta(d.dia), valor: d.costoUsd }));
  const facturas = r.facturasPorDia.map((d) => ({ etiqueta: fechaCorta(d.dia), valor: d.n }));
  return (
    <FilaTarjetas variante="6-6">
      {r.porDia.length > 1
        ? <Tarjeta titulo={t('consola.gasto_de_ia_por')} elevar entra="tarjeta"><Columnas datos={costo} etiqueta={t('consola.gasto_de_ia_por')} formato="usd" matiz={2} /></Tarjeta>
        : <Tarjeta titulo={t('consola.gasto_de_ia_por')} estado="vacio" mensaje={t('consola.sin_historial_suficiente')} detalle={t('consola.se_dibuja_cuando_haya')} />}
      {r.facturasPorDia.some((d) => d.n > 0)
        ? <Tarjeta titulo={t('consola.facturas_procesadas_por_dia', { VENTANA_FACTURAS_DIAS })} elevar entra="tarjeta"><Columnas datos={facturas} etiqueta={t('consola.facturas_procesadas_por_dia_2')} formato="numero" matiz={1} /></Tarjeta>
        : <Tarjeta titulo={t('consola.facturas_procesadas_por_dia', { VENTANA_FACTURAS_DIAS })} estado="vacio" mensaje={t('consola.sin_facturas_en_el')} detalle={t('consola.cada_comprobante_que_pasa')} />}
    </FilaTarjetas>
  );
}

type FilaFlota = ResumenNegocio['flotas'][number];

const columnasFlotas = (t: TrDe<'admin_inicio'>): ColumnaBase<FilaFlota>[] => [
  { id: 'flota', titulo: t('consola.flota'), principal: true, celda: (f) => f.nombre },
  { id: 'plan', titulo: t('consola.plan'), celda: (f) => <>{f.plan}</> },
  { id: 'viajes', titulo: t('consola.viajes'), alinear: 'der', celda: (f) => numero(f.viajes) },
  { id: 'costo', titulo: t('consola.costo_de_ia_historico'), alinear: 'der', celda: (f) => usd(f.costoIaUsd) },
  {
    id: 'paneles', titulo: t('consola.paneles'),
    // Los TRES paneles del cliente, con la sesión del superadmin (`?tenant=`). El dueño LLEVA `?rol=flota_admin`: sin él el superadmin
    // no entra al chat de perfil (dashboard/page.tsx solo redirige a onboarding si el rol efectivo es flota_admin).
    celda: (f) => (
      <span className="adm-res-paneles">
        <BotonEnlace tamano="sm" variante="ghost" href={`/dashboard?tenant=${f.id}&rol=flota_admin`} target="_blank">{t('consola.dueno')}</BotonEnlace>
        <BotonEnlace tamano="sm" variante="ghost" href={`/dashboard?tenant=${f.id}&rol=encargado`} target="_blank">{t('consola.jefe_de_flota')}</BotonEnlace>
        <BotonEnlace tamano="sm" variante="ghost" href={`/dashboard/contador?tenant=${f.id}&rol=contador`} target="_blank">Contador</BotonEnlace>
      </span>
    ),
  },
];

async function BloqueFlotas() {
  const { t } = await getT('admin_inicio');
  const r = await resumenNegocio();
  return (
    <section aria-labelledby="res-flotas" id="flotas">
      <h2 id="res-flotas" className="rv-recuadro-tit__texto">Flotas</h2>
      <TablaBase
        etiqueta={t('consola.flotas_con_plan_viajes')}
        columnas={columnasFlotas(t)}
        filas={r ? r.flotas : []}
        idFila={(f) => f.id}
        estado={r === null ? 'error' : 'ok'}
        mensajeError="No disponible ahora. No es cero."
        vacio={{ titulo: t('consola.sin_flotas_dadas_de'), texto: t('consola.aparecen_aqui_cuando_se'), accion: <BotonEnlace tamano="sm" variante="secondary" href="/admin/flotas">{t('consola.ir_a_clientes')}</BotonEnlace> }}
        densa tarjetaMovil
      />
      <StatusChip tono="muted">{t('consola.plan_uso_contra_limite')}</StatusChip>
    </section>
  );
}
