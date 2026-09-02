import { notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { Inbox } from 'lucide-react';
import { requireSuperadmin } from '@/lib/auth/guard';
import { listarAgentes, DEPARTAMENTOS } from '@/lib/likida/agentes/definiciones';
import {
  tiposAceptadosPorAgente, listarInsumosDeAgente, contarInsumosDeAgente, urlsFirmadasInsumos,
  crearInsumoArchivo, crearInsumoTexto, subirArchivoInsumo,
  esTipoInsumo, TIPOS_ARCHIVO, TIPOS_TEXTO, type InsumoAgente,
} from '@/lib/likida/agentes/insumos';
import { DatoInvalido } from '@/lib/likida/errores';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { BarraPagina, TituloSeccion } from '../../../../dashboard/resumen-visual';
import { EstadoVacio } from '../../../ui/kit';
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
      const ruta = await subirArchivoInsumo(id, archivo, tipo as 'documento' | 'imagen' | 'video');
      await crearInsumoArchivo({
        agente: id, departamento, titulo, tipo: tipo as 'documento' | 'imagen' | 'video',
        storagePath: ruta, subidoPor: userId,
      });
      revalidatePath(`/admin/agentes/${id}/insumos`);
      return { ok: `"${titulo}" quedó guardado — se procesa en la siguiente corrida de este agente.` };
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
      return { ok: `"${titulo}" quedó guardado — se procesa en la siguiente corrida de este agente.` };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'guardar el insumo') };
    }
  }

  const rotuloDepartamento = DEPARTAMENTOS.find((d) => d.valor === agente.departamento)?.rotulo ?? agente.departamento;
  const insumosConUrl: Array<InsumoAgente & { url: string | null }> = insumos.map((i) => ({
    ...i, url: i.storagePath ? firmas.get(i.storagePath) ?? null : null,
  }));

  return (
    <main className="h-full">
      <div className="rounded-2xl overflow-hidden min-h-full flex flex-col hairline" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Inbox width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo={`${agente.nombre} — bandeja de contexto`}
        />
        <div className="px-5 py-5 flex-1 space-y-4">
          <EstadoVacio>
            {rotuloDepartamento} · id <code className="cifra-mono">{agente.id}</code> — entre más le das, más entiende.
            Todo lo que sueltes aquí se procesa en la SIGUIENTE corrida de este agente; sesión actual: {s.nombre ?? 'superadmin'}.
          </EstadoVacio>

          <div className="card p-4">
            <TituloSeccion>Soltar un insumo nuevo</TituloSeccion>
            <p className="text-xs mt-1 mb-3" style={{ color: 'var(--muted)' }}>
              Este agente acepta: {tiposAceptados.join(', ')}.
            </p>
            <FormularioInsumo
              tiposAceptados={tiposAceptados}
              accionArchivo={accionSubirArchivo}
              accionTexto={accionSubirTexto}
            />
          </div>

          <div className="card overflow-hidden">
            <div className="px-4 pt-3 pb-1">
              <TituloSeccion>
                Qué le has dado — {totalInsumos > insumos.length ? `${insumos.length} de ${totalInsumos}` : insumos.length}
              </TituloSeccion>
            </div>
            {insumos.length === 0 ? (
              <div className="px-4 pt-2 pb-4">
                <EstadoVacio>Sin insumos todavía — suelta el primero arriba.</EstadoVacio>
              </div>
            ) : (
              <ListaInsumos insumos={insumosConUrl} />
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
