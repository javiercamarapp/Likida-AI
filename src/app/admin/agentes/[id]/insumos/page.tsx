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

export const dynamic = 'force-dynamic';

/**
 * `/admin/agentes/[id]/insumos` — la tarjeta expandida de UN agente del
 * catálogo (Fase D, plan-de-cierre.md: "la bandeja de contexto universal").
 * La tabla de `/admin/agentes` sigue siendo el resumen de los ~60 agentes;
 * esta página es donde Javier de verdad arrastra y suelta, y donde la
 * tarjeta enseña "qué le has dado, qué usó, qué aprendió de eso".
 */
export default async function PaginaInsumosAgente({ params }: { params: Promise<{ id: string }> }) {
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
    const { userId } = await requireSuperadmin();
    try {
      const tipo = String(fd.get('tipo') ?? '');
      const titulo = String(fd.get('titulo') ?? '').trim();
      const archivo = fd.get('archivo');
      if (!esTipoInsumo(tipo) || !TIPOS_ARCHIVO.includes(tipo)) throw new DatoInvalido('Tipo de insumo inválido.');
      if (!titulo) throw new DatoInvalido('Ponle un título al insumo.');
      if (!(archivo instanceof File) || archivo.size === 0) throw new DatoInvalido('Elige un archivo para subir.');
      const ruta = await subirArchivoInsumo(id, archivo, tipo as 'documento' | 'imagen' | 'video', departamento);
      await crearInsumoArchivo({
        agente: id, departamento, titulo, tipo: tipo as 'documento' | 'imagen' | 'video',
        storagePath: ruta, subidoPor: userId,
      });
      revalidatePath(`/admin/agentes/${id}/insumos`);
      return { ok: (AGENTES_FINANCIEROS as readonly string[]).includes(id) ? `"${titulo}" quedó guardado — se procesa en la siguiente corrida de este agente.` : `"${titulo}" quedó guardado. Este agente aún no lee insumos, así que ninguna corrida lo usa todavía.` };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'subir el insumo') };
    }
  }

  async function accionSubirTexto(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const { userId } = await requireSuperadmin();
    try {
      const tipo = String(fd.get('tipo') ?? '');
      const titulo = String(fd.get('titulo') ?? '').trim();
      const contenido = String(fd.get('contenido') ?? '').trim();
      if (!esTipoInsumo(tipo) || !TIPOS_TEXTO.includes(tipo)) throw new DatoInvalido('Tipo de insumo inválido.');
      if (!titulo) throw new DatoInvalido('Ponle un título al insumo.');
      if (!contenido) throw new DatoInvalido(tipo === 'link' ? 'Pega el link.' : 'Escribe la idea.');
      await crearInsumoTexto({
        agente: id, departamento, titulo, tipo: tipo as 'link' | 'texto',
        contenido, subidoPor: userId,
      });
      revalidatePath(`/admin/agentes/${id}/insumos`);
      return { ok: (AGENTES_FINANCIEROS as readonly string[]).includes(id) ? `"${titulo}" quedó guardado — se procesa en la siguiente corrida de este agente.` : `"${titulo}" quedó guardado. Este agente aún no lee insumos, así que ninguna corrida lo usa todavía.` };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'guardar el insumo') };
    }
  }

  const rotuloDepartamento = DEPARTAMENTOS.find((d) => d.valor === agente.departamento)?.rotulo ?? agente.departamento;
  const insumosConUrl: Array<InsumoAgente & { url: string | null }> = insumos.map((i) => ({
    ...i, url: i.storagePath ? firmas.get(i.storagePath) ?? null : null,
  }));

  return (
    <MarcoPagina titulo={`${agente.nombre} — bandeja de contexto`}>
      <Aviso tono="info">
        {rotuloDepartamento} · id <code className="cifra-mono">{agente.id}</code> — entre más le das, más entiende.{' '}
        {LEE_INSUMOS
          ? <>Todo lo que sueltes aquí se procesa en la SIGUIENTE corrida de este agente; sesión actual: {s.nombre ?? 'superadmin'}.</>
          : <><strong>Este agente aún no lee insumos.</strong> Lo que subas se guarda, pero ninguna corrida lo usa todavía: hoy solo los leen los cuatro agentes financieros. Sesión actual: {s.nombre ?? 'superadmin'}.</>}
      </Aviso>

      <Tarjeta titulo="Soltar un insumo nuevo">
        <p className="m-0 mb-3 text-xs text-muted">
          Este agente acepta: {tiposAceptados.join(', ')}.
        </p>
        <FormularioInsumo
          tiposAceptados={tiposAceptados}
          accionArchivo={accionSubirArchivo}
          accionTexto={accionSubirTexto}
        />
      </Tarjeta>

      <Tarjeta titulo={`Qué le has dado — ${totalInsumos > insumos.length ? `${insumos.length} de ${totalInsumos}` : insumos.length}`}>
        {insumos.length === 0 ? (
          <EstadoVacio titulo="Sin insumos todavía" contenido>Sin insumos todavía — suelta el primero arriba.</EstadoVacio>
        ) : (
          <ListaInsumos insumos={insumosConUrl} />
        )}
      </Tarjeta>
    </MarcoPagina>
  );
}

export const metadata: Metadata = { title: 'Insumos del agente' };
