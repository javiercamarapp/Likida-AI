'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Save, Upload, Trash2, Check } from 'lucide-react';
import { AvisoResultado, type ResultadoUI } from '../../../../admin/ui/aviso-resultado';
import { BotonEnlace } from '@/app/ui-v2/componentes';
import { AVISO_SOLO_TEXTO, nombreGrupoDeArchivo, MAX_ARCHIVOS_LOTE, type ResultadoLote } from '@/lib/likida/vigia/historial/lote_nombres';

export type ResultadoGrupos = ResultadoUI;
export type AccionGrupos = (previo: ResultadoGrupos, fd: FormData) => Promise<ResultadoGrupos>;

const ETIQUETA = 'block text-[11px] font-medium mb-1';
const AYUDA = 'text-[11px] mt-1';

function Enviar({ children, Icono, peligro }: { children: React.ReactNode; Icono: typeof Save; peligro?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`rv-btn ${peligro ? 'rv-btn--danger' : 'rv-btn--secondary'}`} style={peligro ? { color: 'var(--bad)' } : undefined}>
      <Icono width={14} height={14} strokeWidth={1.75} aria-hidden />{pending ? 'Un momento…' : children}
    </button>
  );
}

export function FormaAltaGrupo({ accion, clientes }: { accion: AccionGrupos; clientes: Array<{ id: string; nombre: string }> }) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <label>
          <span className={ETIQUETA}>Cliente</span>
          <select name="clienteId" required defaultValue="" className="w-full" style={{ background: 'var(--surface)' }}>
            <option value="" disabled>Elige un cliente…</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <label>
          <span className={ETIQUETA}>Nombre del grupo (como se ve en WhatsApp)</span>
          <input name="nombre" required maxLength={120} className="w-full" />
        </label>
      </div>
      <label className="flex items-start gap-2 text-[12px]">
        <input type="checkbox" name="critico" className="mt-0.5" />
        <span><strong>Cliente crítico.</strong> Se le atiende con el plazo corto de respuesta de la configuración del Vigía.</span>
      </label>
      <Enviar Icono={Save}>Agregar grupo</Enviar>
      <AvisoResultado estado={estado} />
    </form>
  );
}

export function FilaCritico({ accion, grupoId, critico }: { accion: AccionGrupos; grupoId: string; critico: boolean }) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="inline-flex items-center gap-2">
      <input type="hidden" name="grupoId" value={grupoId} />
      <input type="hidden" name="critico" value={critico ? 'no' : 'si'} />
      <button type="submit" className="rv-btn rv-btn--secondary">{critico ? 'Quitar crítico' : 'Marcar crítico'}</button>
      <AvisoResultado estado={estado} />
    </form>
  );
}

export function FilaBorrar({ accion, grupoId }: { accion: AccionGrupos; grupoId: string }) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="inline-flex items-center gap-2">
      <input type="hidden" name="grupoId" value={grupoId} />
      <button type="submit" className="rv-btn rv-btn--danger" style={{ color: 'var(--bad)' }} aria-label="Borrar el grupo y todo su histórico">
        <Trash2 width={12} height={12} strokeWidth={1.75} aria-hidden />Borrar
      </button>
      <AvisoResultado estado={estado} />
    </form>
  );
}

export type AccionLote = (previo: ResultadoLote | null, fd: FormData) => Promise<ResultadoLote | null>;

const ROTULO_ESTADO = { importado: 'Importado', duplicado: 'Ya estaba subido', error: 'No se importó' } as const;

