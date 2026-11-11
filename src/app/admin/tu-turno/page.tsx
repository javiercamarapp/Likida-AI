import type { Metadata } from 'next';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireSuperadmin } from '@/lib/auth/guard';
import {
  getEstadoBus, getPrsAbiertos, crearOrden, resolverPieza, esOrdenUi, emailDeActor,
} from '@/lib/admin/bus';
import { getBandejaEscalaciones } from '@/lib/admin/escalaciones';
import { getAgentesParados } from '@/lib/admin/agentes-parados';
import { leerResumenBandeja } from '@/lib/admin/cola-aprobacion';
import { bandejaPendiente } from '@/lib/likida/agentes/cola';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { ahoraMs } from '@/lib/saludo';
import { VistaTuTurno } from './vista';

import type { TrDe } from '@/lib/i18n/tr_tipos';
import { getT } from '@/lib/i18n/servidor';
export const dynamic = 'force-dynamic';

/**
 * TU TURNO — la bandeja única de Fase D: TODO lo que espera el tap de Javier,
 * de todas las fuentes, en una pantalla operable desde el teléfono.
 *
 * Qué junta (y de dónde — nada aquí se mide nuevo):
 *  · Piezas de las rutinas de la Mac (bus_pieza, 0127) — se aprueban AQUÍ.
 *  · Envíos redactados (cola_aprobacion, 0117) — se enseñan, se resuelven en
 *    /admin/aprobaciones (ahí vive la edición del cuerpo y el candado).
 *  · Escalaciones (las 6 fuentes de lib/admin/escalaciones) — top y link.
 *  · PRs abiertos (GitHub) — requiere la llave GITHUB_TOKEN; sin ella se
 *    dice, no se finge un cero.
 *  · Las rutinas launchd con su última corrida y el botón de correr ahora —
 *    el botón ENCOLA una orden (bus_orden); la Mac la ejecuta y firma. Esta
 *    pantalla jamás ejecuta nada en la Mac directamente.
 *
 * El cuerpo vive en vista.tsx (patrón de agentes/peajes): aquí solo auth,
 * lecturas y las dos server actions.
 */
/** A37-S08-07: la URL lleva solo CÓDIGOS cerrados; el texto sale de aquí. Un enlace `?error=<texto>` ajeno ya no
 *  se pinta con el estilo de alerta de la consola (suplantación de contenido). */
const avisos = (t: TrDe<'admin_inicio'>): Record<string, string> => ({
  pieza_aprobada: t('tu_turno.pieza_aprobada_la_mac'),
  pieza_descartada: t('tu_turno.pieza_descartada'),
  encargo: t('tu_turno.encargo_encolado_la_mac'),
  orden: t('tu_turno.orden_encolada_la_mac'),
});
const errores = (t: TrDe<'admin_inicio'>): Record<string, string> => ({
  pieza: t('tu_turno.no_se_pudo_resolver'),
  orden: t('tu_turno.no_se_pudo_encolar'),
});

export default async function PaginaTuTurno({
  searchParams,
}: {
  searchParams: Promise<{ aviso?: string; error?: string; fuente?: string }>;
}) {
  const sesion = await requireSuperadmin();
  const { t } = await getT('admin_inicio');
  const { aviso, error, fuente } = await searchParams;
  const ahora = ahoraMs();

  const [bus, escalaciones, urgentes, normales, prs, parados, cola] = await Promise.all([
    getEstadoBus(),
    getBandejaEscalaciones(ahora),
    bandejaPendiente('urgente'),
    bandejaPendiente('normal'),
    getPrsAbiertos(),
    getAgentesParados(ahora), // nunca lanza: null = sin dato
    leerResumenBandeja(ahora),
  ]);
  // La misma cola que /admin/aprobaciones: lo urgente primero, sin remezclar.
  const envios = [...urgentes, ...normales];

  async function accionPieza(fd: FormData) {
    'use server';
    const s = await requireSuperadmin();
    const id = String(fd.get('pieza') ?? '');
    const accion = String(fd.get('accion') ?? '');
    try {
      if (accion !== 'aprobada' && accion !== 'descartada') throw new Error('Acción desconocida.');
      // ADM-12: `resolverPieza` guarda un CORREO en `resuelto_por` (lo que
      // Javier lee en la Mac), no un uuid — `s.userId` sin traducir dejaba
      // ahí un uuid ilegible. Sin correo resuelto, se dice el uuid con su
      // porqué en vez de fingir un correo que no se pudo leer.
      const actor = (await emailDeActor(s.userId)) ?? `uuid:${s.userId} (correo no resuelto)`;
      await resolverPieza(id, accion, actor);
      revalidatePath('/admin/tu-turno');
    } catch (e) {
      mensajeParaPantalla(e, 'resolver la pieza'); // registra la falla del sistema; la URL lleva solo un código
      redirect('/admin/tu-turno?error=pieza');
    }
    redirect(`/admin/tu-turno?aviso=${accion === 'aprobada' ? 'pieza_aprobada' : 'pieza_descartada'}`);
  }

  async function accionOrden(fd: FormData) {
    'use server';
    const s = await requireSuperadmin();
    const tipo = String(fd.get('tipo') ?? '');
    const rutina = String(fd.get('rutina') ?? '') || null;
    // El contenido SOLO viaja en editar_encargo (validarOrden lo exige ahí);
    // en las demás órdenes un campo fantasma no debe colarse al payload.
    const contenido = String(fd.get('contenido') ?? '').trim();
    try {
      if (!esOrdenUi(tipo)) throw new Error('Esa orden no existe.');
      // ADM-12: mismo caso que accionPieza — `crearOrden` guarda un CORREO
      // en `creado_por`, no un uuid.
      const actor = (await emailDeActor(s.userId)) ?? `uuid:${s.userId} (correo no resuelto)`;
      await crearOrden(tipo, rutina, actor, tipo === 'editar_encargo' ? { contenido } : {});
      revalidatePath('/admin/tu-turno');
    } catch (e) {
      mensajeParaPantalla(e, 'encolar la orden');
      redirect('/admin/tu-turno?error=orden');
    }
    redirect(`/admin/tu-turno?aviso=${tipo === 'editar_encargo' ? 'encargo' : 'orden'}`);
  }

  return (
    <VistaTuTurno
      t={t}
      bus={bus}
      escalaciones={escalaciones}
      envios={envios}
      prs={prs}
      ahora={ahora}
      parados={parados}
      cola={cola}
      aviso={aviso ? avisos(t)[aviso] : undefined}
      error={error ? errores(t)[error] : undefined}
      sesionNombre={sesion.nombre ?? sesion.userId}
      accionPieza={accionPieza}
      accionOrden={accionOrden}
      fuente={['piezas', 'envios', 'cambios', 'escalaciones', 'rutinas'].includes(fuente ?? '') ? fuente : ''}
    />
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_inicio');
  return { title: t('tu_turno.tu_turno') };
}
