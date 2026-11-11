'use server';

import { revalidatePath } from 'next/cache';
import { resolverTenantAtadoFirmado, CAMPO_FLOTA_PINTADA, MENSAJE_FLOTA_CAMBIO } from '@/lib/auth/tenant-atado';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { rateLimit } from '@/lib/ratelimit';
import { logger } from '@/lib/logger';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { mensajeParaPantalla } from '@/lib/likida/errores';
import { puertoSupabase } from '@/lib/likida/carta_porte_docs/catalogo_puerto';
import {
  TIPOS_PLANTILLA, TOPE_BYTES_IMPORTACION, importarCatalogo,
  type ResultadoImportacion, type TipoPlantilla,
} from '@/lib/likida/carta_porte_docs/catalogo_import';
import { COLUMNAS_CLAVE, columnasDeFila, validarRegistro } from '@/lib/likida/carta_porte_docs/catalogo_pantalla';
import type { ResultadoAccion } from '@/app/dashboard/carta-porte/documentos/forma_accion';
import { getT } from '@/lib/i18n/servidor';

// ═══════════════════════════════════════════════════════════════════════════
// IMPORTAR EL CATÁLOGO DEL CLIENTE POR CSV (T-A3-21).
//
// Server action A NIVEL DE MÓDULO (no cierra sobre nada del componente). Vuelve a resolver sesión, rol y flota
// desde la cookie: JAMÁS acepta un tenant_id del formulario; los campos `tenant`/`vista`/`rol` que viajan son el
// mismo «ver como» firmado que ya trae la URL del superadmin, y `resolverTenantAtadoFirmado` ata la flota firmada.
// La ruta que gatea es la del agente (clasificada en el perfil cinco_agentes); la pantalla del catálogo (T-A3-22)
// hereda esta acción.
// ═══════════════════════════════════════════════════════════════════════════

const RUTA = '/dashboard/agentes/carta-porte';
const RUTA_CATALOGO = '/dashboard/agentes/carta-porte/catalogo';

export type EstadoImportacion = (ResultadoImportacion & { tipo: TipoPlantilla }) | { ok: false; error: string } | null;

const esTipo = (v: string): v is TipoPlantilla => (TIPOS_PLANTILLA as readonly string[]).includes(v);

/**
 * Un solo envío atiende los dos botones: `intencion=previsualizar` (no escribe) o `intencion=confirmar` (escribe,
 * solo si ninguna fila trae error). Campos: `tipo` (producto | parte | cliente_numero) y `archivo` (el CSV).
 */
