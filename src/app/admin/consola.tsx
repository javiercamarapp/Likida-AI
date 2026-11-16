import { Suspense } from 'react';
import { ShieldCheck } from 'lucide-react';
import { EsqCifrasV2, EsqTarjetaV2, FilaTarjetas, StatusChip, Tarjeta, TablaBase, Aviso, BotonEnlace, EsqTablaV2, type ColumnaBase } from '@/app/ui-v2/componentes';
import { Columnas, DonaMini, TiraCifras, type PropsCifra } from '@/app/ui-v2/graficas';
import { uniformes } from './cifras-uniformes';
import { observadas } from './sello-observado';
import { EsqueletoPortada } from '@/app/ui-v2/esqueletos';
import { tenantDemo } from '@/lib/auth/tenant-demo';
import { saludoTr } from '@/lib/i18n/operacion_tr';
import { fechaCorta, numero, porcentaje, usd } from '@/lib/formato';
import { BloqueCaja, BloqueCalidad, BloquePlataforma, BloqueSemaforo, BloqueTuTurno } from './resumen-mando';
import { conteosPlataforma, costoIaMes, mrr as leerMrr, panorama, resumenNegocio, VENTANA_FACTURAS_DIAS } from './resumen-lecturas';
import type { ResumenNegocio } from '@/lib/admin/negocio';
import type { TrDe } from '@/lib/i18n/tr_tipos';

import { getT } from '@/lib/i18n/servidor';
import { celdaCsvSegura } from '@/lib/csv_seguro';
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
      acciones={(
        <>
          <Suspense fallback={null}><AccionExportarFlotas /></Suspense>
          <BotonEnlace variante="primary" href="/admin/copiloto">{t('consola.copiloto')}</BotonEnlace>
        </>
      )}
      avisos={<p className="adm-acceso" role="status"><ShieldCheck width={16} height={16} strokeWidth={1.75} aria-hidden="true" /><span>{t('consola.acceso_admin')}</span></p>}
    >
      {/* Consola de plataforma (Rovaq P1): seis tarjetas de cifra en 3 columnas, luego los paneles con filas-tarjeta. */}
      <Suspense fallback={<EsqCifrasV2 n={5} />}><BloqueNorte /></Suspense>

      {/* Un solo aviso FIJO arriba (el administrativo, en la cabecera). El semáforo de salud ya no es un segundo aviso entre las cifras
          y los paneles: vive dentro de «Operación», el panel que habla de la salud de los agentes. */}
      <FilaTarjetas variante="8-4" className="adm-fila-pareja">
        <Suspense fallback={<EsqTarjetaV2 alto={240} />}><BloqueTuTurno /></Suspense>
        <Suspense fallback={<EsqTarjetaV2 alto={240} />}><BloqueCaja /></Suspense>
      </FilaTarjetas>

      <Suspense fallback={<EsqTarjetaV2 alto={240} />}><BloqueSeries /></Suspense>

      <Suspense fallback={<EsqTablaV2 />}><BloqueCalidad semaforo={<Suspense fallback={null}><BloqueSemaforo /></Suspense>} /></Suspense>

      <Suspense fallback={<EsqTarjetaV2 alto={60} />}><BloquePlataforma /></Suspense>

      <Suspense fallback={<EsqTablaV2 />}><BloqueFlotas /></Suspense>
    </EsqueletoPortada>
  );
}

const ERROR_CIFRA = { estado: 'error' as const, reintentar: true };

