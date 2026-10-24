// Resolver la fila del programa → cliente, contacto, unidad, caja y operador (T-A4-11).
//
// Junta, para UNA fila del programa de despacho, lo que hace falta para armar el aviso al cliente (747a3730 00:21: caja,
// placas de la caja, estado de la caja, unidad, placas de la unidad, operador, licencia, vigencia, teléfono). No decide si
// el dato se le puede dar al cliente (eso es la política de privacidad, T-A4-12) ni redacta nada (T-A4-14).
// Reglas:
//  - Nunca se adivina. Cliente sin alias → `sin_cliente`; dos clientes con el mismo alias → `ambiguo`; unidad que no está en
//    el catálogo → `unidad_no_registrada`. Cada hueco queda en `faltantes`.
//  - El `clienteId` sale de la tabla de alias de ESTA flota (`deps.aliasDe`), nunca del texto. Toda fila que regrese una
//    dependencia con otra `tenantId` se descarta (un cliente, contacto, unidad u operador de otra flota «no existe»).
//  - Operador (A37-A4-05): primero lo CAPTURADO A MANO para la fila (completado con el catálogo si trae `operadorId`); el del
//    viaje abierto de la unidad (sistema) solo si ese viaje corresponde al SERVICIO de la fila (mismo REQUE, o misma fecha si
//    no hay REQUE). Cada dato lleva su `fuente`.
//  - Caja: el número sale de la fila; placas y estado, de lo capturado a mano para la fila y si no del catálogo de cajas.
// Función con dependencias inyectadas: no toca la base ni la red por sí misma.

import type { FilaPrograma } from '../programa/normalizar';
import type { Contacto } from '../tipos';
import { normalizarAlias, resolverAlias, type AliasCliente, type CampoAlias } from './equivalencias';

export type FuenteDato = 'sistema' | 'manual' | 'catalogo';

export type FaltanteResolucion =
  | 'sin_cliente'
  | 'cliente_ambiguo'
  | 'sin_contacto'
  | 'sin_unidad'
  | 'unidad_no_registrada'
  | 'unidad_ambigua'
  | 'sin_caja'
  | 'sin_operador';

export type EstadoClienteResuelto = 'resuelto' | 'sin_cliente' | 'ambiguo';

export interface UnidadCatalogo {
  tenantId: string;
  id: string;
  numero: string;
  placas: string | null;
}

export interface CajaDelCatalogo {
  tenantId: string;
  numero: string;
  placas: string | null;
  estado: string | null;
}

export interface OperadorDato {
  tenantId: string;
  nombre: string | null;
  licencia: string | null;
  /** AAAA-MM-DD. */
  licenciaVence: string | null;
  /** 52 + 10 dígitos. */
  telefono: string | null;
  /**
   * A37-A4-05: de QUÉ servicio es el viaje abierto de la unidad (su fecha AAAA-MM-DD y su REQUE). Sin esto el operador del
   * sistema NO se usa: una unidad hace un servicio distinto cada día y el aviso del servicio B no puede nombrar al operador
   * del servicio A. El implementador del conector debe llenarlo con los datos del despacho/viaje que ya trae.
   */
  servicio?: { fecha: string | null; reque: string | null };
}

export interface DatoViajeManual {
  tenantId: string;
  filaId: string;
  operadorId: string | null;
  operadorNombre: string | null;
  licencia: string | null;
  licenciaVence: string | null;
  telefono: string | null;
  placasUnidad: string | null;
  placasCaja: string | null;
  estadoCaja: string | null;
}

export type FilaParaResolver =
  Pick<FilaPrograma, 'cliente' | 'consignatario' | 'caja' | 'unidad'> & Partial<Pick<FilaPrograma, 'fecha' | 'reque'>> & {
    /** Id de la fila persistida (`programa_despacho_fila`), para buscar lo capturado a mano. */
    filaId?: string | null;
  };

