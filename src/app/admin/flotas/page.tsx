import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { getResumenNegocio } from '@/lib/admin/negocio';
import { getOnboardingFlotas, type OnboardingFlota } from '@/lib/admin/onboarding';
import { casillasDeArranque, resumenArranque } from '@/lib/admin/arranque';
import { telefonosJefe } from '@/lib/likida/contactos';
import { getPlanes } from '@/lib/saas/suscripcion';
import { numero } from '@/lib/formato';
import { requireSuperadmin } from '@/lib/auth/guard';
import { getTechosIa, type FilaTechoIa } from '@/lib/admin/techo_ia';
import { usd } from '@/lib/formato';
import { uniformes } from '../cifras-uniformes';
import { Aviso, BarraFiltros, BotonEnlace, EstadoError, FilaTarjetas, FiltroBusqueda, FiltroOpciones, StatusChip, Tarjeta } from '../../ui-v2/componentes';
import { BarList, Bullet, DonaMini } from '../../ui-v2/graficas';
import { CajonVistaRapida, EsqueletoTablaMaestra } from '../../ui-v2/esqueletos';
import { TablaLista, hrefConParams, type ColumnaTabla } from '../../ui-v2/datos';
import { accionCrearFlota } from './acciones';
import { AltaFlota } from './alta';
import '../dinero.css';
import '../resumen.css';
import './flotas.css';
import '../pulido-c.css';

import type { TrDe } from '@/lib/i18n/tr_tipos';
import { getT } from '@/lib/i18n/servidor';
export const dynamic = 'force-dynamic';

/** El marco de la pantalla, UNO solo (también para el error de lectura): encabezado y acción de alta no cambian entre estados. */
function PantallaClientes({ children, filtros, pie, vistaRapida, cifras, t }: { children: ReactNode; filtros?: ReactNode; pie?: ReactNode; vistaRapida?: ReactNode; cifras?: ReturnType<typeof uniformes>; t: TrDe<'admin_flotas'> }) {
  return (
    <EsqueletoTablaMaestra
      area="Negocio" titulo={t('flotas.clientes')}
      apoyo={t('flotas.flotas_dadas_de_alta')}
      // Rovaq P2: el aviso administrativo va PRIMERO y luego los filtros (el esqueleto pinta filtros antes que avisos, así que el aviso entra con ellos).
      filtros={<><Aviso tono="info">{t('flotas.aviso_admin')}</Aviso>{filtros}</>}
      pie={pie} vistaRapida={vistaRapida}
      cifras={cifras} etiquetaCifras={cifras ? t('pul9.cifras_etiqueta') : undefined}
    >
      {children}
    </EsqueletoTablaMaestra>
  );
}

interface Fila { id: string; nombre: string; plan: string; viajes: number; arranque: { hechas: number; total: number } | null; techo: FilaTechoIa | null }

/** Barra de gasto de IA de hoy contra el techo diario que aplica (Rovaq: «US$ x de US$ y»). Sin medir se dice, no se dibuja en cero. */
function GastoIa({ f, t }: { f: Fila; t: TrDe<'admin_flotas'> }) {
  const h = f.techo;
  if (h === null || h.usadoHoyUsd === null) return <span className="adm-din-sub">{t('flotas.sin_medir')}</span>;
  return (
    <Bullet
      compacto etiqueta={t('flotas.gasto_etiqueta')} valor={h.usadoHoyUsd} maximo={h.topeUsd > 0 ? h.topeUsd : undefined}
      formato={() => t('flotas.gasto_de_techo', { gasto: usd(h.usadoHoyUsd as number), techo: usd(h.topeUsd) })}
    />
  );
}

/**
 * Clientes — la tabla maestra de flotas. La declaración del 15 %, el checklist de arranque y las señales de uso viven en la ficha
 * de cada flota (`/admin/flotas/[id]`); el ranking de costo de IA vive en Consumo. Cada lectura cae por su lado: un teléfono o un
 * onboarding que no se pudo leer deja «—» en el arranque de TODAS (no «0 de 6») y la tabla sigue.
 */
