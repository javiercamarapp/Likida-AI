'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Plus, Save, Trash2, Upload } from 'lucide-react';
import { CATEGORIAS, ETIQUETA_CATEGORIA, LUGARES, MAX_INSTRUCCIONES_POR_CONVENIO, MAX_TEXTO_INSTRUCCION, MOMENTOS, type Instruccion } from '@/lib/likida/convenios/tipos';
import { Aviso, type ResultadoSitio } from '../agentes/conductores/sitios/formas';

// ═══════════════════════════════════════════════════════════════════════════
// EL IMPORTADOR DE CONVENIOS (CSV o Excel) — todo o nada, con la fila de cada problema.
// Reusa el `Aviso` del catálogo de sitios: un solo sistema de avisos.
// ═══════════════════════════════════════════════════════════════════════════

export type AccionConvenio = (previo: ResultadoSitio, fd: FormData) => Promise<ResultadoSitio>;

const CAMPO = 'hairline rounded-lg px-2.5 h-9 text-[13px] outline-none focus:border-[var(--muted)] w-full';
const ETIQUETA = 'block text-[11px] font-medium mb-1';

function BotonImportar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="h-9 px-4 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 transition-opacity hover:opacity-85 disabled:opacity-50"
      style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
      <Upload width={14} height={14} strokeWidth={1.75} />{pending ? 'Importando…' : 'Importar'}
    </button>
  );
}

export function FormaImportarConvenios({ accion }: { accion: AccionConvenio }) {
  const [estado, enviar] = useActionState(accion, null);
  return (
    <form action={enviar} className="space-y-3" aria-label="Importar convenios desde CSV o Excel" encType="multipart/form-data">
      <label className="block"><span className={ETIQUETA}>Archivo CSV o Excel (.xlsx)</span>
        <input type="file" name="archivo" accept=".csv,.xlsx,.xls,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="text-[12.5px]" />
      </label>
      <label className="block"><span className={ETIQUETA}>…o pega el contenido</span>
        <textarea name="csv" rows={5} spellCheck={false} className={`${CAMPO} h-auto py-2 font-mono text-[12px]`}
          placeholder={'cliente,convenio,categoria,instruccion,momento,lugar\nCliente Uno,Ruta norte,puerta,Puerta 3 lado poniente,ambos,destino'} />
      </label>
      <div className="flex items-center gap-3 flex-wrap"><BotonImportar /></div>
      <Aviso r={estado} />
    </form>
  );
}

export interface OpcionCorregir { id: string; nombre: string }

