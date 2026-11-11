import type { ComponentProps, ReactNode } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getFichaCliente } from '@/lib/admin/ficha-cliente';
import {
  getInterruptoresPipelineDeTenant, apagarPipelineDeTenant, encenderPipelineDeTenant, fijarAgenteChoferHabilitado,
} from '@/lib/admin/negocio';
import { requireSuperadmin } from '@/lib/auth/guard';
import { leerAgenteChoferHabilitado } from '@/lib/likida/conductor/repo';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { EstadoError } from '../../../ui-v2/componentes';
import { EsqueletoFicha } from '../../../ui-v2/esqueletos';
import type { ResultadoAccion } from '../../ui/forma';
import { getResumenNegocio } from '@/lib/admin/negocio';
import { getOnboardingFlotas } from '@/lib/admin/onboarding';
import { casillasDeArranque } from '@/lib/admin/arranque';
import { getPersonas } from '@/lib/admin/personas';
import { telefonosJefe } from '@/lib/likida/contactos';
import { accionFacilidad } from '../acciones';
import { Declaracion15 } from './declaracion-15';
import { etiquetaInterruptor } from '../../observabilidad/etiquetas';
import { getPlanes } from '@/lib/saas/suscripcion';
import { accionGestionarPlan } from '../acciones-plan';
import { Ficha360, encabezadoFicha, cifrasFicha } from './ficha';
import { GestionPlan } from './gestion-plan';
import { AvisoPlanEnPausa } from '../../../dashboard/aviso-plan-en-pausa';

import { getT } from '@/lib/i18n/servidor';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /admin/flotas/[id] — la ficha 360 del cliente. La puerta vive en
 * admin/layout.tsx (requireSuperadmin gatea el árbol entero); el contenido
 * en ficha.tsx (exportado para el preview). Un id que no es UUID o sin
 * tenant detrás es 404; una BASE caída es error CON reintento — "no existe"
 * y "no se pudo leer" son afirmaciones distintas.
 */
