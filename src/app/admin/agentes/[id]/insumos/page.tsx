import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireSuperadmin } from '@/lib/auth/guard';
import { listarAgentes, DEPARTAMENTOS } from '@/lib/likida/agentes/definiciones';
import {
  tiposAceptadosPorAgente, listarInsumosDeAgente, contarInsumosDeAgente, urlsFirmadasInsumos,
  crearInsumoArchivo, crearInsumoTexto, subirArchivoInsumo,
  esTipoInsumo, TIPOS_ARCHIVO, TIPOS_TEXTO, type InsumoAgente,
} from '@/lib/likida/agentes/insumos';
import { AGENTES_FINANCIEROS } from '@/lib/likida/agentes/finanzas';
import { DatoInvalido } from '@/lib/likida/errores';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { Aviso, EstadoVacio, MarcoPagina, Tarjeta } from '../../../../ui-v2/componentes';
import { type ResultadoAccion } from '../../../ui/forma';
import { FormularioInsumo, ListaInsumos } from './zona-insumos';
import { getT } from '@/lib/i18n/servidor';
import { rico } from '@/lib/i18n/rico';

export const dynamic = 'force-dynamic';

/**
 * `/admin/agentes/[id]/insumos` — la tarjeta expandida de UN agente del
 * catálogo (Fase D, plan-de-cierre.md: "la bandeja de contexto universal").
 * La tabla de `/admin/agentes` sigue siendo el resumen de los ~60 agentes;
 * esta página es donde Javier de verdad arrastra y suelta, y donde la
 * tarjeta enseña "qué le has dado, qué usó, qué aprendió de eso".
 */
