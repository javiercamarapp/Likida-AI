'use client';

import { useState, type ReactNode } from 'react';
import { useActionState } from 'react';
import Link from 'next/link';
import { ArrowLeft, BookOpen, Download, Plus, Upload } from 'lucide-react';
import { numero as fmtNumero } from '@/lib/formato';
import { llaveTexto } from '@/lib/likida/carta_porte_docs/catalogos';
import { plantillaCsv, TIPOS_PLANTILLA, type Registro, type TipoPlantilla } from '@/lib/likida/carta_porte_docs/catalogo_import';
import { COLUMNAS_CLAVE, ROTULO_COLUMNA, columnasDeFila, filtrarFilas, valoresDeFormulario, type FilasCatalogo } from '@/lib/likida/carta_porte_docs/catalogo_pantalla';
import { Aviso, BotonEnvio, CAMPO, ETIQUETA, FormaAccion, type AccionDoc } from '../../../carta-porte/documentos/forma_accion';
import type { EstadoImportacion } from './actions';

/**
 * LA PANTALLA «CATÁLOGO DEL CLIENTE» (T-A3-22): lo que el agente aprende UNA vez de cada cliente y usa en cada documento.
 *
 *   · productos: el SKU del cliente → clave SAT, unidad, embalaje y fracción (el documento de algunos clientes no los trae);
 *   · remitentes y destinatarios: nombre corto → RFC y domicilio;
 *   · el número interno del cliente que paga en el sistema (sin él el CCP no se liga).
 *
 * Se llena de tres formas: importando un CSV (plantillas aquí abajo), tecleando una fila, o desde la revisión de un
 * documento («¿Guardar estos datos en el catálogo?»). Las filas visibles son solo las de la flota de la sesión.
 */

export interface ClienteVista { id: string; nombre: string }
export interface CatalogoVista extends FilasCatalogo { truncado: boolean }
export interface VerComo { tenant?: string; rol?: string; vista?: string }
export interface AccionesCatalogo {
  guardarFila: AccionDoc;
  importar: (previo: EstadoImportacion, fd: FormData) => Promise<EstadoImportacion>;
}

/** Cuántas filas de una tabla se dibujan a la vez (el filtro afina el resto). */
export const FILAS_VISIBLES = 200;

export const FRASE_SIN_CATALOGO = 'Aún no hay catálogo para este cliente: importa un CSV o guarda desde un documento.';

const ROTULO_TIPO: Record<TipoPlantilla, string> = {
  producto: 'Productos (SKU → clave SAT)', parte: 'Remitentes y destinatarios', cliente_numero: 'Cliente → número interno',
};
const ARCHIVO_PLANTILLA: Record<TipoPlantilla, string> = {
  producto: 'plantilla-productos.csv', parte: 'plantilla-remitentes-destinatarios.csv', cliente_numero: 'plantilla-cliente-numero.csv',
};

const hrefDe = (sufijo: string, clienteId: string): string => `/dashboard/agentes/carta-porte/catalogo${sufijo}${sufijo ? '&' : '?'}cliente=${encodeURIComponent(clienteId)}`;

function Ocultos({ ver }: { ver: VerComo }) {
  return (
    <>
      {ver.tenant && <input type="hidden" name="tenant" value={ver.tenant} />}
      {ver.rol && <input type="hidden" name="rol" value={ver.rol} />}
      {ver.vista && <input type="hidden" name="vista" value={ver.vista} />}
    </>
  );
}

const textoDe = (v: Registro[string] | undefined): string => (v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'sí' : 'no') : v);