export async function importarCatalogoCsv(_previo: EstadoImportacion, fd: FormData): Promise<EstadoImportacion> {
  const { t: tx } = await getT('agentes');
  // MX-002: la flota que se pintó es la que escribe (la pantalla firma la flota en un campo oculto; la cookie del selector
  // es compartida entre pestañas). Sin firma válida —o con otra flota— no se escribe nada.
  const s = await resolverTenantAtadoFirmado(RUTA, fd.get(CAMPO_FLOTA_PINTADA));
  if (!s) return { ok: false, error: MENSAJE_FLOTA_CAMBIO };
  if (!puedeVerRuta(s.rol, RUTA)) return { ok: false, error: tx('rest.tu_rol_no_puede_administrar_el') };
  try {
    const tipo = String(fd.get('tipo') ?? '');
    if (!esTipo(tipo)) return { ok: false, error: tx('rest.elige_que_vas_a_importar_productos') };
    const archivo = fd.get('archivo');
    if (!(archivo instanceof File) || archivo.size === 0) return { ok: false, error: 'Elige un archivo CSV.' };
    if (archivo.size > TOPE_BYTES_IMPORTACION) return { ok: false, error: tx('rest.el_archivo_pesa_mas_de_mb', { v: TOPE_BYTES_IMPORTACION / 1024 / 1024 }) };
    const confirmar = String(fd.get('intencion') ?? '') === 'confirmar';
    if (!(await rateLimit(`cp-catalogo-import:${s.tenantId}`, confirmar ? 10 : 20, 60_000))) {
      return { ok: false, error: tx('rest.demasiadas_importaciones_en_poco_tiempo_espera') };
    }
    const r = await importarCatalogo(
      { tenantId: s.tenantId, actorId: s.userId, tipo, bytes: new Uint8Array(await archivo.arrayBuffer()), confirmar },
      puertoSupabase(),
    );
    if (r.aplicado) {
      // Solo conteos: la bitácora sobrevive a un borrado ARCO y no lleva datos de terceros.
      await anotarBitacora(
        { tenantId: s.tenantId, actor: { id: s.userId }, accion: 'ccp.catalogo_importado', entidad: 'tenant', entidadId: s.tenantId, detalle: { tipo, nuevas: r.nuevas, cambian: r.cambian } },
        { evento: 'carta_porte_docs.bitacora_no_escribio' },
      );
      revalidatePath(`${RUTA}/catalogo`);
    }
    return { ...r, tipo };
  } catch (e) {
    logger.error('carta_porte_docs.catalogo_import', { error: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: e instanceof Error && /migración 0792/.test(e.message) ? e.message : mensajeParaPantalla(e, tx('rest.importar_el_catalogo')) };
  }
}

/**
 * Edición en línea de UNA fila del catálogo (T-A3-22): `modo=editar` cambia una fila que ya existe (la clave natural —SKU,
 * rol y nombre corto— no se toca: cambiarla sería crear otra) y `modo=nuevo` agrega una. Campos: `tipo`, `cliente_id`,
 * `modo` y un `c_<columna>` por cada columna de la plantilla. Las reglas son las de la importación por CSV
 * (`validarRegistro`), y el cliente tiene que ser de la flota de la sesión. Deja bitácora con solo el tipo y el modo.
 */
export async function guardarFilaCatalogo(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
  const { t: tx } = await getT('agentes');
  // MX-002: la flota que se pintó es la que escribe (la pantalla firma la flota en un campo oculto; la cookie del selector
  // es compartida entre pestañas). Sin firma válida —o con otra flota— no se escribe nada.
  const s = await resolverTenantAtadoFirmado(RUTA_CATALOGO, fd.get(CAMPO_FLOTA_PINTADA));
  if (!s) return { ok: false, error: MENSAJE_FLOTA_CAMBIO };
  if (!puedeVerRuta(s.rol, RUTA_CATALOGO)) return { ok: false, error: tx('rest.tu_rol_no_puede_administrar_el') };
  try {
    const tipo = String(fd.get('tipo') ?? '');
    if (!esTipo(tipo)) return { ok: false, error: tx('rest.no_reconozco_que_parte_del_catalogo') };
    const modo = String(fd.get('modo') ?? '') === 'nuevo' ? 'nuevo' : 'editar';
    const clienteId = String(fd.get('cliente_id') ?? '');
    if (!(await rateLimit(`cp-catalogo-fila:${s.tenantId}`, 60, 60_000))) return { ok: false, error: tx('rest.demasiados_cambios_en_poco_tiempo_espera') };
    const puerto = puertoSupabase();
    // El cliente tiene que ser de ESTA flota: la lectura ya viene acotada al tenant de la sesión.
    if (!(await puerto.clientes(s.tenantId)).some((c) => c.id === clienteId)) return { ok: false, error: tx('rest.ese_cliente_no_es_de_tu') };

    const valores: Record<string, string> = {};
    for (const c of columnasDeFila(tipo)) valores[c] = String(fd.get(`c_${c}`) ?? '');
    const v = validarRegistro(tipo, clienteId, valores);
    if (!v.ok) return { ok: false, error: v.mensaje };
    // Editar una fila que no existe sería crearla a escondidas: se comprueba por la clave natural.
    // Agregar una clave que YA existe sería un upsert que pisa la fila en silencio (A37-S12-03).
    const existentes = await puerto.existentes(s.tenantId, tipo, [clienteId]);
    const llave = (r: Record<string, unknown>): string => COLUMNAS_CLAVE[tipo].map((c) => String(r[c] ?? '')).join('|');
    const yaExiste = existentes.some((e) => llave(e) === llave(v.registro));
    if (modo === 'editar' && !yaExiste) return { ok: false, error: tx('rest.esa_fila_ya_no_existe_recarga') };
    if (modo === 'nuevo' && yaExiste) return { ok: false, error: tx('rest.esa_fila_ya_existe_en_el') };
    await puerto.aplicarLote(s.tenantId, tipo, [v.registro], s.userId);
    await anotarBitacora(
      { tenantId: s.tenantId, actor: { id: s.userId }, accion: 'ccp.catalogo_editado', entidad: 'tenant', entidadId: s.tenantId, detalle: { tipo, modo } },
      { evento: 'carta_porte_docs.bitacora_no_escribio' },
    );
    revalidatePath(RUTA_CATALOGO);
    return { ok: true, mensaje: modo === 'nuevo' ? tx('rest.agregado_al_catalogo') : tx('rest.cambios_guardados_en_el_catalogo') };
  } catch (e) {
    logger.error('carta_porte_docs.catalogo_fila', { error: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: e instanceof Error && /migración 0792/.test(e.message) ? e.message : mensajeParaPantalla(e, tx('rest.guardar_en_el_catalogo')) };
  }
}
