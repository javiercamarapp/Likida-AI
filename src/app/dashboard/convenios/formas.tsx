'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Plus, Save, Trash2, Upload } from 'lucide-react';
import { Aviso as AvisoDs, Boton, CampoArchivo, CampoSelect, CampoTexto, CampoTextarea, CampoFecha, Casilla, Fieldset, Icono, Tooltip } from '@/app/ui-v2/componentes';
import './convenios.css';
import { CATEGORIAS, ETIQUETA_CATEGORIA, LUGARES, MAX_INSTRUCCIONES_POR_CONVENIO, MAX_TEXTO_INSTRUCCION, MOMENTOS, type Instruccion } from '@/lib/likida/convenios/tipos';
import type { ResultadoSitio } from '../agentes/conductores/sitios/formas';

// ═══════════════════════════════════════════════════════════════════════════
// EL IMPORTADOR DE CONVENIOS (CSV o Excel) — todo o nada, con la fila de cada problema.
// Reusa el `Aviso` del catálogo de sitios: un solo sistema de avisos.
// ═══════════════════════════════════════════════════════════════════════════

export type AccionConvenio = (previo: ResultadoSitio, fd: FormData) => Promise<ResultadoSitio>;

/** El resultado de un guardado con el aviso del sistema: ok con su detalle, o el error VERBATIM con lo que hay que corregir. */
function Aviso({ r }: { r: ResultadoSitio }) {
  if (!r) return null;
  const detalles = r.detalles && r.detalles.length > 0 ? r.detalles : null;
  return (
    <AvisoDs tono={r.ok ? 'ok' : 'error'}>
      {r.ok ? r.mensaje : r.error}
      {detalles && <ul className="rv-cv__detalles">{detalles.map((d, i) => <li key={i}>{d}</li>)}</ul>}
    </AvisoDs>
  );
}

function BotonImportar() {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" loading={pending} icono={<Icono icono={Upload} />}>{pending ? 'Importando…' : 'Importar'}</Boton>
  );
}

