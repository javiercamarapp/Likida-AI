import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireSuperadmin } from '@/lib/auth/guard';
import {
  getEstadoBus, getPrsAbiertos, crearOrden, resolverPieza, esOrdenUi,
} from '@/lib/admin/bus';
import { getBandejaEscalaciones } from '@/lib/admin/escalaciones';
import { bandejaPendiente } from '@/lib/likida/agentes/cola';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { ahoraMs } from '@/lib/saludo';
import { VistaTuTurno } from './vista';

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
export default async function PaginaTuTurno({
  searchParams,
}: {
  searchParams: Promise<{ aviso?: string; error?: string }>;
}) {
  const sesion = await requireSuperadmin();
  const { aviso, error } = await searchParams;
  const ahora = ahoraMs();

  const [bus, escalaciones, urgentes, normales, prs] = await Promise.all([
    getEstadoBus(),
    getBandejaEscalaciones(ahora),
    bandejaPendiente('urgente'),
    bandejaPendiente('normal'),
    getPrsAbiertos(),
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
      await resolverPieza(id, accion, s.userId);
      revalidatePath('/admin/tu-turno');
    } catch (e) {
      redirect(`/admin/tu-turno?error=${encodeURIComponent(mensajeParaPantalla(e, 'resolver la pieza'))}`);
    }
    redirect(`/admin/tu-turno?aviso=${encodeURIComponent(accion === 'aprobada' ? 'Pieza aprobada — la Mac la ve al instante.' : 'Pieza descartada.')}`);
  }

  async function accionOrden(fd: FormData) {
    'use server';
    const s = await requireSuperadmin();
    const tipo = String(fd.get('tipo') ?? '');
    const rutina = String(fd.get('rutina') ?? '') || null;
    try {
      if (!esOrdenUi(tipo)) throw new Error('Esa orden no existe.');
      await crearOrden(tipo, rutina, s.userId);
      revalidatePath('/admin/tu-turno');
    } catch (e) {
      redirect(`/admin/tu-turno?error=${encodeURIComponent(mensajeParaPantalla(e, 'encolar la orden'))}`);
    }
    redirect(`/admin/tu-turno?aviso=${encodeURIComponent('Orden encolada — la Mac la toma en su siguiente latido (≤5 min).')}`);
  }

  return (
    <VistaTuTurno
      bus={bus}
      escalaciones={escalaciones}
      envios={envios}
      prs={prs}
      ahora={ahora}
      aviso={aviso}
      error={error}
      sesionNombre={sesion.nombre ?? sesion.userId}
      accionPieza={accionPieza}
      accionOrden={accionOrden}
    />
  );
}