/** Los campos de una fila (editar o agregar). Las columnas de la clave natural de una fila que ya existe no se editan. */
function Campos({ tipo, valores, claveBloqueada }: { tipo: TipoPlantilla; valores: Record<string, string>; claveBloqueada: boolean }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3">
      {columnasDeFila(tipo).map((c) => {
        const id = `cat-${tipo}-${c}-${claveBloqueada ? 'e' : 'n'}-${valores[COLUMNAS_CLAVE[tipo][0] ?? c] ?? ''}`.replace(/\s+/g, '_');
        const bloqueada = claveBloqueada && COLUMNAS_CLAVE[tipo].includes(c);
        const rotulo = ROTULO_COLUMNA[c] ?? c;
        if (c === 'material_peligroso' || c === 'activo') {
          return (
            <div key={c}>
              <label htmlFor={id} className={ETIQUETA}>{rotulo}</label>
              <select id={id} name={`c_${c}`} defaultValue={valores[c] || 'no'} className={CAMPO} style={{ background: 'var(--surface)' }}>
                <option value="si">sí</option>
                <option value="no">no</option>
              </select>
            </div>
          );
        }
        if (c === 'rol') {
          return (
            <div key={c}>
              <label htmlFor={id} className={ETIQUETA}>{rotulo}</label>
              <select id={id} name={`c_${c}`} defaultValue={valores[c] || 'remitente'} disabled={bloqueada} className={CAMPO} style={{ background: 'var(--surface)' }}>
                <option value="remitente">remitente</option>
                <option value="destinatario">destinatario</option>
              </select>
              {bloqueada && <input type="hidden" name={`c_${c}`} value={valores[c]} />}
            </div>
          );
        }
        return (
          <div key={c}>
            <label htmlFor={id} className={ETIQUETA}>{rotulo}</label>
            <input id={id} name={`c_${c}`} defaultValue={valores[c] ?? ''} readOnly={bloqueada} autoComplete="off" spellCheck={false}
              className={CAMPO} style={{ background: 'var(--surface)' }} />
          </div>
        );
      })}
    </div>
  );
}

function FormaFila({ tipo, clienteId, ver, accion, fila, modo }: {
  tipo: TipoPlantilla; clienteId: string; ver: VerComo; accion: AccionDoc; fila: Registro | null; modo: 'editar' | 'nuevo';
}) {
  return (
    <FormaAccion accion={accion} className="space-y-3 pt-3">
      <Ocultos ver={ver} />
      <input type="hidden" name="tipo" value={tipo} />
      <input type="hidden" name="cliente_id" value={clienteId} />
      <input type="hidden" name="modo" value={modo} />
      <Campos tipo={tipo} valores={valoresDeFormulario(tipo, fila)} claveBloqueada={modo === 'editar'} />
      <BotonEnvio variante="secundario" etiqueta={modo === 'nuevo' ? 'Agregar' : 'Guardar cambios'} pendiente="Guardando…" />
    </FormaAccion>
  );
}

function resumen(tipo: TipoPlantilla, f: Registro): ReactNode {
  if (tipo === 'producto') return <><strong className="font-medium cifra-mono">{textoDe(f.sku)}</strong><span style={{ color: 'var(--muted)' }}> · {textoDe(f.bienes_transp)} · {textoDe(f.clave_unidad)}{f.embalaje ? ` · ${textoDe(f.embalaje)}` : ''}</span></>;
  if (tipo === 'parte') return <><span style={{ color: 'var(--faint)' }}>{textoDe(f.rol)}</span> <strong className="font-medium">{textoDe(f.alias)}</strong><span style={{ color: 'var(--muted)' }}>{f.rfc ? ` · ${textoDe(f.rfc)}` : ' · sin RFC'}{f.cp ? ` · CP ${textoDe(f.cp)}` : ''}</span></>;
  return <><strong className="font-medium cifra-mono">{textoDe(f.numero_interno)}</strong>{f.activo === false && <span style={{ color: 'var(--warn)' }}> · inactivo</span>}</>;
}

const COLUMNAS_FILTRO: Record<TipoPlantilla, string[]> = {
  producto: ['sku', 'descripcion_patron', 'bienes_transp', 'clave_unidad', 'fraccion'],
  parte: ['rol', 'alias', 'razon_social', 'rfc', 'cp', 'municipio', 'estado'],
  cliente_numero: ['numero_interno', 'numero_pagador'],
};