/** Accesos a datos de UNA flota. Cada función debe consultar solo esa flota; el resolver además descarta lo que no lo sea. */
export interface DepsResolver {
  tenantId: string;
  /** Quién recibe el aviso: el pagador (`cliente`, por defecto) o el consignatario (B3 sin responder: configurable). */
  campoCliente?: CampoAlias;
  aliasDe(textoNormalizado: string, campo: CampoAlias): Promise<AliasCliente[]>;
  contactosDeCliente(clienteId: string): Promise<Contacto[]>;
  unidadesPorNumero(numero: string): Promise<UnidadCatalogo[]>;
  cajaPorNumero(numero: string): Promise<CajaDelCatalogo | null>;
  /** Operador del viaje abierto de esa unidad, si el conector del TMS ya lo trajo. */
  operadorDeUnidad(unidadId: string): Promise<OperadorDato | null>;
  datoManual(filaId: string): Promise<DatoViajeManual | null>;
  /** Operador del catálogo, para completar una captura manual que solo trae su id. */
  operadorPorId?(operadorId: string): Promise<OperadorDato | null>;
}

export interface ContactoResuelto {
  id: string;
  telefono: string;
  nombre: string | null;
}

export interface UnidadResuelta {
  id: string;
  numero: string;
  placas: string | null;
  fuentePlacas: FuenteDato | null;
}

export interface CajaResuelta {
  numero: string;
  placas: string | null;
  estado: string | null;
  fuentePlacas: FuenteDato | null;
  fuenteEstado: FuenteDato | null;
}

export interface OperadorResuelto {
  nombre: string | null;
  licencia: string | null;
  vence: string | null;
  telefono: string | null;
  fuente: FuenteDato;
}

export interface FilaResuelta {
  clienteId: string | null;
  estadoCliente: EstadoClienteResuelto;
  contacto: ContactoResuelto | null;
  unidad: UnidadResuelta | null;
  caja: CajaResuelta | null;
  operador: OperadorResuelto | null;
  faltantes: FaltanteResolucion[];
}