/** Liquidaciones totales y las que están hoy en la bandeja «revisar» (misma lectura que usa el número norte; `null` = no se pudo leer). */
async function liquidaciones() {
  const [conteos, pan] = await Promise.all([conteosPlataforma(), panorama()]);
  const total = conteos ? conteos.liquidaciones : null;
  const enRevision = pan.bandeja ? pan.bandeja.conteos.liquidacionesRevisar : null;
  return { total, enRevision, sinHumano: total === null || enRevision === null ? null : total - enRevision };
}

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
          segmentos: [{ etiqueta: t('consola.seg_sin_humano'), valor: liqSinHumano }, { etiqueta: t('consola.seg_en_revision'), valor: liqEnRevision }],
        },
    r === null
      ? { etiqueta: t('consola.flotas'), valor: null, ...ERROR_CIFRA }
      : { etiqueta: r.tenants === 0 ? t('consola.flotas_ninguna_dada_de') : esSoloDemo ? t('consola.flota_solo_el_demo') : t('consola.flotas'), valor: r.tenants, formato: 'entero', nota: t('consola.flotas_nota'), href: '/admin/flotas' },
    r === null
      ? { etiqueta: t('consola.viajes_procesados'), valor: null, ...ERROR_CIFRA }
      : {
        etiqueta: t('consola.viajes_procesados'), valor: r.viajesProcesados, formato: 'entero',
        nota: liqTotal === null ? undefined : `${numero(liqTotal)} ${liqTotal === 1 ? t('consola.liquidacion_generada') : t('consola.liquidaciones_generadas')}`,
        segmentos: liqTotal === null ? undefined : [{ etiqueta: t('consola.seg_con_liquidacion'), valor: Math.min(liqTotal, r.viajesProcesados) }, { etiqueta: t('consola.seg_sin_liquidacion'), valor: Math.max(0, r.viajesProcesados - liqTotal) }],
      },
    r === null
      ? { etiqueta: t('consola.facturas_procesadas_historico'), valor: null, ...ERROR_CIFRA }
      : { etiqueta: t('consola.facturas_procesadas_historico'), valor: r.facturasTotal, formato: 'entero', nota: t('consola.facturas_procesadas_nota'), serie: r.facturasPorDia.map((d) => d.n) },
    mes === null
      ? { etiqueta: t('consola.gasto_ia_mes'), valor: null, ...ERROR_CIFRA }
      : { etiqueta: t('consola.gasto_ia_mes_de', { etiquetaMes: mes.etiquetaMes }), valor: mes.mesUsd, formato: 'usd', href: '/admin/consumo', serie: r ? r.porDia.map((d) => d.costoUsd) : undefined },
  ];
  return (
    <>
      {/* ADM-5 (auditoría 24): `esSoloDemo`, no `r.tenants <= 1`: con el PRIMER cliente real seguía afirmando «solo el demo». */}
      {esSoloDemo && (
        <Aviso tono="info">{t('consola.cifras_reales_no_de')}</Aviso>
      )}
      <TiraCifras items={observadas(uniformes(cifras), t('a1r4.observado'))} etiqueta={t('consola.numero_norte')} className="adm-res-tira" elevar entra="tarjeta" />
    </>
  );
}