/** Una fila por viaje: elegir el convenio correcto del cliente (o «sin convenio») y, si se quiere, volver a mandar las instrucciones. */
export function FormaCorregirConvenio({ accion, viajeId, folio, actual, opciones }: {
  accion: AccionConvenio; viajeId: string; folio: string; actual: string | null; opciones: OpcionCorregir[];
}) {
  const [estado, enviar, pendiente] = useActionState(accion, null);
  return (
    <form action={enviar} className="flex items-end gap-2 flex-wrap" aria-label={`Corregir el convenio del viaje ${folio}`}>
      <input type="hidden" name="viajeId" value={viajeId} />
      <label className="block min-w-0"><span className={ETIQUETA}>Convenio del viaje</span>
        <select name="convenioId" defaultValue={actual ?? ''} className={`${CAMPO} max-w-[260px]`}>
          <option value="">Sin convenio (no mandar instrucciones)</option>
          {opciones.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-1.5 text-[12px] h-9"><input type="checkbox" name="reenviar" value="si" defaultChecked />Mandar de nuevo las instrucciones al operador</label>
      <button type="submit" disabled={pendiente} className="h-9 px-3 rounded-lg text-[12.5px] font-medium hairline disabled:opacity-50" style={{ background: 'var(--surface)', color: 'var(--ink)' }}>
        {pendiente ? 'Guardando…' : 'Corregir convenio'}
      </button>
      <div className="basis-full"><Aviso r={estado} /></div>
    </form>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ALTA Y EDICIÓN DE UN CONVENIO EN PANTALLA (P7). Todos los campos son controlados: si el servidor rechaza el guardado
// (conflicto de versión, nombre repetido, un dato inválido), lo escrito se conserva y se dice qué corregir. La tarifa y los
// requisitos de cobro no se editan aquí (son dinero: entran por la importación).
// ═══════════════════════════════════════════════════════════════════════════

const MOMENTO_OPCION = { despacho: 'Al despachar', acercamiento: 'Al acercarse a la planta', ambos: 'Al despachar y al acercarse' } as const;
const LUGAR_OPCION = { origen: 'Planta de carga', destino: 'Planta de descarga', ambos: 'Las dos plantas' } as const;

export interface CatalogosFormaConvenio {
  clientes: Array<{ id: string; nombre: string }>;
  sitios: Array<{ id: string; nombre: string; codigo: string | null }>;
}

/** Solo lo que la forma necesita de un convenio ya guardado (un tipo estructural: la forma no importa el acceso a datos). */
export interface ConvenioEditable {
  id: string;
  version: number;
  cliente: string;
  nombre: string;
  origen: string | null;
  destino: string | null;
  origenSitioId: string | null;
  destinoSitioId: string | null;
  vigenteDesde: string | null;
  vigenteHasta: string | null;
  notas: string | null;
  instrucciones: readonly Instruccion[];
}

interface FilaInstruccion { categoria: string; texto: string; momento: string; lugar: string }
const FILA_NUEVA: FilaInstruccion = { categoria: 'puerta', texto: '', momento: 'ambos', lugar: 'ambos' };

function BotonGuardar({ texto }: { texto: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="h-9 px-4 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 transition-opacity hover:opacity-85 disabled:opacity-50"
      style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
      <Save width={14} height={14} strokeWidth={1.75} />{pending ? 'Guardando…' : texto}
    </button>
  );
}

export function FormaConvenio({ accion, catalogos, convenio }: { accion: AccionConvenio; catalogos: CatalogosFormaConvenio; convenio?: ConvenioEditable }) {
  const editando = !!convenio;
  const [campos, setCampos] = useState({
    clienteId: '', nombre: convenio?.nombre ?? '', origen: convenio?.origen ?? '', destino: convenio?.destino ?? '',
    sitioOrigenId: convenio?.origenSitioId ?? '', sitioDestinoId: convenio?.destinoSitioId ?? '',
    vigenteDesde: convenio?.vigenteDesde ?? '', vigenteHasta: convenio?.vigenteHasta ?? '', notas: convenio?.notas ?? '',
  });
  const [filas, setFilas] = useState<FilaInstruccion[]>(
    convenio && convenio.instrucciones.length > 0
      ? convenio.instrucciones.map((i) => ({ categoria: i.categoria, texto: i.texto, momento: i.momento, lugar: i.lugar }))
      : [{ ...FILA_NUEVA }],
  );
  const [llevar, setLlevar] = useState(false);
  const [reenviar, setReenviar] = useState(true);
  const [estado, enviar] = useActionState(async (previo: ResultadoSitio, fd: FormData): Promise<ResultadoSitio> => {
    const r = await accion(previo, fd);
    // Un alta que salió bien deja la forma limpia para el siguiente convenio; una edición conserva lo que se ve.
    if (r?.ok && !editando) {
      setCampos({ clienteId: '', nombre: '', origen: '', destino: '', sitioOrigenId: '', sitioDestinoId: '', vigenteDesde: '', vigenteHasta: '', notas: '' });
      setFilas([{ ...FILA_NUEVA }]);
    }
    return r;
  }, null);

  const poner = (k: keyof typeof campos, v: string) => setCampos((c) => ({ ...c, [k]: v }));
  const ponerFila = (n: number, k: keyof FilaInstruccion, v: string) => setFilas((fs) => fs.map((f, i) => (i === n ? { ...f, [k]: v } : f)));
  const etiquetaSitio = (g: { nombre: string; codigo: string | null }) => (g.codigo ? `${g.nombre} (${g.codigo})` : g.nombre);

  return (
    <form action={enviar} className="space-y-3" aria-label={editando ? `Editar el convenio ${convenio?.nombre}` : 'Nuevo convenio'}>
      {editando && <input type="hidden" name="convenioId" value={convenio.id} />}
      {editando && <input type="hidden" name="version" value={convenio.version} />}
      <div className="grid gap-3 sm:grid-cols-2">
        {editando ? (
          <div><span className={ETIQUETA}>Cliente</span><p className="text-[13px] h-9 flex items-center">{convenio.cliente}</p></div>
        ) : (
          <label className="block"><span className={ETIQUETA}>Cliente</span>
            <select name="clienteId" value={campos.clienteId} onChange={(e) => poner('clienteId', e.target.value)} className={CAMPO} required>
              <option value="">Elige un cliente…</option>
              {catalogos.clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
        )}
        <label className="block"><span className={ETIQUETA}>Nombre del convenio (la ruta)</span>
          <input name="nombre" value={campos.nombre} onChange={(e) => poner('nombre', e.target.value)} maxLength={120} required className={CAMPO} placeholder="Ruta norte" />
        </label>
        <label className="block"><span className={ETIQUETA}>Origen (punto A)</span>
          <input name="origen" value={campos.origen} onChange={(e) => poner('origen', e.target.value)} maxLength={160} className={CAMPO} />
        </label>
        <label className="block"><span className={ETIQUETA}>Destino (punto B)</span>
          <input name="destino" value={campos.destino} onChange={(e) => poner('destino', e.target.value)} maxLength={160} className={CAMPO} />
        </label>
        <label className="block"><span className={ETIQUETA}>Sitio de carga (catálogo de sitios)</span>
          <select name="sitioOrigenId" value={campos.sitioOrigenId} onChange={(e) => poner('sitioOrigenId', e.target.value)} className={CAMPO}>
            <option value="">Sin sitio</option>
            {catalogos.sitios.map((g) => <option key={g.id} value={g.id}>{etiquetaSitio(g)}</option>)}
          </select>
        </label>
        <label className="block"><span className={ETIQUETA}>Sitio de descarga (catálogo de sitios)</span>
          <select name="sitioDestinoId" value={campos.sitioDestinoId} onChange={(e) => poner('sitioDestinoId', e.target.value)} className={CAMPO}>
            <option value="">Sin sitio</option>
            {catalogos.sitios.map((g) => <option key={g.id} value={g.id}>{etiquetaSitio(g)}</option>)}
          </select>
        </label>
        <label className="block"><span className={ETIQUETA}>Vigente desde</span>
          <input type="date" name="vigenteDesde" value={campos.vigenteDesde} onChange={(e) => poner('vigenteDesde', e.target.value)} className={CAMPO} />
        </label>
        <label className="block"><span className={ETIQUETA}>Vigente hasta</span>
          <input type="date" name="vigenteHasta" value={campos.vigenteHasta} onChange={(e) => poner('vigenteHasta', e.target.value)} className={CAMPO} />
        </label>
      </div>
      <label className="block"><span className={ETIQUETA}>Notas internas (no se mandan al operador)</span>
        <textarea name="notas" rows={2} maxLength={1000} value={campos.notas} onChange={(e) => poner('notas', e.target.value)} className={`${CAMPO} h-auto py-2`} />
      </label>

      <fieldset className="space-y-2">
        <legend className={ETIQUETA}>Instrucciones de operación (la «calle de instrucciones»)</legend>
        {filas.map((f, n) => (
          <div key={n} className="grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)_170px_150px_auto] items-end">
            <label className="block"><span className="sr-only">Tema de la instrucción {n + 1}</span>
              <select name="ins_categoria" value={f.categoria} onChange={(e) => ponerFila(n, 'categoria', e.target.value)} className={CAMPO}>
                {CATEGORIAS.map((c) => <option key={c} value={c}>{ETIQUETA_CATEGORIA[c]}</option>)}
              </select>
            </label>
            <label className="block"><span className="sr-only">Texto de la instrucción {n + 1}</span>
              <input name="ins_texto" value={f.texto} onChange={(e) => ponerFila(n, 'texto', e.target.value)} maxLength={MAX_TEXTO_INSTRUCCION} className={CAMPO} placeholder="Puerta 3, lado poniente" />
            </label>
            <label className="block"><span className="sr-only">Cuándo se manda la instrucción {n + 1}</span>
              <select name="ins_momento" value={f.momento} onChange={(e) => ponerFila(n, 'momento', e.target.value)} className={CAMPO}>
                {MOMENTOS.map((m) => <option key={m} value={m}>{MOMENTO_OPCION[m]}</option>)}
              </select>
            </label>
            <label className="block"><span className="sr-only">A qué planta aplica la instrucción {n + 1}</span>
              <select name="ins_lugar" value={f.lugar} onChange={(e) => ponerFila(n, 'lugar', e.target.value)} className={CAMPO}>
                {LUGARES.map((l) => <option key={l} value={l}>{LUGAR_OPCION[l]}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => setFilas((fs) => (fs.length === 1 ? [{ ...FILA_NUEVA }] : fs.filter((_, i) => i !== n)))}
              aria-label={`Quitar la instrucción ${n + 1}`} className="h-9 w-9 inline-flex items-center justify-center rounded-lg hairline" style={{ color: 'var(--muted)' }}>
              <Trash2 width={14} height={14} strokeWidth={1.75} />
            </button>
          </div>
        ))}
        <button type="button" disabled={filas.length >= MAX_INSTRUCCIONES_POR_CONVENIO} onClick={() => setFilas((fs) => [...fs, { ...FILA_NUEVA }])}
          className="h-8 px-3 rounded-lg text-[12.5px] inline-flex items-center gap-1.5 hairline disabled:opacity-50" style={{ color: 'var(--ink)' }}>
          <Plus width={13} height={13} strokeWidth={1.75} />Agregar instrucción
        </button>
        <p className="text-[11.5px]" style={{ color: 'var(--faint)' }}>Las filas sin texto se ignoran. Las que quites de la lista se borran del convenio al guardar.</p>
      </fieldset>

      {editando && (
        <div className="space-y-1.5 text-[12.5px]">
          <label className="flex items-start gap-2"><input type="checkbox" name="llevarAViajes" value="si" checked={llevar} onChange={(e) => setLlevar(e.target.checked)} className="mt-0.5" />
            <span>Llevar este cambio a los viajes en curso de este convenio (si no, conservan las instrucciones que ya se les dijeron).</span>
          </label>
          {llevar && (
            <label className="flex items-start gap-2 ml-6"><input type="checkbox" name="reenviar" value="si" checked={reenviar} onChange={(e) => setReenviar(e.target.checked)} className="mt-0.5" />
              <span>Volver a mandar las instrucciones de despacho a los operadores que ya las habían recibido.</span>
            </label>
          )}
        </div>
      )}
      <div className="flex items-center gap-3 flex-wrap"><BotonGuardar texto={editando ? 'Guardar cambios' : 'Crear convenio'} /></div>
      <Aviso r={estado} />
    </form>
  );
}
