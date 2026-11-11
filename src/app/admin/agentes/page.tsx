import type { Metadata } from 'next';
import { revalidatePath } from 'next/cache';
import { requireSuperadmin } from '@/lib/auth/guard';
import { validarDefinicion, darDeAltaAgente } from '@/lib/likida/agentes/definiciones';
import { apagar, encender } from '@/lib/likida/interruptores';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { actualizarAgente } from '@/lib/likida/agentes/config-agente';
import { type ResultadoAccion } from '@/app/ui-v2/componentes';
import { PanelAgentesContenido } from './contenido';

import { getT } from '@/lib/i18n/servidor';
export const dynamic = 'force-dynamic';

async function accionAlta(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  'use server';
  const { t } = await getT('admin_agentes');
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
    return { ok: t('agentes.quedo_en_el_catalogo', { nombre: v.nombre }) };
  } catch (e) {
    return { error: mensajeParaPantalla(e, t('agentes.dar_de_alta_el')) };
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
  const { t } = await getT('admin_agentes');
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
      // Simétrico a apagar: encender también exige motivo y lo firma la bitácora.
      if (!motivo.trim()) return { error: t('agentes.encender_exige_un_motivo') };
      await encender(id, userId, motivo);
    } else {
      return { error: t('agentes.operacion_desconocida', { operacion }) };
    }
    revalidatePath('/admin/agentes');
    // También la de Observabilidad: es la MISMA palanca vista desde otra
    // pantalla, y dejarla con el valor viejo en caché haría dudar de cuál de
    // las dos dice la verdad.
    revalidatePath('/admin/observabilidad');
    return { ok: operacion === 'apagar' ? t('agentes.quedo_apagado', { id }) : t('agentes.quedo_encendido', { id }) };
  } catch (e) {
    return { error: mensajeParaPantalla(e, t('agentes.mover_la_palanca_del')) };
  }
}

/**
 * Configurar un agente (estado, runner, presupuesto, modelo) con motivo obligatorio y bitácora `agente.config`. Re-gatea superadmin
 * adentro: el action es un endpoint público en la práctica.
 */
async function accionConfig(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  'use server';
  const { userId } = await requireSuperadmin();
  const id = String(fd.get('id') ?? '');
  try {
    const r = await actualizarAgente(id, {
      estado: String(fd.get('estado') ?? ''),
      runnerHabilitado: String(fd.get('runnerHabilitado') ?? ''),
      presupuestoDiaUsd: String(fd.get('presupuestoDiaUsd') ?? ''),
      modeloRol: String(fd.get('modeloRol') ?? ''),
    }, String(fd.get('motivo') ?? ''), userId);
    revalidatePath('/admin/agentes');
    revalidatePath('/admin/observabilidad');
    return { ok: `"${id}" quedó configurado (${Object.keys(r.cambios).length} cambio${Object.keys(r.cambios).length === 1 ? '' : 's'}, firmado en la bitácora).` };
  } catch (e) {
    return { error: mensajeParaPantalla(e, 'configurar el agente') };
  }
}

export default async function PaginaAgentes({ searchParams }: { searchParams: Promise<{ pag?: string; ver?: string }> }) {
  await requireSuperadmin();
  const params = (await searchParams) ?? {};
  return <PanelAgentesContenido accionAlta={accionAlta} accionPalanca={accionPalanca} accionConfig={accionConfig} params={params} />;
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_agentes');
  return { title: t('agentes.agentes') };
}