function limpio(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

const mayus = (v: string) => v.trim().toUpperCase();

function elegirContacto(contactos: readonly Contacto[], tenantId: string, clienteId: string): ContactoResuelto | null {
  const elegibles = contactos
    .filter((c) => c.tenantId === tenantId && c.clienteId === clienteId && c.estado === 'activo' && !c.optoutEn)
    .sort((a, b) => {
      const ca = a.consentimientoEn ? 0 : 1;
      const cb = b.consentimientoEn ? 0 : 1;
      return ca - cb || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
  const c = elegibles[0];
  return c ? { id: c.id, telefono: c.telefono, nombre: c.nombre } : null;
}

/** ¿El viaje abierto de la unidad es el servicio de ESTA fila? REQUE si ambos lo traen; si no, la fecha; sin ninguno de los dos, NO. */
function mismoServicio(s: OperadorDato, fila: FilaParaResolver): boolean {
  const sv = s.servicio;
  if (!sv) return false;
  const rq = (v: string | null | undefined) => limpio(v)?.toUpperCase() ?? null;
  const rs = rq(sv.reque); const rf = rq(fila.reque);
  if (rs !== null && rf !== null) return rs === rf;
  const fs = limpio(sv.fecha); const ff = limpio(fila.fecha);
  return fs !== null && ff !== null && fs === ff;
}

async function resolverOperador(
  unidadId: string | null, fila: FilaParaResolver, manual: DatoViajeManual | null, deps: DepsResolver,
): Promise<OperadorResuelto | null> {
  // 1. Lo capturado a mano para ESTA fila manda: es lo que una persona dijo de este servicio.
  if (manual) {
    let cat: OperadorDato | null = null;
    if (manual.operadorId && deps.operadorPorId) {
      const o = await deps.operadorPorId(manual.operadorId);
      if (o && o.tenantId === deps.tenantId) cat = o;
    }
    const nombre = limpio(manual.operadorNombre) ?? limpio(cat?.nombre);
    const licencia = limpio(manual.licencia) ?? limpio(cat?.licencia);
    const vence = manual.licenciaVence ?? cat?.licenciaVence ?? null;
    const telefono = limpio(manual.telefono) ?? limpio(cat?.telefono);
    if (nombre || licencia || telefono) {
      const usoManual = !!(limpio(manual.operadorNombre) || limpio(manual.licencia) || manual.licenciaVence || limpio(manual.telefono));
      return { nombre, licencia, vence, telefono, fuente: usoManual ? 'manual' : 'catalogo' };
    }
  }
  // 2. El del viaje abierto de la unidad, SOLO si es el servicio de esta fila.
  if (unidadId) {
    const s = await deps.operadorDeUnidad(unidadId);
    if (s && s.tenantId === deps.tenantId && mismoServicio(s, fila) && (limpio(s.nombre) || limpio(s.telefono) || limpio(s.licencia))) {
      return { nombre: limpio(s.nombre), licencia: limpio(s.licencia), vence: s.licenciaVence, telefono: limpio(s.telefono), fuente: 'sistema' };
    }
  }
  return null;
}

export async function resolverFila(fila: FilaParaResolver, deps: DepsResolver): Promise<FilaResuelta> {
  const faltantes: FaltanteResolucion[] = [];
  const campo: CampoAlias = deps.campoCliente ?? 'cliente';

  // Cliente: solo por la tabla de alias de esta flota.
  const texto = campo === 'consignatario' ? fila.consignatario : fila.cliente;
  const clave = normalizarAlias(texto);
  let clienteId: string | null = null;
  let estadoCliente: EstadoClienteResuelto = 'sin_cliente';
  if (clave !== '') {
    const r = resolverAlias(texto, campo, deps.tenantId, await deps.aliasDe(clave, campo));
    if (r.tipo === 'uno') { clienteId = r.clienteId; estadoCliente = 'resuelto'; }
    else if (r.tipo === 'ambiguo') estadoCliente = 'ambiguo';
  }
  if (estadoCliente === 'sin_cliente') faltantes.push('sin_cliente');
  if (estadoCliente === 'ambiguo') faltantes.push('cliente_ambiguo');

  let contacto: ContactoResuelto | null = null;
  if (clienteId) {
    contacto = elegirContacto(await deps.contactosDeCliente(clienteId), deps.tenantId, clienteId);
    if (!contacto) faltantes.push('sin_contacto');
  }

  const manual = limpio(fila.filaId) ? await deps.datoManual(fila.filaId as string) : null;
  const datoManual = manual && manual.tenantId === deps.tenantId && manual.filaId === fila.filaId ? manual : null;

  // Unidad: número económico exacto dentro del catálogo de esta flota.
  let unidad: UnidadResuelta | null = null;
  const numUnidad = limpio(fila.unidad);
  if (!numUnidad) faltantes.push('sin_unidad');
  else {
    const candidatas = (await deps.unidadesPorNumero(numUnidad))
      .filter((u) => u.tenantId === deps.tenantId && mayus(u.numero) === mayus(numUnidad));
    if (candidatas.length === 0) faltantes.push('unidad_no_registrada');
    else if (candidatas.length > 1) faltantes.push('unidad_ambigua');
    else {
      const u = candidatas[0];
      const placasManual = limpio(datoManual?.placasUnidad);
      const placasSistema = limpio(u.placas);
      unidad = {
        id: u.id, numero: u.numero, placas: placasManual ?? placasSistema,
        fuentePlacas: placasManual ? 'manual' : placasSistema ? 'sistema' : null,
      };
    }
  }

  // Caja: el número es el de la fila; placas y estado, de lo capturado a mano o del catálogo.
  let caja: CajaResuelta | null = null;
  const numCaja = limpio(fila.caja);
  if (!numCaja) faltantes.push('sin_caja');
  else {
    const c = await deps.cajaPorNumero(numCaja);
    const cat = c && c.tenantId === deps.tenantId && mayus(c.numero) === mayus(numCaja) ? c : null;
    const placasManual = limpio(datoManual?.placasCaja);
    const estadoManual = limpio(datoManual?.estadoCaja);
    const placasCat = limpio(cat?.placas);
    const estadoCat = limpio(cat?.estado);
    caja = {
      numero: numCaja,
      placas: placasManual ?? placasCat,
      estado: estadoManual ?? estadoCat,
      fuentePlacas: placasManual ? 'manual' : placasCat ? 'catalogo' : null,
      fuenteEstado: estadoManual ? 'manual' : estadoCat ? 'catalogo' : null,
    };
  }

  const operador = await resolverOperador(unidad?.id ?? null, fila, datoManual, deps);
  if (!operador) faltantes.push('sin_operador');

  return { clienteId, estadoCliente, contacto, unidad, caja, operador, faltantes };
}
