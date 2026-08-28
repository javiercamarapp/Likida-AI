import { revalidatePath } from 'next/cache';
import { requireSuperadmin } from '@/lib/auth/guard';
import { validarDefinicion, darDeAltaAgente } from '@/lib/likida/agentes/definiciones';
import { apagar, encender } from '@/lib/likida/interruptores';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { type ResultadoAccion } from '../ui/forma';
import { PanelAgentesContenido } from './contenido';

export const dynamic = 'force-dynamic';

async function accionAlta(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  'use server';
  const s = await requireSuperadmin();
  try {
    const v = validarDefinicion({
      id: String(fd.get('id') ?? ''),
      nombre: String(fd.get('nombre') ?? ''),
      departamento: String(fd.get('departamento') ?? ''),
      descripcion: String(fd.get('descripcion') ?? ''),
      disparador: String(fd.get('disparador') ?? ''),
      promptRef: String(fd.get('promptRef') ?? ''),
      presupuestoDiaUsd: String(fd.get('presupuestoDiaUsd') ?? ''),
    });
    await darDeAltaAgente(v, s.userId);
    revalidatePath('/admin/agentes');
    return { ok: `"${v.nombre}" quedó en el catálogo como DISEÑADO — sin migración, que es el punto. El runner acotado (0123) lo corre cuando se habilita.` };
  } catch (e) {
    return { error: mensajeParaPantalla(e, 'dar de alta el agente') };
  }
}

/**
 * Apagar/encender la palanca de un agente SIN salir del catálogo.
 *
 * La columna «kill switch» de esta tabla era de solo lectura y el pie mandaba
 * a Observabilidad — un salto de pantalla justo cuando un agente está
 * fabricando ruido. Es el MISMO verbo que usa `/admin/observabilidad`
 * (`apagar`/`encender` de interruptores.ts, con su firma y su bitácora); lo
 * único que cambia es desde dónde se alcanza.
 */
async function accionPalanca(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  'use server';
  // RE-GATEO: el action es un endpoint público en la práctica — el layout
  // solo protegió el render (patrón de administracion.ts).
  const { userId } = await requireSuperadmin();
  const id = String(fd.get('id') ?? '');
  const operacion = String(fd.get('operacion') ?? '');
  const motivo = String(fd.get('motivo') ?? '');
  try {
    if (operacion === 'apagar') {
      await apagar(id, motivo, userId);
    } else if (operacion === 'encender') {
      await encender(id, userId);
    } else {
      return { error: `Operación desconocida: "${operacion}".` };
    }
    revalidatePath('/admin/agentes');
    // También la de Observabilidad: es la MISMA palanca vista desde otra
    // pantalla, y dejarla con el valor viejo en caché haría dudar de cuál de
    // las dos dice la verdad.
    revalidatePath('/admin/observabilidad');
    return { ok: operacion === 'apagar' ? `"${id}" quedó APAGADO.` : `"${id}" quedó encendido.` };
  } catch (e) {
    return { error: mensajeParaPantalla(e, 'mover la palanca del agente') };
  }
}

export default async function PaginaAgentes() {
  await requireSuperadmin();
  return <PanelAgentesContenido accionAlta={accionAlta} accionPalanca={accionPalanca} />;
}
