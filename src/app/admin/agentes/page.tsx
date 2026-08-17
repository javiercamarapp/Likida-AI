import { revalidatePath } from 'next/cache';
import { requireSuperadmin } from '@/lib/auth/guard';
import { validarDefinicion, darDeAltaAgente } from '@/lib/likida/agentes/definiciones';
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

export default async function PaginaAgentes() {
  await requireSuperadmin();
  return <PanelAgentesContenido accionAlta={accionAlta} />;
}
