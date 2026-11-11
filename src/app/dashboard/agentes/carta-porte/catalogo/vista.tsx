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
  Aviso as AvisoV2, BarraFiltros, BotonEnlace, CampoArchivo, CampoSelect, CampoTexto, clasesBoton, Disclosure, EstadoError, EstadoVacio, Icono, Tarjeta,
} from '@/app/ui-v2/componentes';
import { EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import { useT } from '@/lib/i18n/proveedor';
import { agentes as agentesEs } from '@/lib/i18n/es/agentes';
import { type TAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';

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

export const fraseSinCatalogo = (tx: TAgentes = TR_ES.t) => (tx('rest.aun_no_hay_catalogo_para_este'));
export const FRASE_SIN_CATALOGO = fraseSinCatalogo();

const rotuloTipo = (tx: TAgentes = TR_ES.t): Record<TipoPlantilla, string> => ({
  producto: 'Productos (SKU → clave SAT)', parte: tx('rest.remitentes_y_destinatarios'), cliente_numero: tx('rest.cliente_numero_interno'),
});
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
  const { t: tx } = useT('agentes', agentesEs);
  return (
    <div className="rv-cp__cuad">
      {columnasDeFila(tipo).map((c) => {
        const id = `cat-${tipo}-${c}-${claveBloqueada ? 'e' : 'n'}-${valores[COLUMNAS_CLAVE[tipo][0] ?? c] ?? ''}`.replace(/\s+/g, '_');
        const bloqueada = claveBloqueada && COLUMNAS_CLAVE[tipo].includes(c);
        const rotulo = ROTULO_COLUMNA[c] ?? c;
        if (c === 'material_peligroso' || c === 'activo') {
          return (
            <CampoSelect key={c} id={id} etiqueta={rotulo} name={`c_${c}`} defaultValue={valores[c] || 'no'}>
              <option value="si">{tx('rest.si_2')}</option>
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
  const { t: tx } = useT('agentes', agentesEs);
  return (
    <FormaAccion accion={accion} className="rv-cp__pila">
      <Ocultos ver={ver} />
      <input type="hidden" name="tipo" value={tipo} />
      <input type="hidden" name="cliente_id" value={clienteId} />
      <input type="hidden" name="modo" value={modo} />
      <Campos tipo={tipo} valores={valoresDeFormulario(tipo, fila)} claveBloqueada={modo === 'editar'} />
      <BotonEnvio variante="secundario" etiqueta={modo === 'nuevo' ? tx('rest.agregar') : tx('rest.guardar_cambios')} pendiente={tx('cobranza.formagasto.guardando')} />
    </FormaAccion>
  );
}

function resumen(tipo: TipoPlantilla, f: Registro, tx: TAgentes = TR_ES.t): ReactNode {
  if (tipo === 'producto') return <><strong className="rv-ag-num">{textoDe(f.sku)}</strong><span className="rv-cp__tenue"> · {textoDe(f.bienes_transp)} · {textoDe(f.clave_unidad)}{f.embalaje ? ` · ${textoDe(f.embalaje)}` : ''}</span></>;
  if (tipo === 'parte') return <><span className="rv-cp__tenue">{textoDe(f.rol)}</span> <strong>{textoDe(f.alias)}</strong><span className="rv-cp__tenue">{f.rfc ? ` · ${textoDe(f.rfc)}` : ' · sin RFC'}{f.cp ? ` · CP ${textoDe(f.cp)}` : ''}</span></>;
  return <><strong className="rv-ag-num">{textoDe(f.numero_interno)}</strong>{f.activo === false && <span className="rv-cp__nota" data-tono="warn">{tx('rest.inactivo')}</span>}</>;
}

const COLUMNAS_FILTRO: Record<TipoPlantilla, string[]> = {
  producto: ['sku', 'descripcion_patron', 'bienes_transp', 'clave_unidad', 'fraccion'],
  parte: ['rol', 'alias', 'razon_social', 'rfc', 'cp', 'municipio', 'estado'],
  cliente_numero: ['numero_interno', 'numero_pagador'],
};

function Tabla({ tipo, titulo, filas, clienteId, ver, acciones }: { tipo: TipoPlantilla; titulo: string; filas: Registro[]; clienteId: string; ver: VerComo; acciones: AccionesCatalogo }) {
  const { t: tx } = useT('agentes', agentesEs);
  const [filtro, setFiltro] = useState('');
  const visibles = filtrarFilas(filas, filtro, COLUMNAS_FILTRO[tipo]);
  return (
    <Tarjeta titulo={`${titulo} (${fmtNumero(filas.length)})`} info={tipo === 'producto' ? 'carta_porte_catalogo.productos' : 'carta_porte_catalogo.partes'}
      acciones={filas.length > 0 ? (
        <BarraFiltros enLinea etiqueta={`Filtrar ${titulo}`} busqueda={{ valor: filtro, onCambio: setFiltro, placeholder: tx('rest.escribe_para_filtrar'), etiqueta: tx('rest.filtrar') }} nActivos={filtro ? 1 : 0} />
      ) : undefined}>
      <div className="rv-cp__pila">
        {filas.length === 0 ? (
          <p className="rv-cp__nota">{tx('rest.todavia_no_hay_nada_aqui')}</p>
        ) : visibles.length === 0 ? (
          <p className="rv-cp__nota">{tx('rest.ninguna_fila_coincide_con', { filtro })}</p>
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
          <p className="rv-cp__nota" data-tono="faint">{tx('rest.se_muestran_de_filas_afina_el', { fmtNumero: fmtNumero(FILAS_VISIBLES), fmtNumero2: fmtNumero(visibles.length) })}</p>
        )}
        <Disclosure titulo={tx('rest.agregar_una_fila')} variante="linea">
          <FormaFila tipo={tipo} clienteId={clienteId} ver={ver} accion={acciones.guardarFila} fila={null} modo="nuevo" />
        </Disclosure>
      </div>
    </Tarjeta>
  );
}

function Numero({ fila, clienteId, ver, acciones }: { fila: Registro | null; clienteId: string; ver: VerComo; acciones: AccionesCatalogo }) {
  const { t: tx } = useT('agentes', agentesEs);
  return (
    <Tarjeta titulo={tx('rest.numero_interno_del_cliente')} info="carta_porte_catalogo.numero_interno">
      <div className="rv-cp__pila">
        <p className="rv-cp__nota">{tx('rest.es_el_numero_con_el_que')}</p>
        {fila ? <p className="rv-cp__nota">Hoy: {resumen('cliente_numero', fila)}</p> : <p className="rv-cp__nota" data-tono="warn">{tx('rest.este_cliente_todavia_no_tiene_numero')}</p>}
        <FormaFila tipo="cliente_numero" clienteId={clienteId} ver={ver} accion={acciones.guardarFila} fila={fila} modo={fila ? 'editar' : 'nuevo'} />
      </div>
    </Tarjeta>
  );
}

function Importador({ ver, importar }: { ver: VerComo; importar: AccionesCatalogo['importar'] }) {
  const { t: tx } = useT('agentes', agentesEs);
  const [estado, despachar] = useActionState(importar, null);
  const [tipo, setTipo] = useState<TipoPlantilla>('producto');
  const [archivo, setArchivo] = useState<File | null>(null);
  return (
    <Tarjeta titulo={tx('rest.importar_un_csv')} info="carta_porte_catalogo.importar">
      <div className="rv-cp__pila">
        <p className="rv-cp__nota">{tx('rest.descarga_la_plantilla_llenala_una_fila')}</p>
        <ul className="rv-cp__acciones" aria-label={tx('rest.plantillas')}>
          {TIPOS_PLANTILLA.map((t) => (
            <li key={t}>
              <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(plantillaCsv(t))}`} download={ARCHIVO_PLANTILLA[t]} className={clasesBoton('secondary', 'sm')}>
                <Icono icono={Download} tam={14} />{rotuloTipo(tx)[t]}
              </a>
            </li>
          ))}
        </ul>
        {/* El envío arma su propio FormData: React limpia los campos tras cada envío y la vista previa y el «confirmar» deben ser del MISMO archivo. */}
        <form className="rv-cp__pila" action={(fd) => { fd.set('tipo', tipo); if (archivo) fd.set('archivo', archivo); despachar(fd); }}>
          <Ocultos ver={ver} />
          <div className="rv-cp__cuad">
            <CampoSelect id="cat-imp-tipo" etiqueta={tx('rest.que_vas_a_importar')} value={tipo} onChange={(e) => setTipo(e.target.value as TipoPlantilla)}>
              {TIPOS_PLANTILLA.map((t) => <option key={t} value={t}>{rotuloTipo(tx)[t]}</option>)}
            </CampoSelect>
            <CampoArchivo id="cat-imp-archivo" etiqueta={tx('rest.archivo_csv_hasta_4_mb')} accept=".csv,text/csv" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
          </div>
          {archivo && <p className="rv-cp__nota" data-tono="faint">{tx('rest.archivo_elegido')}{' '}{archivo.name}</p>}
          <div className="rv-cp__acciones">
            <BotonEnvio variante="secundario" intencion="previsualizar" etiqueta={tx('rest.ver_vista_previa')} pendiente={tx('rest.revisando')} />
            <BotonEnvio intencion="confirmar" etiqueta={tx('rest.confirmar_e_importar')} pendiente={tx('rest.importando')} />
          </div>
        </form>
        <ResultadoImportar estado={estado} />
      </div>
    </Tarjeta>
  );
}

function ResultadoImportar({ estado }: { estado: EstadoImportacion }) {
  const { t: tx } = useT('agentes', agentesEs);
  if (!estado) return null;
  if ('error' in estado) return <Aviso estado={{ ok: false, error: estado.error }} />;
  return (
    <div className="rv-cp__pila" role="status">
      <Aviso estado={estado.ok ? { ok: true, mensaje: estado.aplicado ? `Importado. ${estado.mensaje}` : `Vista previa: ${estado.mensaje}` } : { ok: false, error: estado.mensaje }} />
      {estado.errores.length > 0 && (
        <ul className="rv-cp__lista rv-cp__error" aria-label={tx('rest.filas_con_error')}>
          {estado.errores.map((e) => <li key={e.fila}>{tx('rest.fila', { fmtNumero: fmtNumero(e.fila) })}{' '}{e.mensaje}</li>)}
          {estado.conError > estado.errores.length && <li>{tx('rest.y_mas', { fmtNumero: fmtNumero(estado.conError - estado.errores.length) })}</li>}
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
  const { t: tx } = useT('agentes', agentesEs);
  const [buscar, setBuscar] = useState('');
  const elegido = clientes.find((c) => c.id === clienteId) ?? null;
  const k = llaveTexto(buscar);
  const clientesVisibles = k === '' ? clientes : clientes.filter((c) => llaveTexto(c.nombre).includes(k));
  const vacio = catalogo !== null && catalogo.numero === null && catalogo.productos.length === 0 && catalogo.partes.length === 0;
  return (
    <EsqueletoTablaMaestra
      titulo={tx('rest.catalogo_del_cliente')}
      apoyo={tx('rest.lo_que_el_agente_aprende_una')}
      acciones={<BotonEnlace tamano="sm" href={`/dashboard/agentes/carta-porte${sufijo}`} icono={<Icono icono={ArrowLeft} tam={14} />}>{tx('rest.volver_al_agente_de_carta_porte')}</BotonEnlace>}
      filtros={(
        <div className="rv-cp__pila" role="group" aria-label={tx('vigia.vista.cliente')}>
          {clientes.length > 8 && (
            <div className="rv-cp__form">
              <CampoTexto id="cat-buscar-cliente" etiqueta={tx('rest.buscar_cliente')} value={buscar} onChange={(e) => setBuscar(e.target.value)} autoComplete="off" />
            </div>
          )}
          {clientes.length === 0 ? <p className="rv-cp__nota">{tx('rest.aun_no_hay_clientes_en_tu')}</p> : (
            <ul className="rv-cp__acciones">
              {clientesVisibles.map((c) => (
                <li key={c.id}>
                  <Link href={hrefDe(sufijo, c.id)} aria-current={c.id === clienteId ? 'true' : undefined} className={clasesBoton(c.id === clienteId ? 'primary' : 'secondary', 'sm')}>
                    {c.nombre}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      avisos={(
        <>
          <AvisoV2 tono="info">{tx('rest.un_dato_del_catalogo_nunca_pisa')}</AvisoV2>
          {elegido !== null && catalogo?.truncado ? <AvisoV2 tono="warn">{tx('rest.el_catalogo_de_este_cliente_es')}</AvisoV2> : null}
        </>
      )}
      cifras={elegido !== null && !lecturaFallida && catalogo !== null ? [
        { etiqueta: tx('f26d.catalogo.productos'), valor: `${fmtNumero(catalogo.productos.length)}${catalogo.truncado ? '+' : ''}` },
        { etiqueta: tx('f26d.catalogo.partes'), valor: `${fmtNumero(catalogo.partes.length)}${catalogo.truncado ? '+' : ''}` },
      ] : undefined}
      etiquetaCifras={tx('rest.catalogo_del_cliente')}
    >
      <Importador ver={ver} importar={acciones.importar} />

      {elegido === null ? (
        clientes.length > 0 && <p className="rv-cp__nota">{tx('rest.elige_un_cliente_para_ver_y')}</p>
      ) : lecturaFallida || catalogo === null ? (
        <EstadoError reintentar>{tx('rest.no_se_pudo_leer_el_catalogo', { nombre: elegido.nombre })}</EstadoError>
      ) : (
        <>
          {vacio && <EstadoVacio titulo={tx('rest.aun_sin_catalogo')} contenido>{fraseSinCatalogo(tx)}</EstadoVacio>}
          <Numero fila={catalogo.numero} clienteId={elegido.id} ver={ver} acciones={acciones} />
          <Tabla tipo="producto" titulo={tx('rest.productos')} filas={catalogo.productos} clienteId={elegido.id} ver={ver} acciones={acciones} />
          <Tabla tipo="parte" titulo={tx('rest.remitentes_y_destinatarios')} filas={catalogo.partes} clienteId={elegido.id} ver={ver} acciones={acciones} />
        </>
      )}
    </EsqueletoTablaMaestra>
  );
}
