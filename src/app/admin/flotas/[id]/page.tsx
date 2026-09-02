import { notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getFichaCliente } from '@/lib/admin/ficha-cliente';
import {
  getInterruptoresPipelineDeTenant, apagarPipelineDeTenant, encenderPipelineDeTenant,
} from '@/lib/admin/negocio';
import { requireSuperadmin } from '@/lib/auth/guard';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { EstadoError } from '../../ui/kit';
import type { ResultadoAccion } from '../../ui/forma';
import { etiquetaInterruptor } from '../../observabilidad/etiquetas';
import { Ficha360 } from './ficha';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /admin/flotas/[id] — la ficha 360 del cliente. La puerta vive en
 * admin/layout.tsx (requireSuperadmin gatea el árbol entero); el contenido
 * en ficha.tsx (exportado para el preview). Un id que no es UUID o sin
 * tenant detrás es 404; una BASE caída es error CON reintento — "no existe"
 * y "no se pudo leer" son afirmaciones distintas.
 */
export default async function PaginaFicha({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  // ADM-6 (auditoría 24): la palanca por flota del pipeline del chofer
  // (`accion` es un server action — el patrón de FormaConAviso/
  // SeccionInterruptores lo exige — así que vive aquí, con acceso a `id`
  // por closure, y no en ficha.tsx, que es puro presentacional).
  async function accionInterruptorPipeline(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
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
      else return { error: 'Operación desconocida.' };
    } catch (e) {
      return { error: mensajeParaPantalla(e, `${operacion} el pipeline ${pipeline}`) };
    }
    revalidatePath(`/admin/flotas/${id}`);
    return {
      ok: operacion === 'apagar'
        ? `${etiquetaInterruptor(idCrudo)} APAGADO para esta flota. Quedó firmado en la bitácora.`
        : `${etiquetaInterruptor(idCrudo)} encendido para esta flota.`,
    };
  }

  let ficha;
  try {
    ficha = await getFichaCliente(id);
  } catch {
    return (
      <main className="p-5">
        <EstadoError mensaje="No se pudo leer la ficha del cliente — la base no respondió." />
      </main>
    );
  }
  if (!ficha) notFound();

  // Sección aparte, resiliente por su lado: sin la 0297 aplicada, o con la
  // lectura caída, la ficha entera NO debe dejar de mostrarse por esto.
  const interruptoresPipeline = await getInterruptoresPipelineDeTenant(id).catch(() => null);

  return <Ficha360 f={ficha} interruptoresPipeline={interruptoresPipeline} accionInterruptorPipeline={accionInterruptorPipeline} />;
}
