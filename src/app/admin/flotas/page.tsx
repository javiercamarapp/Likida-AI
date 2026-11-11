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
import { BotonEnlace, EstadoError, FormaEnCajon, Icono, MarcoPagina, StatusChip, Tarjeta } from '../../ui-v2/componentes';
import { Cifra, TiraCifras } from '../../ui-v2/graficas';
import { TablaLista, type ColumnaTabla } from '../../ui-v2/datos';
import { accionCrearFlota } from './acciones';
import { CamposAltaFlota } from './alta';

export const dynamic = 'force-dynamic';

/** El marco de la pantalla, UNO solo (también para el error de lectura): encabezado y acción de alta no cambian entre estados. */
function PantallaClientes({ children, alta }: { children: ReactNode; alta?: ReactNode }) {
  return (
    <MarcoPagina
      area="Negocio" titulo="Clientes"
      apoyo="Flotas dadas de alta, su plan y cuánto avanzó su arranque."
      acciones={alta ?? <BotonEnlace href="/admin/flotas?alta=1" variante="primary" icono={<Icono icono={Plus} />}>Nueva flota</BotonEnlace>}
    >
      {children}
    </MarcoPagina>
  );
}

interface Fila { id: string; nombre: string; plan: string; viajes: number; arranque: { hechas: number; total: number } | null }

/**
 * Clientes — la tabla maestra de flotas. La declaración del 15 %, el checklist de arranque y las señales de uso viven en la ficha
 * de cada flota (`/admin/flotas/[id]`); el ranking de costo de IA vive en Consumo. Cada lectura cae por su lado: un teléfono o un
 * onboarding que no se pudo leer deja «—» en el arranque de TODAS (no «0 de 6») y la tabla sigue.
 */
export default async function FlotasPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  // A39-S05-01/S06-01: puerta PROPIA en el render (el layout no se re-ejecuta en una petición RSC parcial).
  await requireSuperadmin();
  const sp = (await searchParams) ?? {};
  const r = await getResumenNegocio().catch(() => null);
  if (r === null) return <PantallaClientes><EstadoError reintentar>No se pudo leer la lista de flotas.</EstadoError></PantallaClientes>;

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
    { id: 'flota', titulo: 'Flota', principal: true, valor: (f) => f.nombre.toLowerCase(), celda: (f) => <Link href={`/admin/flotas/${f.id}`}>{f.nombre}</Link> },
    { id: 'plan', titulo: 'Plan', valor: (f) => f.plan, celda: (f) => <span>{f.plan}</span> },
    {
      id: 'arranque', titulo: 'Arranque', valor: (f) => f.arranque?.hechas ?? -1,
      celda: (f) => f.arranque === null
        ? <StatusChip tono="muted">Sin dato</StatusChip>
        : <StatusChip tono={f.arranque.hechas === f.arranque.total ? 'ok' : 'warn'}>{f.arranque.hechas} de {f.arranque.total}</StatusChip>,
    },
    { id: 'viajes', titulo: 'Viajes', alinear: 'der', valor: (f) => f.viajes, celda: (f) => numero(f.viajes) },
    {
      id: 'acciones', titulo: 'Acciones', tituloOculto: true, alinear: 'der',
      celda: (f) => (
        <span>
          <BotonEnlace href={`/admin/flotas/${f.id}`} tamano="sm" variante="secondary">Abrir ficha</BotonEnlace>{' '}
          {/* DOS PUERTAS: dueño y jefe de tráfico ven cosas distintas (visibilidad.ts); `?rol=` solo QUITA visibilidad. */}
          <BotonEnlace href={`/dashboard?tenant=${f.id}&rol=flota_admin`} target="_blank" tamano="sm" variante="ghost">Panel de dueño</BotonEnlace>{' '}
          <BotonEnlace href={`/dashboard?tenant=${f.id}&rol=encargado`} target="_blank" tamano="sm" variante="ghost">Panel de jefe de flota</BotonEnlace>
        </span>
      ),
    },
  ];

  return (
    <PantallaClientes alta={(
      /* «Nueva flota» abre el alta en un cajón, sin salir de la lista. La acción es la MISMA (`accionCrearFlota`, con su puerta, su segundo
         factor y su bitácora); `?alta=1` (el enlace de antes) sigue abriéndolo. */
      <FormaEnCajon
        id="alta-flota" titulo="Dar de alta una flota" accion={accionCrearFlota} boton="Dar de alta" disparador="Nueva flota" tamano="l"
        abiertoInicial={sp.alta === '1' || sp.abrir === 'alta-flota'}
        descripcion="Plan, datos fiscales y administrador. El RFC se valida en el alta porque es la única oportunidad barata: con uno inválido, el motor apaga la comprobación de a nombre de quién vienen las facturas. Los datos fiscales se pueden completar después, pero a medias no se aceptan."
      >
        <CamposAltaFlota planes={planes} />
      </FormaEnCajon>
    )}>
      <TiraCifras etiqueta="Resumen de clientes">
        <Cifra etiqueta="Flotas dadas de alta" valor={r.tenants} formato="entero" />
        <Cifra
          etiqueta="Con el arranque completo" valor={medidas.length === 0 && filas.length > 0 ? null : completas} formato="entero"
          nota={medidas.length < filas.length ? `Se midieron ${medidas.length} de ${filas.length} flotas` : 'Las seis casillas cumplidas'}
        />
        <Cifra etiqueta="Viajes procesados" valor={r.viajesProcesados} formato="entero" nota="De todas las flotas, histórico" />
      </TiraCifras>

      <Tarjeta
        titulo="Flotas" estado={filas.length === 0 ? 'vacio' : 'ok'} mensaje="Sin flotas dadas de alta"
        detalle="Da de alta la primera con «Nueva flota»."
      >
        <TablaLista
          etiqueta="Flotas dadas de alta" columnas={columnas} filas={filas} idFila={(f) => f.id}
          base="/admin/flotas" params={sp} orden="local" paginacion={{ tamano: 25 }}
        />
      </Tarjeta>

    </PantallaClientes>
  );
}

export const metadata: Metadata = { title: 'Clientes' };