/** Subir varios chats exportados a la vez: un solo campo de equipo y un nombre de grupo (editable) por archivo. */
export function FormaImportar({ accion, grupos, clientes, sufijo }: {
  accion: AccionLote;
  grupos: Array<{ id: string; nombre: string; cliente: string | null }>;
  clientes: Array<{ id: string; nombre: string }>;
  sufijo: string;
}) {
  const [estado, despachar] = useActionState(accion, null);
  const [nombres, setNombres] = useState<Array<{ archivo: string; grupo: string }>>([]);
  const alElegir = (e: React.ChangeEvent<HTMLInputElement>) => {
    const lista = e.target.files;
    const elegidos: Array<{ archivo: string; grupo: string }> = [];
    for (let i = 0; lista && i < lista.length; i++) elegidos.push({ archivo: lista[i].name, grupo: nombreGrupoDeArchivo(lista[i].name) });
    setNombres(elegidos);
  };
  return (
    <form action={despachar} className="space-y-3">
      <label className="block">
        <span className={ETIQUETA}>Archivos de los chats (.txt o .zip; todos juntos pesan hasta 4 MB y hasta {MAX_ARCHIVOS_LOTE} archivos)</span>
        <input type="file" name="archivo" multiple required accept=".txt,.zip,text/plain,application/zip" onChange={alElegir} className="w-full pt-1.5" />
        <span className={AYUDA} style={{ color: 'var(--faint)' }}>En WhatsApp: el grupo → Exportar chat → Sin multimedia. Puedes elegir varios archivos a la vez.</span>
      </label>
      {nombres.length > 0 && (
        <fieldset className="space-y-2">
          <legend className={ETIQUETA}>Grupo de cada archivo (por omisión, el nombre del archivo; corrígelo si no coincide)</legend>
          {nombres.map((n, i) => (
            <label key={`${n.archivo}-${i}`} className="block">
              <span className="block text-[11px]" style={{ color: 'var(--faint)' }}>{n.archivo}</span>
              <input name={`grupoNombre_${i}`} value={n.grupo} maxLength={120} required list="grupos-existentes" aria-label={`Nombre del grupo para ${n.archivo}`} onChange={(e) => setNombres((prev) => prev.map((x, j) => (j === i ? { ...x, grupo: e.target.value } : x)))} className="w-full" />
            </label>
          ))}
          <datalist id="grupos-existentes">{grupos.map((g) => <option key={g.id} value={g.nombre} />)}</datalist>
        </fieldset>
      )}
      <label className="block">
        <span className={ETIQUETA}>Si un grupo todavía no existe, créalo para este cliente (opcional)</span>
        <select name="clienteId" defaultValue="" className="w-full" style={{ background: 'var(--surface)' }}>
          <option value="">No crear grupos: solo usar los que ya existen</option>
          {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
      </label>
      <label className="block">
        <span className={ETIQUETA}>Nombres de TU equipo en esos chats (separados por coma; valen para todos los archivos)</span>
        <input name="equipo" required placeholder="Ana Servicio, Luis Tráfico" className="w-full" />
        <span className={AYUDA} style={{ color: 'var(--faint)' }}>Tal como salen en el chat. Todo otro nombre se cuenta como cliente. Los nombres no se guardan, solo un código que no se puede revertir; los teléfonos y correos escritos en los mensajes se tapan.</span>
      </label>
      <p className={AYUDA} style={{ color: 'var(--muted)' }}>{AVISO_SOLO_TEXTO}</p>
      <Enviar Icono={Upload}>Subir histórico</Enviar>
      <AvisoResultado estado={estado} />
      {estado?.archivos && estado.archivos.length > 0 && (
        <ul aria-label="Resultado por archivo" className="space-y-1.5 text-[12px]">
          {estado.archivos.map((r, i) => (
            <li key={`${r.archivo}-${i}`} className="hairline rounded-lg px-2.5 py-1.5">
              <strong>{ROTULO_ESTADO[r.estado]}</strong>: {r.archivo} → «{r.grupo}». {r.detalle}
            </li>
          ))}
        </ul>
      )}
      {estado?.ok && estado.hayImportados && (
        <BotonEnlace href={`/dashboard/agentes/vigia/sin-atender${sufijo}`}>Ver conversaciones sin atender</BotonEnlace>
      )}
    </form>
  );
}

/**
 * Aprobar la respuesta de una pregunta frecuente como «respuesta rápida» (0647). El texto viene con lo que suele contestar el equipo,
 * editable: lo que el gerente aprueba es lo que el Vigía propondrá, no lo que se calculó.
 */
export function FormaAprobarRapida({ accion, tema, pregunta, textoInicial }: { accion: AccionGrupos; tema: string; pregunta: string; textoInicial: string }) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="mt-1.5 space-y-1.5">
      <input type="hidden" name="tema" value={tema} />
      <input type="hidden" name="pregunta" value={pregunta} />
      <label className="block">
        <span className={ETIQUETA}>Respuesta rápida que el Vigía propondrá (puedes corregirla)</span>
        <textarea name="texto" required maxLength={700} rows={2} defaultValue={textoInicial} className="hairline rounded-lg px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--muted)] w-full" />
      </label>
      <Enviar Icono={Check}>Aprobar como respuesta rápida</Enviar>
      <AvisoResultado estado={estado} />
    </form>
  );
}

export function FilaRetirarRapida({ accion, respuestaId }: { accion: AccionGrupos; respuestaId: string }) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="inline-flex items-center gap-2">
      <input type="hidden" name="respuestaId" value={respuestaId} />
      <button type="submit" className="rv-btn rv-btn--danger" style={{ color: 'var(--bad)' }} aria-label="Retirar esta respuesta rápida">
        <Trash2 width={12} height={12} strokeWidth={1.75} aria-hidden />Retirar
      </button>
      <AvisoResultado estado={estado} />
    </form>
  );
}