/** Facturas por día (ventana fija de 30 días, y el rótulo lo dice) junto a la dona de liquidaciones por estatus. El gasto de IA por día vive en «Dinero». */
async function BloqueSeries() {
  const { t } = await getT('admin_inicio');
  const [r, liq] = await Promise.all([resumenNegocio(), liquidaciones()]);
  const titulo = t('consola.facturas_procesadas_por_dia', { VENTANA_FACTURAS_DIAS });
  const facturas = r ? r.facturasPorDia.map((d) => ({ etiqueta: fechaCorta(d.dia), valor: d.n })) : [];
  return (
    <FilaTarjetas variante="8-4" className="adm-fila-pareja">
      {r === null
        ? <Tarjeta titulo={titulo} estado="error" reintentar />
        : r.facturasPorDia.some((d) => d.n > 0)
          ? <Tarjeta titulo={titulo} elevar entra="tarjeta"><Columnas datos={facturas} etiqueta={t('consola.facturas_procesadas_por_dia_2')} formato="numero" matiz={1} /></Tarjeta>
          : <Tarjeta titulo={titulo} elevar entra="tarjeta"><p className="adm-vacio-linea"><strong>{t('consola.sin_facturas_en_el')}</strong> {t('consola.cada_comprobante_que_pasa')}</p></Tarjeta>}
      {liq.total === null || liq.enRevision === null
        ? <Tarjeta titulo={t('consola.liquidaciones_estatus')} estado="error" reintentar />
        : liq.total === 0
          ? <Tarjeta titulo={t('consola.liquidaciones_estatus')} elevar entra="tarjeta"><p className="adm-vacio-linea">{t('consola.aun_no_hay_liquidaciones')}</p></Tarjeta>
          : (
            <Tarjeta titulo={t('consola.liquidaciones_estatus')} elevar entra="tarjeta">
              <DonaMini
                etiqueta={t('consola.liquidaciones_estatus')}
                gajos={[{ etiqueta: t('consola.seg_sin_humano'), valor: liq.sinHumano }, { etiqueta: t('consola.seg_en_revision'), valor: liq.enRevision }]}
                centro={porcentaje(((liq.sinHumano ?? 0) / liq.total) * 100, 0)}
                formato="numero"
              />
            </Tarjeta>
          )}
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
        <BotonEnlace tamano="sm" variante="ghost" href={`/dashboard/contador?tenant=${f.id}&rol=contador`} target="_blank">{t('consola.contador')}</BotonEnlace>
      </span>
    ),
  },
];

/** CSV de la tabla de flotas tal como se ve (nada que la pantalla no muestre). Una celda que empieza con = + - @ se neutraliza para que una hoja de cálculo no la lea como fórmula. */
function csvFlotas(filas: ReadonlyArray<FilaFlota>, t: TrDe<'admin_inicio'>): string {
  const celda = (v: string | number) => celdaCsvSegura(v);
  return [
    [t('consola.flota'), t('consola.plan'), t('consola.viajes'), t('consola.costo_de_ia_historico')].map(celda).join(','),
    ...filas.map((f) => [f.nombre, f.plan, f.viajes, f.costoIaUsd].map(celda).join(',')),
  ].join('\n');
}

/** «Exportar CSV» vive en la cabecera (Rovaq: Copiloto + Exportar CSV), junto a la acción primaria; lee la misma lectura cacheada de la tabla. */
async function AccionExportarFlotas() {
  const { t } = await getT('admin_inicio');
  const r = await resumenNegocio();
  if (!r || r.flotas.length === 0) return null;
  return <BotonEnlace variante="secondary" download="flotas.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(`\uFEFF${csvFlotas(r.flotas, t)}`)}`}>{t('a1r4.exportar_csv')}</BotonEnlace>;
}

async function BloqueFlotas() {
  const { t } = await getT('admin_inicio');
  const r = await resumenNegocio();
  return (
    <section id="flotas" aria-label={t('consola.flotas')}>
      <Tarjeta titulo={t('consola.flotas')} elevar entra="tarjeta" acciones={(
        <>
          <BotonEnlace tamano="sm" variante="ghost" href="/admin/flotas">{t('consola.ir_a_clientes')}</BotonEnlace>
        </>
      )}>
        <TablaBase
          etiqueta={t('consola.flotas_con_plan_viajes')}
          columnas={columnasFlotas(t)}
          filas={r ? r.flotas : []}
          idFila={(f) => f.id}
          estado={r === null ? 'error' : 'ok'}
          mensajeError={t('resumen_mando.no_disponible_ahora_no')}
          vacio={{ titulo: t('consola.sin_flotas_dadas_de'), texto: t('consola.aparecen_aqui_cuando_se'), accion: <BotonEnlace tamano="sm" variante="secondary" href="/admin/flotas">{t('consola.ir_a_clientes')}</BotonEnlace> }}
          tarjetaMovil
        />
        <StatusChip tono="muted">{t('consola.plan_uso_contra_limite')}</StatusChip>
      </Tarjeta>
    </section>
  );
}