function Tabla({ tipo, titulo, filas, clienteId, ver, acciones }: { tipo: TipoPlantilla; titulo: string; filas: Registro[]; clienteId: string; ver: VerComo; acciones: AccionesCatalogo }) {
  const [filtro, setFiltro] = useState('');
  const visibles = filtrarFilas(filas, filtro, COLUMNAS_FILTRO[tipo]);
  const idFiltro = `cat-filtro-${tipo}`;
  return (
    <section aria-label={titulo} className="card p-4 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-[13px] font-medium">{titulo} <span className="font-normal" style={{ color: 'var(--faint)' }}>({fmtNumero(filas.length)})</span></h2>
        {filas.length > 0 && (
          <div className="min-w-[220px]">
            <label htmlFor={idFiltro} className={ETIQUETA}>Filtrar</label>
            <input id={idFiltro} value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Escribe para filtrar…" autoComplete="off" className={CAMPO} style={{ background: 'var(--surface)' }} />
          </div>
        )}
      </div>
      {filas.length === 0 ? (
        <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>Todavía no hay nada aquí.</p>
      ) : visibles.length === 0 ? (
        <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>Ninguna fila coincide con «{filtro}».</p>
      ) : (
        <ul className="divide-y" style={{ borderColor: 'var(--hairline, var(--canvas))' }}>
          {visibles.slice(0, FILAS_VISIBLES).map((f, i) => (
            <li key={`${textoDe(f.sku)}|${textoDe(f.rol)}|${textoDe(f.alias)}|${i}`} className="py-2">
              <details>
                <summary className="cursor-pointer text-[12.5px] select-none">{resumen(tipo, f)}</summary>
                <FormaFila tipo={tipo} clienteId={clienteId} ver={ver} accion={acciones.guardarFila} fila={f} modo="editar" />
              </details>
            </li>
          ))}
        </ul>
      )}
      {visibles.length > FILAS_VISIBLES && (
        <p className="text-[11.5px]" style={{ color: 'var(--muted)' }}>Se muestran {fmtNumero(FILAS_VISIBLES)} de {fmtNumero(visibles.length)} filas: afina el filtro para ver las demás.</p>
      )}
      <details>
        <summary className="cursor-pointer text-[12.5px] font-medium select-none inline-flex items-center gap-1.5" style={{ color: 'var(--marca)' }}>
          <Plus width={13} height={13} strokeWidth={1.75} />Agregar una fila
        </summary>
        <FormaFila tipo={tipo} clienteId={clienteId} ver={ver} accion={acciones.guardarFila} fila={null} modo="nuevo" />
      </details>
    </section>
  );
}

function Numero({ fila, clienteId, ver, acciones }: { fila: Registro | null; clienteId: string; ver: VerComo; acciones: AccionesCatalogo }) {
  return (
    <section aria-label="Número interno del cliente" className="card p-4 space-y-2">
      <h2 className="text-[13px] font-medium">Número interno del cliente</h2>
      <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
        Es el número con el que el sistema de la empresa conoce al cliente que paga. Si falta o está mal, el documento no se liga: el agente no lo inventa.
      </p>
      {fila ? <p className="text-[12.5px]">Hoy: {resumen('cliente_numero', fila)}</p> : <p className="text-[12.5px]" style={{ color: 'var(--warn)' }}>Este cliente todavía no tiene número interno.</p>}
      <FormaFila tipo="cliente_numero" clienteId={clienteId} ver={ver} accion={acciones.guardarFila} fila={fila} modo={fila ? 'editar' : 'nuevo'} />
    </section>
  );
}