export function FormaImportarConvenios({ accion }: { accion: AccionConvenio }) {
  const [estado, enviar] = useActionState(accion, null);
  return (
    <form action={enviar} className="rv-forma" aria-label="Importar convenios desde CSV o Excel" encType="multipart/form-data">
      <CampoArchivo name="archivo" etiqueta="Archivo CSV o Excel (.xlsx)" accept=".csv,.xlsx,.xls,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
      <CampoTextarea name="csv" etiqueta="…o pega el contenido" rows={5} spellCheck={false} claseControl="rv-cv__mono"
        placeholder={'cliente,convenio,categoria,instruccion,momento,lugar\nCliente Uno,Ruta norte,puerta,Puerta 3 lado poniente,ambos,destino'} />
      <div className="rv-cv__fila"><BotonImportar /></div>
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
    <form action={enviar} className="rv-forma__fila" aria-label={`Corregir el convenio del viaje ${folio}`}>
      <input type="hidden" name="viajeId" value={viajeId} />
      <CampoSelect name="convenioId" etiqueta="Convenio del viaje" defaultValue={actual ?? ''} className="rv-cv__selector">
        <option value="">Sin convenio (no mandar instrucciones)</option>
        {opciones.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
      </CampoSelect>
      <Casilla name="reenviar" value="si" defaultChecked etiqueta="Mandar de nuevo las instrucciones al operador" />
      <Boton type="submit" variante="secondary" loading={pendiente}>
        {pendiente ? 'Guardando…' : 'Corregir convenio'}
      </Boton>
      <div className="rv-cv__todo"><Aviso r={estado} /></div>
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
    <Boton type="submit" variante="primary" loading={pending} icono={<Icono icono={Save} />}>{pending ? 'Guardando…' : texto}</Boton>
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
    <form action={enviar} className="rv-forma" aria-label={editando ? `Editar el convenio ${convenio?.nombre}` : 'Nuevo convenio'}>
      {editando && <input type="hidden" name="convenioId" value={convenio.id} />}
      {editando && <input type="hidden" name="version" value={convenio.version} />}
      <div className="rv-forma__rejilla">
        {editando ? (
          <div className="rv-campo"><span className="rv-campo__etq">Cliente</span><p className="rv-cv__fijo">{convenio.cliente}</p></div>
        ) : (
          <CampoSelect name="clienteId" etiqueta="Cliente" value={campos.clienteId} onChange={(e) => poner('clienteId', e.target.value)} obligatorio>
            <option value="">Elige un cliente…</option>
            {catalogos.clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </CampoSelect>
        )}
        <CampoTexto name="nombre" etiqueta="Nombre del convenio (la ruta)" value={campos.nombre} onChange={(e) => poner('nombre', e.target.value)} maxLength={120} obligatorio placeholder="Ruta norte" />
        <CampoTexto name="origen" etiqueta="Origen (punto A)" value={campos.origen} onChange={(e) => poner('origen', e.target.value)} maxLength={160} />
        <CampoTexto name="destino" etiqueta="Destino (punto B)" value={campos.destino} onChange={(e) => poner('destino', e.target.value)} maxLength={160} />
        <CampoSelect name="sitioOrigenId" etiqueta="Sitio de carga (catálogo de sitios)" value={campos.sitioOrigenId} onChange={(e) => poner('sitioOrigenId', e.target.value)}>
          <option value="">Sin sitio</option>
          {catalogos.sitios.map((g) => <option key={g.id} value={g.id}>{etiquetaSitio(g)}</option>)}
        </CampoSelect>
        <CampoSelect name="sitioDestinoId" etiqueta="Sitio de descarga (catálogo de sitios)" value={campos.sitioDestinoId} onChange={(e) => poner('sitioDestinoId', e.target.value)}>
          <option value="">Sin sitio</option>
          {catalogos.sitios.map((g) => <option key={g.id} value={g.id}>{etiquetaSitio(g)}</option>)}
        </CampoSelect>
        <CampoFecha name="vigenteDesde" etiqueta="Vigente desde" value={campos.vigenteDesde} onChange={(e) => poner('vigenteDesde', e.target.value)} />
        <CampoFecha name="vigenteHasta" etiqueta="Vigente hasta" value={campos.vigenteHasta} onChange={(e) => poner('vigenteHasta', e.target.value)} />
      </div>
      <CampoTextarea name="notas" etiqueta="Notas internas (no se mandan al operador)" rows={2} maxLength={1000} value={campos.notas} onChange={(e) => poner('notas', e.target.value)} />

      <Fieldset leyenda="Instrucciones de operación (la «calle de instrucciones»)" ayuda="Las filas sin texto se ignoran. Las que quites de la lista se borran del convenio al guardar.">
        {filas.map((f, n) => (
          <div key={n} className="rv-cv__instruccion">
            <CampoSelect name="ins_categoria" etiqueta={`Tema de la instrucción ${n + 1}`} etiquetaOculta value={f.categoria} onChange={(e) => ponerFila(n, 'categoria', e.target.value)}>
              {CATEGORIAS.map((c) => <option key={c} value={c}>{ETIQUETA_CATEGORIA[c]}</option>)}
            </CampoSelect>
            <CampoTexto name="ins_texto" etiqueta={`Texto de la instrucción ${n + 1}`} etiquetaOculta value={f.texto} onChange={(e) => ponerFila(n, 'texto', e.target.value)} maxLength={MAX_TEXTO_INSTRUCCION} placeholder="Puerta 3, lado poniente" />
            <CampoSelect name="ins_momento" etiqueta={`Cuándo se manda la instrucción ${n + 1}`} etiquetaOculta value={f.momento} onChange={(e) => ponerFila(n, 'momento', e.target.value)}>
              {MOMENTOS.map((m) => <option key={m} value={m}>{MOMENTO_OPCION[m]}</option>)}
            </CampoSelect>
            <CampoSelect name="ins_lugar" etiqueta={`A qué planta aplica la instrucción ${n + 1}`} etiquetaOculta value={f.lugar} onChange={(e) => ponerFila(n, 'lugar', e.target.value)}>
              {LUGARES.map((l) => <option key={l} value={l}>{LUGAR_OPCION[l]}</option>)}
            </CampoSelect>
            <Tooltip texto="Quitar esta instrucción del convenio">
              <Boton variante="ghost" tamano="sm" aria-label={`Quitar la instrucción ${n + 1}`}
                onClick={() => setFilas((fs) => (fs.length === 1 ? [{ ...FILA_NUEVA }] : fs.filter((_, i) => i !== n)))}>
                <Icono icono={Trash2} tam={14} />
              </Boton>
            </Tooltip>
          </div>
        ))}
        <Boton variante="secondary" disabled={filas.length >= MAX_INSTRUCCIONES_POR_CONVENIO} onClick={() => setFilas((fs) => [...fs, { ...FILA_NUEVA }])} icono={<Icono icono={Plus} />}>
          Agregar instrucción
        </Boton>
      </Fieldset>

      {editando && (
        <div className="rv-cv__casillas">
          <Casilla name="llevarAViajes" value="si" checked={llevar} onChange={(e) => setLlevar(e.target.checked)}
            etiqueta="Llevar este cambio a los viajes en curso de este convenio (si no, conservan las instrucciones que ya se les dijeron)." />
          {llevar && (
            <Casilla className="rv-cv__sangria" name="reenviar" value="si" checked={reenviar} onChange={(e) => setReenviar(e.target.checked)}
              etiqueta="Volver a mandar las instrucciones de despacho a los operadores que ya las habían recibido." />
          )}
        </div>
      )}
      <div className="rv-cv__fila"><BotonGuardar texto={editando ? 'Guardar cambios' : 'Crear convenio'} /></div>
      <Aviso r={estado} />
    </form>
  );
}
