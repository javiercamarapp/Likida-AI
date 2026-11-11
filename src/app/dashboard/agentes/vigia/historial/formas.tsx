'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Save, Upload, Trash2, Check } from 'lucide-react';
import '../vigia.css';
import { AvisoResultado, Boton, BotonEnlace, CampoArchivo, CampoSelect, CampoTexto, CampoTextarea, Casilla, Fieldset, Icono, type ResultadoUI } from '@/app/ui-v2/componentes';
import { AVISO_SOLO_TEXTO, nombreGrupoDeArchivo, MAX_ARCHIVOS_LOTE, type ResultadoLote } from '@/lib/likida/vigia/historial/lote_nombres';
import { useT } from '@/lib/i18n/proveedor';
import { agentes as agentesEs } from '@/lib/i18n/es/agentes';
import { type TAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';
import { rico as ricoT } from '@/lib/i18n/rico';

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
  const { t: tx } = useT('agentes', agentesEs);
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="rv-vg__pila">
      <div className="rv-vg__cuad">
        <CampoSelect etiqueta={tx('vigia.vista.cliente')} name="clienteId" required defaultValue="">
          <option value="" disabled>{tx('rest.elige_un_cliente_2')}</option>
          {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </CampoSelect>
        <CampoTexto etiqueta={tx('rest.nombre_del_grupo_como_se_ve')} name="nombre" required maxLength={120} />
      </div>
      <Casilla name="critico" etiqueta={<>{ricoT(tx('rest.strong_cliente_critico_strong_se_le'), { strong: (c) => <strong>{c}</strong> })}</>} />
      <div><Enviar Ic={Save}>{tx('rest.agregar_grupo')}</Enviar></div>
      <AvisoResultado estado={estado} />
    </form>
  );
}

export function FilaCritico({ accion, grupoId, critico }: { accion: AccionGrupos; grupoId: string; critico: boolean }) {
  const { t: tx } = useT('agentes', agentesEs);
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="rv-vg__linea">
      <input type="hidden" name="grupoId" value={grupoId} />
      <input type="hidden" name="critico" value={critico ? 'no' : 'si'} />
      <Boton type="submit" tamano="sm">{critico ? tx('rest.quitar_critico') : tx('rest.marcar_critico')}</Boton>
      <AvisoResultado estado={estado} />
    </form>
  );
}

export function FilaBorrar({ accion, grupoId }: { accion: AccionGrupos; grupoId: string }) {
  const { t: tx } = useT('agentes', agentesEs);
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="rv-vg__linea">
      <input type="hidden" name="grupoId" value={grupoId} />
      <Boton type="submit" tamano="sm" variante="danger" aria-label={tx('rest.borrar_el_grupo_y_todo_su')} icono={<Icono icono={Trash2} tam={14} />}>{tx('rest.borrar')}</Boton>
      <AvisoResultado estado={estado} />
    </form>
  );
}

export type AccionLote = (previo: ResultadoLote | null, fd: FormData) => Promise<ResultadoLote | null>;

const rotuloEstado = (tx: TAgentes = TR_ES.t) => ({ importado: tx('rest.importado'), duplicado: tx('rest.ya_estaba_subido'), error: tx('rest.no_se_importo') } as const);