function Importador({ ver, importar }: { ver: VerComo; importar: AccionesCatalogo['importar'] }) {
  const [estado, despachar] = useActionState(importar, null);
  const [tipo, setTipo] = useState<TipoPlantilla>('producto');
  const [archivo, setArchivo] = useState<File | null>(null);
  return (
    <section aria-label="Importar un CSV" className="card p-4 space-y-3">
      <h2 className="text-[13px] font-medium flex items-center gap-1.5"><Upload width={14} height={14} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />Importar un CSV</h2>
      <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
        Descarga la plantilla, llénala (una fila por cliente y producto, remitente o destinatario) y súbela. Primero ves cuántas filas son nuevas, cuántas cambian y cuáles traen error; nada se guarda hasta que confirmes.
      </p>
      <ul className="flex flex-wrap gap-2" aria-label="Plantillas">
        {TIPOS_PLANTILLA.map((t) => (
          <li key={t}>
            <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(plantillaCsv(t))}`} download={ARCHIVO_PLANTILLA[t]}
              className="h-8 px-3 rounded-lg text-[12px] font-medium inline-flex items-center gap-1.5 hairline hover:opacity-85" style={{ background: 'var(--surface)', color: 'var(--ink)' }}>
              <Download width={13} height={13} strokeWidth={1.75} />{ROTULO_TIPO[t]}
            </a>
          </li>
        ))}
      </ul>
      {/* El envío arma su propio FormData: React limpia los campos tras cada envío y la vista previa y el «confirmar» deben ser del MISMO archivo. */}
      <form className="space-y-3" action={(fd) => { fd.set('tipo', tipo); if (archivo) fd.set('archivo', archivo); despachar(fd); }}>
        <Ocultos ver={ver} />
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="cat-imp-tipo" className={ETIQUETA}>Qué vas a importar</label>
            <select id="cat-imp-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoPlantilla)} className={CAMPO} style={{ background: 'var(--surface)' }}>
              {TIPOS_PLANTILLA.map((t) => <option key={t} value={t}>{ROTULO_TIPO[t]}</option>)}
            </select>
          </div>
          <div className="grow min-w-[220px]">
            <label htmlFor="cat-imp-archivo" className={ETIQUETA}>Archivo CSV (hasta 5 MB)</label>
            <input id="cat-imp-archivo" type="file" accept=".csv,text/csv" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} className="text-[12.5px]" />
            {archivo && <p className="text-[11px] pt-1" style={{ color: 'var(--faint)' }}>Archivo elegido: {archivo.name}</p>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <BotonEnvio variante="secundario" intencion="previsualizar" etiqueta="Ver vista previa" pendiente="Revisando…" />
          <BotonEnvio intencion="confirmar" etiqueta="Confirmar e importar" pendiente="Importando…" />
        </div>
      </form>
      <ResultadoImportar estado={estado} />
    </section>
  );
}

function ResultadoImportar({ estado }: { estado: EstadoImportacion }) {
  if (!estado) return null;
  if ('error' in estado) return <Aviso estado={{ ok: false, error: estado.error }} />;
  return (
    <div className="space-y-2" role="status">
      <Aviso estado={estado.ok ? { ok: true, mensaje: estado.aplicado ? `Importado. ${estado.mensaje}` : `Vista previa: ${estado.mensaje}` } : { ok: false, error: estado.mensaje }} />
      {estado.errores.length > 0 && (
        <ul className="text-[12px] list-disc pl-5 space-y-0.5" style={{ color: 'var(--bad)' }} aria-label="Filas con error">
          {estado.errores.map((e) => <li key={e.fila}>Fila {fmtNumero(e.fila)}: {e.mensaje}</li>)}
          {estado.conError > estado.errores.length && <li>… y {fmtNumero(estado.conError - estado.errores.length)} más.</li>}
        </ul>
      )}
    </div>
  );
}

export function VistaCatalogo({ clientes, clienteId, catalogo, lecturaFallida = false, sufijo = '', ver = {}, acciones }: {
  clientes: ClienteVista[];
  /** El cliente elegido (uno de `clientes`) o null si aún no se elige. */
  clienteId: string | null;
  /** Su catálogo; null = no se eligió cliente o no se pudo leer (`lecturaFallida`). */
  catalogo: CatalogoVista | null;
  lecturaFallida?: boolean;
  sufijo?: string;
  ver?: VerComo;
  acciones: AccionesCatalogo;
}) {
  const [buscar, setBuscar] = useState('');
  const elegido = clientes.find((c) => c.id === clienteId) ?? null;
  const k = llaveTexto(buscar);
  const clientesVisibles = k === '' ? clientes : clientes.filter((c) => llaveTexto(c.nombre).includes(k));
  const vacio = catalogo !== null && catalogo.numero === null && catalogo.productos.length === 0 && catalogo.partes.length === 0;
  return (
    <main className="max-w-[1100px] mx-auto px-5 py-6 space-y-4">
      <Link href={`/dashboard/agentes/carta-porte${sufijo}`} className="text-[12.5px] font-medium inline-flex items-center gap-1 hover:opacity-75" style={{ color: 'var(--marca)' }}>
        <ArrowLeft width={13} height={13} strokeWidth={1.75} /> Volver al Agente de Carta Porte
      </Link>
      <header className="space-y-1">
        <h1 className="font-display text-[19px] font-semibold flex items-center gap-2"><BookOpen width={18} height={18} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />Catálogo del cliente</h1>
        <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
          Lo que el agente aprende una vez de cada cliente —sus productos, sus remitentes y destinatarios y su número interno— para no pedirlo en cada documento.
          Un dato del catálogo nunca pisa lo que una persona escribió en la revisión.
        </p>
      </header>

      <Importador ver={ver} importar={acciones.importar} />

      <section aria-label="Cliente" className="card p-4 space-y-3">
        <h2 className="text-[13px] font-medium">Cliente</h2>
        {clientes.length === 0 ? (
          <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>Aún no hay clientes en tu flota: el catálogo se arma por cliente. Da de alta uno primero.</p>
        ) : (
          <>
            {clientes.length > 8 && (
              <div className="max-w-sm">
                <label htmlFor="cat-buscar-cliente" className={ETIQUETA}>Buscar cliente</label>
                <input id="cat-buscar-cliente" value={buscar} onChange={(e) => setBuscar(e.target.value)} autoComplete="off" className={CAMPO} style={{ background: 'var(--surface)' }} />
              </div>
            )}
            <ul className="flex flex-wrap gap-2">
              {clientesVisibles.map((c) => (
                <li key={c.id}>
                  <Link href={hrefDe(sufijo, c.id)} aria-current={c.id === clienteId ? 'true' : undefined}
                    className="h-8 px-3 rounded-lg text-[12.5px] font-medium inline-flex items-center hairline hover:opacity-85"
                    style={c.id === clienteId ? { background: 'var(--marca)', color: 'var(--marca-fg)' } : { background: 'var(--surface)', color: 'var(--ink)' }}>
                    {c.nombre}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {elegido === null ? (
        clientes.length > 0 && <p className="card p-4 text-[12.5px]" style={{ color: 'var(--muted)' }}>Elige un cliente para ver y editar su catálogo.</p>
      ) : lecturaFallida || catalogo === null ? (
        <p className="card p-4 text-[12.5px]" role="alert" style={{ color: 'var(--bad)' }}>No se pudo leer el catálogo de {elegido.nombre}. Recarga la pantalla; si sigue igual, avísanos.</p>
      ) : (
        <>
          {vacio && <p className="card p-4 text-[12.5px]" role="status">{FRASE_SIN_CATALOGO}</p>}
          {catalogo.truncado && (
            <p className="text-[12px] px-3 py-2 rounded-lg" role="alert" style={{ color: 'var(--warn)' }}>
              El catálogo de este cliente es tan grande que solo se leyó una parte: puede faltar alguna fila en esta pantalla.
            </p>
          )}
          <Numero fila={catalogo.numero} clienteId={elegido.id} ver={ver} acciones={acciones} />
          <Tabla tipo="producto" titulo="Productos" filas={catalogo.productos} clienteId={elegido.id} ver={ver} acciones={acciones} />
          <Tabla tipo="parte" titulo="Remitentes y destinatarios" filas={catalogo.partes} clienteId={elegido.id} ver={ver} acciones={acciones} />
        </>
      )}
    </main>
  );
}