export default async function PaginaFicha({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<{ seccion?: string }> }) {
  const { t } = await getT('admin_flotas');
  // A39-S05-01/S06-01: puerta PROPIA en el render (el layout no se re-ejecuta en una petición RSC parcial).
  await requireSuperadmin();
  const { id } = await params;
  const seccion = (await searchParams)?.seccion;
  if (!UUID.test(id)) notFound();

  // ADM-6 (auditoría 24): la palanca por flota del pipeline del chofer
  // (`accion` es un server action — el patrón de FormaConAviso/
  // SeccionInterruptores lo exige — así que vive aquí, con acceso a `id`
  // por closure, y no en ficha.tsx, que es puro presentacional).
  async function accionInterruptorPipeline(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
  const { t } = await getT('admin_flotas');
    // RE-GATEO: el action es un endpoint público en la práctica — el layout
    // solo protegió el render (mismo patrón que observabilidad/page.tsx).
    const { userId } = await requireSuperadmin();
    const idCrudo = String(fd.get('id') ?? '');
    const pipeline = idCrudo.startsWith('pipeline:') ? idCrudo.slice('pipeline:'.length) : idCrudo;
    const operacion = String(fd.get('operacion') ?? '');
    const motivo = String(fd.get('motivo') ?? '');
    try {
      if (operacion === 'apagar') await apagarPipelineDeTenant(id, pipeline, motivo, userId);
      else if (operacion === 'encender') await encenderPipelineDeTenant(id, pipeline, userId);
      else return { error: t('flotas.operacion_desconocida') };
    } catch (e) {
      return { error: mensajeParaPantalla(e, `${operacion} el pipeline ${pipeline}`) };
    }
    revalidatePath(`/admin/flotas/${id}`);
    return {
      ok: operacion === 'apagar'
        ? t('flotas.apagado_para_esta_flota', { idCrudo: etiquetaInterruptor(idCrudo) })
        : t('flotas.encendido_para_esta_flota', { idCrudo: etiquetaInterruptor(idCrudo) }),
    };
  }

  // A5-01: el interruptor `agente_chofer_habilitado` (0859). SOLO superadmin (re-gateado aquí: la acción es un endpoint), con motivo y bitácora.
  async function accionAgenteChofer(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
  const { t } = await getT('admin_flotas');
    const { userId } = await requireSuperadmin();
    const operacion = String(fd.get('operacion') ?? '');
    if (operacion !== 'habilitar' && operacion !== 'deshabilitar') return { error: t('flotas.operacion_desconocida') };
    try {
      await fijarAgenteChoferHabilitado(id, operacion === 'habilitar', String(fd.get('motivo') ?? ''), userId);
    } catch (e) {
      return { error: mensajeParaPantalla(e, `${operacion} el Agente 5`) };
    }
    revalidatePath(`/admin/flotas/${id}`);
    return {
      ok: operacion === 'habilitar'
        ? t('flotas.agente_5_habilitado_para')
        : t('flotas.agente_5_deshabilitado_para'),
    };
  }

  // "No existe" (404) y "no se pudo leer" (error con reintento) son afirmaciones distintas.
  const ficha = await getFichaCliente(id).catch(() => 'error' as const);
  if (ficha === null) notFound();
  if (ficha === 'error') {
    return (
      <PantallaFicha area={t('ficha.eyebrow')} titulo={t('flotas.cliente')} apoyo={t('flotas.no_se_pudo_leer')} volver={{ href: '/admin/flotas', etiqueta: t('flotas_ficha.volver_a_clientes') }}>
        <EstadoError reintentar>{t('flotas.no_se_pudo_leer_2')}</EstadoError>
      </PantallaFicha>
    );
  }

  // Sección aparte, resiliente por su lado: sin la 0297 aplicada, o con la
  // lectura caída, la ficha entera NO debe dejar de mostrarse por esto.
  const interruptoresPipeline = await getInterruptoresPipelineDeTenant(id).catch(() => null);

  // `leerAgenteChoferHabilitado` nunca lanza y falla cerrado: «compuerta_ilegible» se dice como tal, no como «apagado».
  const agenteChofer = await leerAgenteChoferHabilitado(id);

  // Los planes, resiliente por su lado: `null` = no se pudieron leer (se dice), nunca una lista vacía que parezca «no hay planes».
  const planes = await getPlanes().then((l) => l.map((p) => ({ clave: p.clave, nombre: p.nombre }))).catch(() => null);

  // Arranque y equipo, cada lectura por su lado: una que falle deja SU sección en «no se pudo leer» y la ficha sigue.
  const [resumen, onboarding, telefonos, personasTodas] = await Promise.all([
    getResumenNegocio().catch(() => null),
    getOnboardingFlotas().catch(() => null),
    telefonosJefe([id]).catch(() => null),
    getPersonas().catch(() => null),
  ]);
  const fila = resumen?.flotas.find((x) => x.id === id);
  const arranque = resumen === null || !fila ? null : {
    casillas: casillasDeArranque({
      id, viajes: fila.viajes, politicaPropia: fila.politicaPropia, telefono: telefonos === null ? undefined : telefonos[id] ?? null,
      telefonosLegibles: telefonos !== null,
      onboarding: onboarding === null ? null
        : onboarding.get(id) ?? { credenciales: { total: 0, probadas: 0 }, avisosConfigurados: 0, avisoPrivacidad: { razonSocial: false, domicilio: false } },
    }),
    declaracion: (
      <Declaracion15 flotaId={id} ded={fila.facilidad15?.dedicacionExclusivaCarga} reg={fila.facilidad15?.regimenElegible} accion={accionFacilidad} />
    ),
  };

  const enc = encabezadoFicha(ficha, t);
  return (
    <PantallaFicha {...enc} area={t('ficha.eyebrow')} formaCifras="tarjetas" cifras={cifrasFicha(ficha, t, { personas: personasTodas === null ? null : personasTodas.personas.filter((p) => p.tenantId === id), casillas: arranque?.casillas ?? null })} etiquetaCifras={t('flotas_ficha.resumen_de', { nombre: ficha.tenant.nombre })}>
    <AvisoPlanEnPausa tenantId={id} />
    <Ficha360
      t={t}
      f={ficha} seccionInicial={seccion}
      personas={personasTodas === null ? null : personasTodas.personas.filter((p) => p.tenantId === id)}
      accesoLegible={personasTodas?.accesoLegible ?? false}
      arranque={arranque}
      interruptoresPipeline={interruptoresPipeline} accionInterruptorPipeline={accionInterruptorPipeline}
      agenteChofer={agenteChofer} accionAgenteChofer={accionAgenteChofer}
      gestionPlan={<GestionPlan tenantId={id} planes={planes} accion={accionGestionarPlan} />}
    />
    </PantallaFicha>
  );
}

/** El marco de la ficha, UNO solo para toda la ruta: el mismo encabezado cuando la lectura falla y cuando carga. */
function PantallaFicha({ children, ...marco }: Omit<ComponentProps<typeof EsqueletoFicha>, 'children'> & { children: ReactNode }) {
  return <EsqueletoFicha {...marco}>{children}</EsqueletoFicha>;
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_flotas');
  return { title: t('flotas.flota') };
}
