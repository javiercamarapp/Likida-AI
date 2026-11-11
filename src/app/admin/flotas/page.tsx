import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { getResumenNegocio } from '@/lib/admin/negocio';
import { getOnboardingFlotas, type OnboardingFlota } from '@/lib/admin/onboarding';
import { casillasDeArranque, resumenArranque } from '@/lib/admin/arranque';
import { telefonosJefe } from '@/lib/likida/contactos';
import { getPlanes } from '@/lib/saas/suscripcion';
import { numero } from '@/lib/formato';
import { requireSuperadmin } from '@/lib/auth/guard';
import { BotonEnlace, EstadoError, FormaEnCajon, Icono, StatusChip, Tarjeta } from '../../ui-v2/componentes';
import type { PropsCifra } from '../../ui-v2/graficas';
import { EsqueletoTablaMaestra } from '../../ui-v2/esqueletos';
import { TablaLista, type ColumnaTabla } from '../../ui-v2/datos';
import { accionCrearFlota } from './acciones';
import { CamposAltaFlota } from './alta';

import type { TrDe } from '@/lib/i18n/tr_tipos';
import { getT } from '@/lib/i18n/servidor';
export const dynamic = 'force-dynamic';

/** El marco de la pantalla, UNO solo (también para el error de lectura): encabezado y acción de alta no cambian entre estados. */
function PantallaClientes({ children, alta, cifras, t }: { children: ReactNode; alta?: ReactNode; cifras?: PropsCifra[]; t: TrDe<'admin_flotas'> }) {
  return (
    <EsqueletoTablaMaestra
      cifras={cifras} etiquetaCifras={t('flotas.resumen_de_clientes')}
      area="Negocio" titulo={t('flotas.clientes')}
      apoyo={t('flotas.flotas_dadas_de_alta')}
      acciones={alta ?? <BotonEnlace href="/admin/flotas?alta=1" variante="primary" icono={<Icono icono={Plus} />}>{t('flotas.nueva_flota')}</BotonEnlace>}
    >
      {children}
    </EsqueletoTablaMaestra>
  );
}

interface Fila { id: string; nombre: string; plan: string; viajes: number; arranque: { hechas: number; total: number } | null }

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

  const [telefonos, onboarding, planes] = await Promise.all([
    r.flotas.length === 0 ? Promise.resolve<Record<string, string> | null>({}) : telefonosJefe(r.flotas.map((f) => f.id)).catch(() => null),
    getOnboardingFlotas().catch(() => null as Map<string, OnboardingFlota> | null),
    getPlanes().then((l) => l.map((p) => ({ clave: p.clave, nombre: p.nombre }))).catch(() => null),
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
  }));
  const medidas = filas.filter((f) => f.arranque !== null);
  const completas = medidas.filter((f) => f.arranque!.hechas === f.arranque!.total).length;

  const columnas: ColumnaTabla<Fila>[] = [
    { id: 'flota', titulo: t('flotas.flota'), principal: true, valor: (f) => f.nombre.toLowerCase(), celda: (f) => <Link href={`/admin/flotas/${f.id}`}>{f.nombre}</Link> },
    { id: 'plan', titulo: t('flotas.plan'), valor: (f) => f.plan, celda: (f) => <span>{f.plan}</span> },
    {
      id: 'arranque', titulo: t('flotas.arranque'), valor: (f) => f.arranque?.hechas ?? -1,
      celda: (f) => f.arranque === null
        ? <StatusChip tono="muted">{t('flotas.sin_dato')}</StatusChip>
        : <StatusChip tono={f.arranque.hechas === f.arranque.total ? 'ok' : 'warn'}>{f.arranque.hechas} de {f.arranque.total}</StatusChip>,
    },
    { id: 'viajes', titulo: t('flotas.viajes'), alinear: 'der', valor: (f) => f.viajes, celda: (f) => numero(f.viajes) },
    {
      id: 'acciones', titulo: t('flotas.acciones'), tituloOculto: true, alinear: 'der',
      celda: (f) => (
        <span>
          <BotonEnlace href={`/admin/flotas/${f.id}`} tamano="sm" variante="secondary">{t('flotas.abrir_ficha')}</BotonEnlace>{' '}
          {/* DOS PUERTAS: dueño y jefe de tráfico ven cosas distintas (visibilidad.ts); `?rol=` solo QUITA visibilidad. */}
          <BotonEnlace href={`/dashboard?tenant=${f.id}&rol=flota_admin`} target="_blank" tamano="sm" variante="ghost">{t('flotas.panel_de_dueno')}</BotonEnlace>{' '}
          <BotonEnlace href={`/dashboard?tenant=${f.id}&rol=encargado`} target="_blank" tamano="sm" variante="ghost">{t('flotas.panel_de_jefe_de')}</BotonEnlace>
        </span>
      ),
    },
  ];

  const cifras: PropsCifra[] = [
    { etiqueta: t('flotas.flotas_dadas_de_alta_2'), valor: r.tenants, formato: 'entero' },
    {
      etiqueta: t('flotas.con_el_arranque_completo'), valor: medidas.length === 0 && filas.length > 0 ? null : completas, formato: 'entero',
      nota: medidas.length < filas.length ? t('flotas.se_midieron_de_flotas', { length: medidas.length, length2: filas.length }) : t('flotas.las_seis_casillas_cumplidas'),
    },
    { etiqueta: t('flotas.viajes_procesados'), valor: r.viajesProcesados, formato: 'entero', nota: t('flotas.de_todas_las_flotas') },
  ];

  return (
    <PantallaClientes t={t} cifras={cifras} alta={(
      /* «Nueva flota» abre el alta en un cajón, sin salir de la lista. La acción es la MISMA (`accionCrearFlota`, con su puerta, su segundo
         factor y su bitácora); `?alta=1` (el enlace de antes) sigue abriéndolo. */
      <FormaEnCajon
        id="alta-flota" titulo={t('flotas.dar_de_alta_una')} accion={accionCrearFlota} boton="Dar de alta" disparador="Nueva flota" tamano="l"
        abiertoInicial={sp.alta === '1' || sp.abrir === 'alta-flota'}
        descripcion={t('flotas.plan_datos_fiscales_y')}
      >
        <CamposAltaFlota planes={planes} t={t} />
      </FormaEnCajon>
    )}>
      <Tarjeta
        titulo={t('flotas.flotas')} estado={filas.length === 0 ? 'vacio' : 'ok'} mensaje={t('flotas.sin_flotas_dadas_de')}
        detalle={t('flotas.da_de_alta_la')}
      >
        <TablaLista
          etiqueta={t('flotas.flotas_dadas_de_alta_2')} columnas={columnas} filas={filas} idFila={(f) => f.id}
          base="/admin/flotas" params={sp} orden="local" paginacion={{ tamano: 25 }}
        />
      </Tarjeta>

    </PantallaClientes>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_flotas');
  return { title: t('flotas.clientes') };
}
