'use client';

import { useState, type ReactNode } from 'react';
import { CAMPO_FLOTA_PINTADA } from '@/lib/auth/flota_cambio';
import { useActionState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download } from 'lucide-react';
import '../carta-porte.css';
import { numero as fmtNumero } from '@/lib/formato';
import { llaveTexto } from '@/lib/likida/carta_porte_docs/catalogos';
import { plantillaCsv, TIPOS_PLANTILLA, type Registro, type TipoPlantilla } from '@/lib/likida/carta_porte_docs/catalogo_import';
import { COLUMNAS_CLAVE, ROTULO_COLUMNA, columnasDeFila, filtrarFilas, valoresDeFormulario, type FilasCatalogo } from '@/lib/likida/carta_porte_docs/catalogo_pantalla';
import { Aviso, BotonEnvio, FormaAccion, type AccionDoc } from '../../../carta-porte/documentos/forma_accion';
import type { EstadoImportacion } from './actions';
import {
  Aviso as AvisoV2, BarraFiltros, BotonEnlace, CampoArchivo, CampoSelect, CampoTexto, clasesBoton, Disclosure, EstadoError, EstadoVacio, Icono, MarcoPagina, Tarjeta,
} from '@/app/ui-v2/componentes';

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
export interface VerComo { tenant?: string; rol?: string; vista?: string; /** La flota pintada, firmada (MX-002). */ flota?: string }
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
      {ver.flota && <input type="hidden" name={CAMPO_FLOTA_PINTADA} value={ver.flota} />}
    </>
  );
}

const textoDe = (v: Registro[string] | undefined): string => (v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'sí' : 'no') : v);

/** Los campos de una fila (editar o agregar). Las columnas de la clave natural de una fila que ya existe no se editan. */
function Campos({ tipo, valores, claveBloqueada }: { tipo: TipoPlantilla; valores: Record<string, string>; claveBloqueada: boolean }) {
  return (
    <div className="rv-cp__cuad">
      {columnasDeFila(tipo).map((c) => {
        const id = `cat-${tipo}-${c}-${claveBloqueada ? 'e' : 'n'}-${valores[COLUMNAS_CLAVE[tipo][0] ?? c] ?? ''}`.replace(/\s+/g, '_');
        const bloqueada = claveBloqueada && COLUMNAS_CLAVE[tipo].includes(c);
        const rotulo = ROTULO_COLUMNA[c] ?? c;
        if (c === 'material_peligroso' || c === 'activo') {
          return (
            <CampoSelect key={c} id={id} etiqueta={rotulo} name={`c_${c}`} defaultValue={valores[c] || 'no'}>
              <option value="si">sí</option>
              <option value="no">no</option>
            </CampoSelect>
          );
        }
        if (c === 'rol') {
          return (
            <div key={c}>
              <CampoSelect id={id} etiqueta={rotulo} name={`c_${c}`} defaultValue={valores[c] || 'remitente'} disabled={bloqueada}>
                <option value="remitente">remitente</option>
                <option value="destinatario">destinatario</option>
              </CampoSelect>
              {bloqueada && <input type="hidden" name={`c_${c}`} value={valores[c]} />}
            </div>
          );
        }
        return <CampoTexto key={c} id={id} etiqueta={rotulo} name={`c_${c}`} defaultValue={valores[c] ?? ''} readOnly={bloqueada} autoComplete="off" spellCheck={false} />;
      })}
    </div>
  );
}

