'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Save, Upload, Trash2, Check } from 'lucide-react';
import '../vigia.css';
import { AvisoResultado, Boton, BotonEnlace, CampoArchivo, CampoSelect, CampoTexto, CampoTextarea, Casilla, Fieldset, Icono, type ResultadoUI } from '@/app/ui-v2/componentes';
import { AVISO_SOLO_TEXTO, nombreGrupoDeArchivo, MAX_ARCHIVOS_LOTE, type ResultadoLote } from '@/lib/likida/vigia/historial/lote_nombres';

export type ResultadoGrupos = ResultadoUI;
export type AccionGrupos = (previo: ResultadoGrupos, fd: FormData) => Promise<ResultadoGrupos>;

function Enviar({ children, Ic, peligro }: { children: React.ReactNode; Ic: typeof Save; peligro?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante={peligro ? 'danger' : 'secondary'} loading={pending} icono={<Icono icono={Ic} tam={14} />}>
      {pending ? 'Un momento…' : children}
    </Boton>
  );
}

export function FormaAltaGrupo({ accion, clientes }: { accion: AccionGrupos; clientes: Array<{ id: string; nombre: string }> }) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="rv-vg__pila">
      <div className="rv-vg__cuad">
        <CampoSelect etiqueta="Cliente" name="clienteId" required defaultValue="">
          <option value="" disabled>Elige un cliente…</option>
          {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </CampoSelect>
        <CampoTexto etiqueta="Nombre del grupo (como se ve en WhatsApp)" name="nombre" required maxLength={120} />
      </div>
      <Casilla name="critico" etiqueta={<><strong>Cliente crítico.</strong> Se le atiende con el plazo corto de respuesta de la configuración del Vigía.</>} />
      <div><Enviar Ic={Save}>Agregar grupo</Enviar></div>
      <AvisoResultado estado={estado} />
    </form>
  );
}

export function FilaCritico({ accion, grupoId, critico }: { accion: AccionGrupos; grupoId: string; critico: boolean }) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="rv-vg__linea">
      <input type="hidden" name="grupoId" value={grupoId} />
      <input type="hidden" name="critico" value={critico ? 'no' : 'si'} />
      <Boton type="submit" tamano="sm">{critico ? 'Quitar crítico' : 'Marcar crítico'}</Boton>
      <AvisoResultado estado={estado} />
    </form>
  );
}

export function FilaBorrar({ accion, grupoId }: { accion: AccionGrupos; grupoId: string }) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="rv-vg__linea">
      <input type="hidden" name="grupoId" value={grupoId} />
      <Boton type="submit" tamano="sm" variante="danger" aria-label="Borrar el grupo y todo su histórico" icono={<Icono icono={Trash2} tam={14} />}>Borrar</Boton>
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
    <form action={despachar} className="rv-vg__pila">
      <CampoArchivo etiqueta={`Archivos de los chats (.txt o .zip; todos juntos pesan hasta 4 MB y hasta ${MAX_ARCHIVOS_LOTE} archivos)`} name="archivo" multiple required
        accept=".txt,.zip,text/plain,application/zip" onChange={alElegir} ayuda="En WhatsApp: el grupo → Exportar chat → Sin multimedia. Puedes elegir varios archivos a la vez." />
      {nombres.length > 0 && (
        <Fieldset leyenda="Grupo de cada archivo (por omisión, el nombre del archivo; corrígelo si no coincide)">
          {nombres.map((n, i) => (
            <CampoTexto key={`${n.archivo}-${i}`} etiqueta={`Nombre del grupo para ${n.archivo}`} ayuda={n.archivo} name={`grupoNombre_${i}`} value={n.grupo} maxLength={120} required list="grupos-existentes"
              onChange={(e) => setNombres((prev) => prev.map((x, j) => (j === i ? { ...x, grupo: e.target.value } : x)))} />
          ))}
          <datalist id="grupos-existentes">{grupos.map((g) => <option key={g.id} value={g.nombre} />)}</datalist>
        </Fieldset>
      )}
      <CampoSelect etiqueta="Si un grupo todavía no existe, créalo para este cliente (opcional)" name="clienteId" defaultValue="">
        <option value="">No crear grupos: solo usar los que ya existen</option>
        {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
      </CampoSelect>
      <CampoTexto etiqueta="Nombres de TU equipo en esos chats (separados por coma; valen para todos los archivos)" name="equipo" required placeholder="Ana Servicio, Luis Tráfico"
        ayuda="Tal como salen en el chat. Todo otro nombre se cuenta como cliente. Los nombres no se guardan, solo un código que no se puede revertir; los teléfonos y correos escritos en los mensajes se tapan." />
      <p className="rv-vg__nota">{AVISO_SOLO_TEXTO}</p>
      <div><Enviar Ic={Upload}>Subir histórico</Enviar></div>
      <AvisoResultado estado={estado} />
      {estado?.archivos && estado.archivos.length > 0 && (
        <ul aria-label="Resultado por archivo" className="rv-vg__lista">
          {estado.archivos.map((r, i) => (
            <li key={`${r.archivo}-${i}`} className="rv-vg__bloque rv-vg__nota">
              <span><strong>{ROTULO_ESTADO[r.estado]}</strong>: {r.archivo} → «{r.grupo}». {r.detalle}</span>
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
    <form action={despachar} className="rv-vg__pila">
      <input type="hidden" name="tema" value={tema} />
      <input type="hidden" name="pregunta" value={pregunta} />
      <CampoTextarea etiqueta="Respuesta rápida que el Vigía propondrá (puedes corregirla)" name="texto" required maxLength={700} rows={2} defaultValue={textoInicial} />
      <div><Enviar Ic={Check}>Aprobar como respuesta rápida</Enviar></div>
      <AvisoResultado estado={estado} />
    </form>
  );
}

export function FilaRetirarRapida({ accion, respuestaId }: { accion: AccionGrupos; respuestaId: string }) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="rv-vg__linea">
      <input type="hidden" name="respuestaId" value={respuestaId} />
      <Boton type="submit" tamano="sm" variante="danger" aria-label="Retirar esta respuesta rápida" icono={<Icono icono={Trash2} tam={14} />}>Retirar</Boton>
      <AvisoResultado estado={estado} />
    </form>
  );
}