export default async function PaginaInsumosAgente({ params }: { params: Promise<{ id: string }> }) {
  const { t, idioma } = await getT('admin_sistema');
  const s = await requireSuperadmin();
  const { id } = await params;

  const agentes = await listarAgentes();
  const agente = agentes.find((a) => a.id === id);
  if (!agente) notFound();
  // Capturado aparte de `agente`: TS no conserva el `if (!agente) notFound()`
  // de arriba dentro de las Server Actions anidadas más abajo (cruzan un
  // límite de función), así que ambas leen esta constante ya angosta.
  const departamento = agente.departamento;

  // Honestidad (auditoría 10-nov, P1): solo los agentes financieros consumen insumos; para los demás el mensaje «se procesa en la siguiente corrida» era falso.
  const LEE_INSUMOS = (AGENTES_FINANCIEROS as readonly string[]).includes(agente.id);
  const tiposAceptados = tiposAceptadosPorAgente(agente.id, departamento);
  const insumos = await listarInsumosDeAgente(agente.id);
  const totalInsumos = await contarInsumosDeAgente(agente.id);
  const rutas = insumos.map((i) => i.storagePath).filter((p): p is string => p !== null);
  const firmas = await urlsFirmadasInsumos(rutas);

  async function accionSubirArchivo(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t } = await getT('admin_sistema');
    const { userId } = await requireSuperadmin();
    try {
      const tipo = String(fd.get('tipo') ?? '');
      const titulo = String(fd.get('titulo') ?? '').trim();
      const archivo = fd.get('archivo');
      if (!esTipoInsumo(tipo) || !TIPOS_ARCHIVO.includes(tipo)) throw new DatoInvalido(t('agentes_insumos.tipo_de_insumo_invalido'));
      if (!titulo) throw new DatoInvalido(t('agentes_insumos.ponle_un_titulo_al_insumo'));
      if (!(archivo instanceof File) || archivo.size === 0) throw new DatoInvalido(t('agentes_insumos.elige_un_archivo_para_subir'));
      const ruta = await subirArchivoInsumo(id, archivo, tipo as 'documento' | 'imagen' | 'video', departamento);
      await crearInsumoArchivo({
        agente: id, departamento, titulo, tipo: tipo as 'documento' | 'imagen' | 'video',
        storagePath: ruta, subidoPor: userId,
      });
      revalidatePath(`/admin/agentes/${id}/insumos`);
      return { ok: (AGENTES_FINANCIEROS as readonly string[]).includes(id) ? t('agentes_insumos.quedo_guardado_se_procesa_en_la', { titulo }) : t('agentes_insumos.quedo_guardado_este_agente_aun_no', { titulo }) };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'subir el insumo', idioma) };
    }
  }

  async function accionSubirTexto(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { t } = await getT('admin_sistema');
    const { userId } = await requireSuperadmin();
    try {
      const tipo = String(fd.get('tipo') ?? '');
      const titulo = String(fd.get('titulo') ?? '').trim();
      const contenido = String(fd.get('contenido') ?? '').trim();
      if (!esTipoInsumo(tipo) || !TIPOS_TEXTO.includes(tipo)) throw new DatoInvalido(t('agentes_insumos.tipo_de_insumo_invalido'));
      if (!titulo) throw new DatoInvalido(t('agentes_insumos.ponle_un_titulo_al_insumo'));
      if (!contenido) throw new DatoInvalido(tipo === 'link' ? t('agentes_insumos.pega_el_link') : t('agentes_insumos.escribe_la_idea'));
      await crearInsumoTexto({
        agente: id, departamento, titulo, tipo: tipo as 'link' | 'texto',
        contenido, subidoPor: userId,
      });
      revalidatePath(`/admin/agentes/${id}/insumos`);
      return { ok: (AGENTES_FINANCIEROS as readonly string[]).includes(id) ? t('agentes_insumos.quedo_guardado_se_procesa_en_la', { titulo }) : t('agentes_insumos.quedo_guardado_este_agente_aun_no', { titulo }) };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'guardar el insumo', idioma) };
    }
  }

  const rotuloDepartamento = DEPARTAMENTOS.find((d) => d.valor === agente.departamento)?.rotulo ?? agente.departamento;
  const insumosConUrl: Array<InsumoAgente & { url: string | null }> = insumos.map((i) => ({
    ...i, url: i.storagePath ? firmas.get(i.storagePath) ?? null : null,
  }));

  return (
    <MarcoPagina titulo={t('agentes_insumos.bandeja_de_contexto', { agente: agente.nombre })}>
      <Aviso tono="info">{t('agentes_insumos.id', { rotuloDepartamento })}{' '}<code className="cifra-mono">{agente.id}</code>{' '}{t('agentes_insumos.entre_mas_le_das_mas_entiende')}{' '}{LEE_INSUMOS
          ? <>{t('agentes_insumos.todo_lo_que_sueltes_aqui_se')}{' '}{s.nombre ?? 'superadmin'}.</>
          : <>{rico(t('agentes_insumos.strong_este_agente_aun_no_lee'), { strong: (c) => <strong>{c}</strong> })}{' '}{s.nombre ?? 'superadmin'}.</>}
      </Aviso>

      <Tarjeta titulo={t('agentes_insumos.soltar_un_insumo_nuevo')}>
        <p className="m-0 mb-3 text-xs text-muted">{t('agentes_insumos.este_agente_acepta', { tiposAceptados: tiposAceptados.join(', ') })}</p>
        <FormularioInsumo
          tiposAceptados={tiposAceptados}
          accionArchivo={accionSubirArchivo}
          accionTexto={accionSubirTexto}
        />
      </Tarjeta>

      <Tarjeta titulo={t('agentes_insumos.que_le_has_dado', { v: totalInsumos > insumos.length ? t('agentes_insumos.n_de_total', { n: insumos.length, total: totalInsumos }) : insumos.length })}>
        {insumos.length === 0 ? (
          <EstadoVacio titulo={t('agentes_insumos.sin_insumos')} contenido>{t('agentes_insumos.sin_insumos_todavia_suelta_el_primero')}</EstadoVacio>
        ) : (
          <ListaInsumos insumos={insumosConUrl} />
        )}
      </Tarjeta>
    </MarcoPagina>
  );
}

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT('admin_sistema');
  return { title: t('agentes_insumos.insumos_del_agente') };
}