function FormaFila({ tipo, clienteId, ver, accion, fila, modo }: {
  tipo: TipoPlantilla; clienteId: string; ver: VerComo; accion: AccionDoc; fila: Registro | null; modo: 'editar' | 'nuevo';
}) {
  return (
    <FormaAccion accion={accion} className="rv-cp__pila">
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
  if (tipo === 'producto') return <><strong className="cifra-mono">{textoDe(f.sku)}</strong><span className="rv-cp__tenue"> · {textoDe(f.bienes_transp)} · {textoDe(f.clave_unidad)}{f.embalaje ? ` · ${textoDe(f.embalaje)}` : ''}</span></>;
  if (tipo === 'parte') return <><span className="rv-cp__tenue">{textoDe(f.rol)}</span> <strong>{textoDe(f.alias)}</strong><span className="rv-cp__tenue">{f.rfc ? ` · ${textoDe(f.rfc)}` : ' · sin RFC'}{f.cp ? ` · CP ${textoDe(f.cp)}` : ''}</span></>;
  return <><strong className="cifra-mono">{textoDe(f.numero_interno)}</strong>{f.activo === false && <span className="rv-cp__nota" data-tono="warn"> · inactivo</span>}</>;
}

const COLUMNAS_FILTRO: Record<TipoPlantilla, string[]> = {
  producto: ['sku', 'descripcion_patron', 'bienes_transp', 'clave_unidad', 'fraccion'],
  parte: ['rol', 'alias', 'razon_social', 'rfc', 'cp', 'municipio', 'estado'],
  cliente_numero: ['numero_interno', 'numero_pagador'],
};

function Tabla({ tipo, titulo, filas, clienteId, ver, acciones }: { tipo: TipoPlantilla; titulo: string; filas: Registro[]; clienteId: string; ver: VerComo; acciones: AccionesCatalogo }) {
  const [filtro, setFiltro] = useState('');
  const visibles = filtrarFilas(filas, filtro, COLUMNAS_FILTRO[tipo]);
  return (
    <Tarjeta titulo={`${titulo} (${fmtNumero(filas.length)})`} info={tipo === 'producto' ? 'carta_porte_catalogo.productos' : 'carta_porte_catalogo.partes'}
      acciones={filas.length > 0 ? (
        <BarraFiltros enLinea etiqueta={`Filtrar ${titulo}`} busqueda={{ valor: filtro, onCambio: setFiltro, placeholder: 'Escribe para filtrar…', etiqueta: 'Filtrar' }} nActivos={filtro ? 1 : 0} />
      ) : undefined}>
      <div className="rv-cp__pila">
        {filas.length === 0 ? (
          <p className="rv-cp__nota">Todavía no hay nada aquí.</p>
        ) : visibles.length === 0 ? (
          <p className="rv-cp__nota">Ninguna fila coincide con «{filtro}».</p>
        ) : (
          <ul className="rv-cp__filas">
            {visibles.slice(0, FILAS_VISIBLES).map((f, i) => (
              <li key={`${textoDe(f.sku)}|${textoDe(f.rol)}|${textoDe(f.alias)}|${i}`}>
                <Disclosure titulo={resumen(tipo, f)} variante="linea">
                  <FormaFila tipo={tipo} clienteId={clienteId} ver={ver} accion={acciones.guardarFila} fila={f} modo="editar" />
                </Disclosure>
              </li>
            ))}
          </ul>
        )}
        {visibles.length > FILAS_VISIBLES && (
          <p className="rv-cp__nota" data-tono="faint">Se muestran {fmtNumero(FILAS_VISIBLES)} de {fmtNumero(visibles.length)} filas: afina el filtro para ver las demás.</p>
        )}
        <Disclosure titulo="Agregar una fila" variante="linea">
          <FormaFila tipo={tipo} clienteId={clienteId} ver={ver} accion={acciones.guardarFila} fila={null} modo="nuevo" />
        </Disclosure>
      </div>
    </Tarjeta>
  );
}

function Numero({ fila, clienteId, ver, acciones }: { fila: Registro | null; clienteId: string; ver: VerComo; acciones: AccionesCatalogo }) {
  return (
    <Tarjeta titulo="Número interno del cliente" info="carta_porte_catalogo.numero_interno">
      <div className="rv-cp__pila">
        <p className="rv-cp__nota">
          Es el número con el que el sistema de la empresa conoce al cliente que paga. Si falta o está mal, el documento no se liga: el agente no lo inventa.
        </p>
        {fila ? <p className="rv-cp__nota">Hoy: {resumen('cliente_numero', fila)}</p> : <p className="rv-cp__nota" data-tono="warn">Este cliente todavía no tiene número interno.</p>}
        <FormaFila tipo="cliente_numero" clienteId={clienteId} ver={ver} accion={acciones.guardarFila} fila={fila} modo={fila ? 'editar' : 'nuevo'} />
      </div>
    </Tarjeta>
  );
}

function Importador({ ver, importar }: { ver: VerComo; importar: AccionesCatalogo['importar'] }) {
  const [estado, despachar] = useActionState(importar, null);
  const [tipo, setTipo] = useState<TipoPlantilla>('producto');
  const [archivo, setArchivo] = useState<File | null>(null);
  return (
    <Tarjeta titulo="Importar un CSV" info="carta_porte_catalogo.importar">
      <div className="rv-cp__pila">
        <p className="rv-cp__nota">
          Descarga la plantilla, llénala (una fila por cliente y producto, remitente o destinatario) y súbela. Primero ves cuántas filas son nuevas, cuántas cambian y cuáles traen error; nada se guarda hasta que confirmes.
        </p>
        <ul className="rv-cp__acciones" aria-label="Plantillas">
          {TIPOS_PLANTILLA.map((t) => (
            <li key={t}>
              <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(plantillaCsv(t))}`} download={ARCHIVO_PLANTILLA[t]} className={clasesBoton('secondary', 'sm')}>
                <Icono icono={Download} tam={14} />{ROTULO_TIPO[t]}
              </a>
            </li>
          ))}
        </ul>
        {/* El envío arma su propio FormData: React limpia los campos tras cada envío y la vista previa y el «confirmar» deben ser del MISMO archivo. */}
        <form className="rv-cp__pila" action={(fd) => { fd.set('tipo', tipo); if (archivo) fd.set('archivo', archivo); despachar(fd); }}>
          <Ocultos ver={ver} />
          <div className="rv-cp__cuad">
            <CampoSelect id="cat-imp-tipo" etiqueta="Qué vas a importar" value={tipo} onChange={(e) => setTipo(e.target.value as TipoPlantilla)}>
              {TIPOS_PLANTILLA.map((t) => <option key={t} value={t}>{ROTULO_TIPO[t]}</option>)}
            </CampoSelect>
            <CampoArchivo id="cat-imp-archivo" etiqueta="Archivo CSV (hasta 4 MB)" accept=".csv,text/csv" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
          </div>
          {archivo && <p className="rv-cp__nota" data-tono="faint">Archivo elegido: {archivo.name}</p>}
          <div className="rv-cp__acciones">
            <BotonEnvio variante="secundario" intencion="previsualizar" etiqueta="Ver vista previa" pendiente="Revisando…" />
            <BotonEnvio intencion="confirmar" etiqueta="Confirmar e importar" pendiente="Importando…" />
          </div>
        </form>
        <ResultadoImportar estado={estado} />
      </div>
    </Tarjeta>
  );
}

function ResultadoImportar({ estado }: { estado: EstadoImportacion }) {
  if (!estado) return null;
  if ('error' in estado) return <Aviso estado={{ ok: false, error: estado.error }} />;
  return (
    <div className="rv-cp__pila" role="status">
      <Aviso estado={estado.ok ? { ok: true, mensaje: estado.aplicado ? `Importado. ${estado.mensaje}` : `Vista previa: ${estado.mensaje}` } : { ok: false, error: estado.mensaje }} />
      {estado.errores.length > 0 && (
        <ul className="rv-cp__lista rv-cp__error" aria-label="Filas con error">
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
    <MarcoPagina titulo="Catálogo del cliente" apoyo="Lo que el agente aprende una vez de cada cliente: productos, remitentes y destinatarios y su número interno." acciones={<BotonEnlace tamano="sm" href={`/dashboard/agentes/carta-porte${sufijo}`} icono={<Icono icono={ArrowLeft} tam={14} />}>Volver al Agente de Carta Porte</BotonEnlace>}>
      <AvisoV2 tono="info">Un dato del catálogo nunca pisa lo que una persona escribió en la revisión.</AvisoV2>

      <Importador ver={ver} importar={acciones.importar} />

      <Tarjeta titulo="Cliente" info="carta_porte_catalogo.cliente" estado={clientes.length === 0 ? 'vacio' : 'ok'} mensaje="Aún no hay clientes en tu flota"
        detalle="Aún no hay clientes en tu flota: el catálogo se arma por cliente. Da de alta uno primero.">
        <div className="rv-cp__pila">
          {clientes.length > 8 && (
            <div className="rv-cp__form">
              <CampoTexto id="cat-buscar-cliente" etiqueta="Buscar cliente" value={buscar} onChange={(e) => setBuscar(e.target.value)} autoComplete="off" />
            </div>
          )}
          <ul className="rv-cp__acciones">
            {clientesVisibles.map((c) => (
              <li key={c.id}>
                <Link href={hrefDe(sufijo, c.id)} aria-current={c.id === clienteId ? 'true' : undefined} className={clasesBoton(c.id === clienteId ? 'primary' : 'secondary', 'sm')}>
                  {c.nombre}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </Tarjeta>

      {elegido === null ? (
        clientes.length > 0 && <p className="rv-cp__nota">Elige un cliente para ver y editar su catálogo.</p>
      ) : lecturaFallida || catalogo === null ? (
        <EstadoError reintentar>{`No se pudo leer el catálogo de ${elegido.nombre}. Recarga la pantalla; si sigue igual, avísanos.`}</EstadoError>
      ) : (
        <>
          {vacio && <EstadoVacio titulo="Aún sin catálogo" contenido>{FRASE_SIN_CATALOGO}</EstadoVacio>}
          {catalogo.truncado && (
            <AvisoV2 tono="warn">
              El catálogo de este cliente es tan grande que solo se leyó una parte: puede faltar alguna fila en esta pantalla.
            </AvisoV2>
          )}
          <Numero fila={catalogo.numero} clienteId={elegido.id} ver={ver} acciones={acciones} />
          <Tabla tipo="producto" titulo="Productos" filas={catalogo.productos} clienteId={elegido.id} ver={ver} acciones={acciones} />
          <Tabla tipo="parte" titulo="Remitentes y destinatarios" filas={catalogo.partes} clienteId={elegido.id} ver={ver} acciones={acciones} />
        </>
      )}
    </MarcoPagina>
  );
}