/** Subir varios chats exportados a la vez: un solo campo de equipo y un nombre de grupo (editable) por archivo. */
export function FormaImportar({ accion, grupos, clientes, sufijo }: {
  accion: AccionLote;
  grupos: Array<{ id: string; nombre: string; cliente: string | null }>;
  clientes: Array<{ id: string; nombre: string }>;
  sufijo: string;
}) {
  const { t: tx } = useT('agentes', agentesEs);
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
      <CampoArchivo etiqueta={tx('rest.archivos_de_los_chats_txt_o', { maxArchivosLote: MAX_ARCHIVOS_LOTE })} name="archivo" multiple required
        accept=".txt,.zip,text/plain,application/zip" onChange={alElegir} ayuda={tx('rest.en_whatsapp_el_grupo_exportar_chat')} />
      {nombres.length > 0 && (
        <Fieldset leyenda={tx('rest.grupo_de_cada_archivo_por_omision')}>
          {nombres.map((n, i) => (
            <CampoTexto key={`${n.archivo}-${i}`} etiqueta={tx('rest.nombre_del_grupo_para', { archivo: n.archivo })} ayuda={n.archivo} name={`grupoNombre_${i}`} value={n.grupo} maxLength={120} required list="grupos-existentes"
              onChange={(e) => setNombres((prev) => prev.map((x, j) => (j === i ? { ...x, grupo: e.target.value } : x)))} />
          ))}
          <datalist id="grupos-existentes">{grupos.map((g) => <option key={g.id} value={g.nombre} />)}</datalist>
        </Fieldset>
      )}
      <CampoSelect etiqueta={tx('rest.si_un_grupo_todavia_no_existe')} name="clienteId" defaultValue="">
        <option value="">{tx('rest.no_crear_grupos_solo_usar_los')}</option>
        {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
      </CampoSelect>
      <CampoTexto etiqueta={tx('rest.nombres_de_tu_equipo_en_esos')} name="equipo" required placeholder={tx('rest.ana_servicio_luis_trafico')}
        ayuda={tx('rest.tal_como_salen_en_el_chat')} />
      <p className="rv-vg__nota">{AVISO_SOLO_TEXTO}</p>
      <div><Enviar Ic={Upload}>{tx('rest.subir_historico')}</Enviar></div>
      <AvisoResultado estado={estado} />
      {estado?.archivos && estado.archivos.length > 0 && (
        <ul aria-label={tx('rest.resultado_por_archivo')} className="rv-vg__lista">
          {estado.archivos.map((r, i) => (
            <li key={`${r.archivo}-${i}`} className="rv-vg__bloque rv-vg__nota">
              <span><strong>{rotuloEstado(tx)[r.estado]}</strong>: {r.archivo} → «{r.grupo}». {r.detalle}</span>
            </li>
          ))}
        </ul>
      )}
      {estado?.ok && estado.hayImportados && (
        <BotonEnlace href={`/dashboard/agentes/vigia/sin-atender${sufijo}`}>{tx('rest.ver_conversaciones_sin_atender')}</BotonEnlace>
      )}
    </form>
  );
}

/**
 * Aprobar la respuesta de una pregunta frecuente como «respuesta rápida» (0647). El texto viene con lo que suele contestar el equipo,
 * editable: lo que el gerente aprueba es lo que el Vigía propondrá, no lo que se calculó.
 */
export function FormaAprobarRapida({ accion, tema, pregunta, textoInicial }: { accion: AccionGrupos; tema: string; pregunta: string; textoInicial: string }) {
  const { t: tx } = useT('agentes', agentesEs);
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="rv-vg__pila">
      <input type="hidden" name="tema" value={tema} />
      <input type="hidden" name="pregunta" value={pregunta} />
      <CampoTextarea etiqueta={tx('rest.respuesta_rapida_que_el_vigia_propondra')} name="texto" required maxLength={700} rows={2} defaultValue={textoInicial} />
      <div><Enviar Ic={Check}>{tx('rest.aprobar_como_respuesta_rapida')}</Enviar></div>
      <AvisoResultado estado={estado} />
    </form>
  );
}

export function FilaRetirarRapida({ accion, respuestaId }: { accion: AccionGrupos; respuestaId: string }) {
  const { t: tx } = useT('agentes', agentesEs);
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="rv-vg__linea">
      <input type="hidden" name="respuestaId" value={respuestaId} />
      <Boton type="submit" tamano="sm" variante="danger" aria-label={tx('rest.retirar_esta_respuesta_rapida')} icono={<Icono icono={Trash2} tam={14} />}>{tx('rest.retirar')}</Boton>
      <AvisoResultado estado={estado} />
    </form>
  );
}