export default async function FlotasPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const { t } = await getT('admin_flotas');
  // A39-S05-01/S06-01: puerta PROPIA en el render (el layout no se re-ejecuta en una petición RSC parcial).
  await requireSuperadmin();
  const sp = (await searchParams) ?? {};
  const r = await getResumenNegocio().catch(() => null);
  if (r === null) return <PantallaClientes t={t}><EstadoError reintentar>{t('flotas.no_se_pudo_leer_3')}</EstadoError></PantallaClientes>;

  const [telefonos, onboarding, planes, techos] = await Promise.all([
    r.flotas.length === 0 ? Promise.resolve<Record<string, string> | null>({}) : telefonosJefe(r.flotas.map((f) => f.id)).catch(() => null),
    getOnboardingFlotas().catch(() => null as Map<string, OnboardingFlota> | null),
    getPlanes().then((l) => l.map((p) => ({ clave: p.clave, nombre: p.nombre }))).catch(() => null),
    getTechosIa().catch(() => null),
  ]);
  /** Una flota sin filas en las tablas de onboarding = ceros CONTADOS (la lectura sí se completó); `null` solo si la lectura entera falló. */
  const onboardingDe = (id: string): OnboardingFlota | null => onboarding === null ? null
    : onboarding.get(id) ?? { credenciales: { total: 0, probadas: 0 }, avisosConfigurados: 0, avisoPrivacidad: { razonSocial: false, domicilio: false } };

  const filas: Fila[] = r.flotas.map((f) => ({
    id: f.id, nombre: f.nombre, plan: f.plan, viajes: f.viajes,
    arranque: resumenArranque(casillasDeArranque({
      id: f.id, viajes: f.viajes, politicaPropia: f.politicaPropia, telefono: telefonos === null ? undefined : telefonos[f.id] ?? null,
      telefonosLegibles: telefonos !== null, onboarding: onboardingDe(f.id),
    })),
    techo: techos?.filas.find((x) => x.tenantId === f.id) ?? null,
  }));

  const textoQ = (typeof sp.q === 'string' ? sp.q : '').trim().slice(0, 80);
  const filtroArranque = typeof sp.arranque === 'string' ? sp.arranque : '';
  const visibles = filas.filter((f) => {
    if (textoQ && !f.nombre.toLowerCase().includes(textoQ.toLowerCase())) return false;
    if (filtroArranque === 'completo') return f.arranque !== null && f.arranque.hechas === f.arranque.total;
    if (filtroArranque === 'pendiente') return f.arranque !== null && f.arranque.hechas < f.arranque.total;
    if (filtroArranque === 'sin_dato') return f.arranque === null;
    return true;
  });
  const nFiltros = (textoQ ? 1 : 0) + (['completo', 'pendiente', 'sin_dato'].includes(filtroArranque) ? 1 : 0);
  const ver = typeof sp.ver === 'string' ? sp.ver : '';
  const posicion = ver ? visibles.findIndex((f) => f.id === ver) : -1;
  const sel = posicion >= 0 ? visibles[posicion] : null;

  const columnas: ColumnaTabla<Fila>[] = [
    { id: 'flota', titulo: t('flotas.flota'), principal: true, valor: (f) => f.nombre.toLowerCase(), celda: (f) => <Link href={`/admin/flotas/${f.id}`}>{f.nombre}</Link> },
    { id: 'plan', titulo: t('flotas.plan'), valor: (f) => f.plan, celda: (f) => <span>{f.plan}</span> },
    {
      // La salud de la flota (Rovaq P2: píldora de salud): el arranque dicho con palabras y su cuenta, nunca solo «2 de 6».
      id: 'arranque', titulo: t('flotas.salud'), valor: (f) => f.arranque?.hechas ?? -1,
      celda: (f) => f.arranque === null
        ? <StatusChip tono="muted">{t('flotas.sin_dato')}</StatusChip>
        : f.arranque.hechas === f.arranque.total
          ? <StatusChip tono="ok">{t('flotas.salud_completa')}</StatusChip>
          : <StatusChip tono="warn">{t('flotas.salud_pendiente', { hechas: f.arranque.hechas, total: f.arranque.total })}</StatusChip>,
    },
    { id: 'gasto', titulo: t('flotas.gasto_ia_hoy'), valor: (f) => f.techo?.usadoHoyUsd ?? -1, celda: (f) => <GastoIa f={f} t={t} /> },
    { id: 'viajes', titulo: t('flotas.viajes'), alinear: 'der', valor: (f) => f.viajes, celda: (f) => numero(f.viajes) },
    {
      // Rovaq: «Detalle» + «Ficha 360». Aquí, la Vista rápida (cajón) y la ficha; los paneles del dueño y del jefe viven en el cajón.
      id: 'acciones', titulo: t('flotas.acciones'), tituloOculto: true, alinear: 'der',
      celda: (f) => (
        <span className="adm-flota-acciones">
          <BotonEnlace href={hrefConParams('/admin/flotas', sp, { ver: f.id })} tamano="sm" variante="ghost">{t('flotas.detalle')}</BotonEnlace>
          <BotonEnlace href={`/admin/flotas/${f.id}`} tamano="sm" variante="secondary">{t('flotas.abrir_ficha')}</BotonEnlace>
        </span>
      ),
    },
  ];

  // Tira breve (pul9): lo que la página ya lee. El gasto de IA de hoy suma solo lo medido; sin lectura de techos queda «—», no 0.
  const gastoHoy = techos === null ? null : techos.filas.reduce((s, x) => s + (x.usadoHoyUsd ?? 0), 0);
  const cifras = uniformes([
    { etiqueta: t('flotas.flotas'), valor: numero(filas.length) },
    { etiqueta: t('flotas.viajes'), valor: numero(filas.reduce((s, f) => s + f.viajes, 0)) },
    { etiqueta: t('flotas.gasto_ia_hoy'), valor: gastoHoy === null ? '—' : usd(gastoHoy) },
  ]);

  return (
    <PantallaClientes
      t={t}
      cifras={cifras}
      filtros={(
        <BarraFiltros accion="/admin/flotas" enLinea buscar etiqueta={t('flotas.filtrar_flotas')} nActivos={nFiltros} limpiarHref="/admin/flotas">
          <FiltroBusqueda nombre="q" valor={textoQ} placeholder={t('flotas.buscar_flota')} etiqueta={t('flotas.buscar_flota')} />
          <FiltroOpciones
            etiqueta={t('flotas.arranque')} nombre="arranque" valor={filtroArranque}
            opciones={[{ valor: 'completo', rotulo: t('flotas.arranque_completo') }, { valor: 'pendiente', rotulo: t('flotas.arranque_pendiente') }, { valor: 'sin_dato', rotulo: t('flotas.sin_dato') }]}
          />
        </BarraFiltros>
      )}
      vistaRapida={sel ? (
        <CajonVistaRapida
          titulo={sel.nombre} subtitulo={t('flotas.vr_subtitulo', { n: posicion + 1, total: visibles.length })} hrefCerrar={hrefConParams('/admin/flotas', sp, { ver: null })}
          cifras={[
            { etiqueta: t('flotas.plan'), valor: sel.plan },
            { etiqueta: t('flotas.viajes'), valor: numero(sel.viajes) },
            { etiqueta: t('flotas.arranque'), valor: sel.arranque === null ? '—' : `${sel.arranque.hechas} de ${sel.arranque.total}` },
            { etiqueta: t('flotas.gasto_ia_hoy'), valor: sel.techo?.usadoHoyUsd == null ? '—' : usd(sel.techo.usadoHoyUsd) },
          ]}
          aviso={<Aviso tono="info">{t('flotas.vr_paneles')}</Aviso>}
          pie={<BotonEnlace variante="primary" href={`/admin/flotas/${sel.id}`}>{t('flotas.abrir_ficha')}</BotonEnlace>}
        >
          <div className="adm-flota-paneles">
            {/* DOS PUERTAS: dueño y jefe de tráfico ven cosas distintas (visibilidad.ts); `?rol=` solo QUITA visibilidad. */}
            <BotonEnlace href={`/dashboard?tenant=${sel.id}&rol=flota_admin`} target="_blank" tamano="sm" variante="secondary">{t('flotas.panel_de_dueno')}</BotonEnlace>
            <BotonEnlace href={`/dashboard?tenant=${sel.id}&rol=encargado`} target="_blank" tamano="sm" variante="secondary">{t('flotas.panel_de_jefe_de')}</BotonEnlace>
          </div>
        </CajonVistaRapida>
      ) : null}
    >
      {filas.length > 0 ? (
        <FilaTarjetas variante="6-6" className="fin16c-arriba">
          <Tarjeta entra="tarjeta" titulo={t('flotas.mix_planes_titulo')}>
            <BarList
              etiqueta={t('flotas.mix_planes_etiqueta')}
              items={[...filas.reduce((m, f) => m.set(f.plan, (m.get(f.plan) ?? 0) + 1), new Map<string, number>())]
                .sort((a, b) => b[1] - a[1]).map(([plan, n]) => ({ clave: plan, etiqueta: plan, valor: n, texto: numero(n) }))}
            />
          </Tarjeta>
          <Tarjeta entra="tarjeta" titulo={t('flotas.mix_arranque_titulo')}>
            <DonaMini
              etiqueta={t('flotas.mix_arranque_etiqueta')} centro={`${numero(filas.length)} ${t('flotas.mix_centro')}`} formato="numero"
              gajos={[
                { etiqueta: t('flotas.arranque_completo'), valor: filas.filter((f) => f.arranque !== null && f.arranque.hechas === f.arranque.total).length },
                { etiqueta: t('flotas.arranque_pendiente'), valor: filas.filter((f) => f.arranque !== null && f.arranque.hechas < f.arranque.total).length },
                { etiqueta: t('flotas.sin_dato'), valor: filas.filter((f) => f.arranque === null).length },
              ]}
            />
          </Tarjeta>
        </FilaTarjetas>
      ) : null}
      <Tarjeta
        titulo={t('flotas.flotas')} estado={filas.length === 0 ? 'vacio' : 'ok'} mensaje={t('flotas.sin_flotas_dadas_de')}
        detalle={t('flotas.da_de_alta_la')}
      >
        {/* Eyebrow del panel (Rovaq P2: «4 DE 4»): cuántas se ven de cuántas hay. */}
        <p className="adm-eyebrow">{t('flotas.n_de_n', { n: numero(visibles.length), total: numero(filas.length) })}</p>
        {visibles.length === 0 ? <p className="adm-din-nota" role="status">{t('flotas.sin_resultados')}</p> : (
          <TablaLista
            etiqueta={t('flotas.flotas_dadas_de_alta_2')} columnas={columnas} filas={visibles} idFila={(f) => f.id}
            base="/admin/flotas" params={sp} orden="local" paginacion={{ tamano: 25 }}
          />
        )}
      </Tarjeta>

      {/* Alta de una flota: bloque propio bajo la tabla (Rovaq «Crear organización»). La acción es la MISMA (`accionCrearFlota`, con su puerta,
          su segundo factor y su bitácora); `?alta=1` (el enlace de antes) baja hasta aquí por el ancla. */}
      <section id="alta-flota" className="adm-flota-alta">
        <Tarjeta entra="tarjeta" titulo={t('flotas.dar_de_alta_una')}>
          <p className="adm-eyebrow">{t('flotas.eb_nuevo_espacio')}</p>
          <p className="adm-din-nota">{t('flotas.plan_datos_fiscales_y')}</p>
          <AltaFlota accion={accionCrearFlota} planes={planes} t={t} />
        </Tarjeta>
      </section>
    </PantallaClientes>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_flotas');
  return { title: t('flotas.clientes') };
}
