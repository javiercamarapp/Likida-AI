// ═══════════════════════════════════════════════════════════════════════════
// LO QUE HASTA HOY SE HACÍA CON SQL A MANO.
//
// Cuatro operaciones sostenían el alta de cualquier cliente nuevo y ninguna
// tenía pantalla: dar de alta una flota, registrar el teléfono de un operador,
// editar la política de gastos y reabrir un viaje liquidado. Mientras vivieran
// en un editor de SQL, Javier era el cuello de botella del segundo cliente —
// y cada alta era una oportunidad de teclear el tenant equivocado.
//
// TODAS ESCRIBEN EN LA BITÁCORA (0053). Son las operaciones que cambian a quién
// pertenece qué y cuánto se le permite gastar; sin rastro, un cambio de tope no
// se distingue de un error del motor tres semanas después.
//
// ESTE MÓDULO NO DECIDE PERMISOS. Los server actions que lo llaman repiten el
// chequeo de rol adentro (patrón de `dashboard/despacho/page.tsx`), porque el
// gateo de la UI solo decide si se pinta el formulario.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { anotarBitacora, type EntidadBitacora } from '@/lib/likida/bitacora_escritura';
import { esRfcValido, rfcChecksumOk, esUuidValido } from './intake/cfdi';
import { validarDatosFiscales } from '@/lib/saas/fiscal';
import { variantesTelefono, acquireViajeLock, releaseViajeLock } from './conv';
import { destinatarioWhatsApp } from '@/lib/meta/client';
import { getConfig } from './config';
import type { PoliticaGasto } from './cuadre/engine';
import { logger } from '@/lib/logger';
import { DatoInvalido } from './errores';
import type { AjustesValidos } from './ajustes_operativos';
import { acotada } from './presupuesto';

// `DatoInvalido` y `mensajeParaPantalla` viven en `errores.ts` desde que
// `saas/suscripcion.ts` los necesitó: importarlos de aquí metía todo este módulo
// —motor de cuadre, CFDI, cliente de Meta— en el bundle del webhook de Stripe.
// Se re-exportan para no mover los imports de las pantallas que ya los usan.
export { DatoInvalido, mensajeParaPantalla } from './errores';

/**
 * Deja constancia. Best-effort A PROPÓSITO: si la bitácora falla, el alta ya
 * ocurrió y tirarla dejaría el sistema peor —una flota a medio crear— que sin
 * el registro. El fallo se loguea para que no se pierda en silencio.
 */
/**
 * Mezcla un parcial sobre `tenant.config` en UN solo UPDATE (RPC
 * `tenant_config_merge`, 0159).
 *
 * La mezcla es PROFUNDA, igual que `fusionarConfig` (config.ts): los objetos se
 * recorren y los arrays reemplazan. Y el CHECK `tenant_config_valida` sigue
 * corriendo en ese UPDATE, así que una llave que `CuadraConfig` no conozca
 * rebota aquí en vez de guardarse para que nadie la lea.
 */
async function mezclarConfig(
  tenantId: string,
  parcial: Record<string, unknown>,
  etiqueta: string,
  borrar: string[] = [],
): Promise<{ error: Error | null }> {
  const { error } = await acotada(
    supabaseAdmin().rpc('tenant_config_merge', {
      p_tenant: tenantId,
      p_parcial: parcial,
      p_borrar: borrar,
    }),
    etiqueta,
  );
  if (!error) return { error: null };
  // CU013: la flota no existe. Es dato de entrada, no una caída.
  if ((error as { code?: string }).code === 'CU013') {
    return { error: new DatoInvalido('No se encontró tu flota. Recarga la pantalla.') };
  }
  return { error: new Error(`${etiqueta}: ${error.message}`) };
}

async function anotar(
  tenantId: string | null,
  accion: string,
  entidad: EntidadBitacora,
  entidadId: string,
  detalle?: Record<string, unknown>,
  actor?: { id?: string; email?: string },
): Promise<void> {
  await anotarBitacora({ tenantId, actor: actor ?? {}, accion, entidad, entidadId, detalle: detalle ?? null });
}

// ── 1. Dar de alta una flota ───────────────────────────────────────────────

export interface NuevaFlota {
  nombre: string;
  rfc?: string;
  ciudad?: string;
  /** Correo del primer administrador. Sin él la flota nace sin quién entre. */
  emailAdmin?: string;
  nombreAdmin?: string;
  /** WhatsApp del administrador (D5, auditoría 4): sin él, el dueño de una
   *  flota nueva no puede escribirle al bot — el matcher de oficina
   *  (`resolverCuentaOficina`) no lo reconoce. Opcional; se normaliza en
   *  `provisionarUsuario`. */
  telefonoAdmin?: string;
  /** RFA 2026 regla 2.9 (se piden AL REGISTRAR): ¿dedicación exclusiva al
   *  autotransporte terrestre de carga federal? Sin esta declaración el motor
   *  no puede abrir la facilidad del 15% de diésel en efectivo. */
  dedicacionExclusivaCarga?: boolean;
  /** RFA 2026 regla 2.9: ¿tributa en Título II Cap. VII (coordinados) o Título
   *  IV Cap. II Secc. I (PF con actividad empresarial)? — se captura como el
   *  código SAT real (c_RegimenFiscal) en `tenant.regimen_fiscal`, y la
   *  elegibilidad se DERIVA de él (los códigos 601/612 son los que califican). */
  regimenFiscal?: string;
  /** Razón social TAL CUAL la Constancia de Situación Fiscal. Junto con el RFC,
   *  el régimen, el CP fiscal y el uso, forma los CINCO datos que el CFDI 4.0
   *  exige del receptor — y sin los cinco, `getFiscalDeFlota` se niega a
   *  registrar la flota y NADA de esa flota se factura. */
  razonSocial?: string;
  /** CP del domicilio fiscal registrado ante el SAT. No es el de la calle donde
   *  está el patio: el PAC lo compara contra el que el SAT tiene para ese RFC. */
  codigoPostalFiscal?: string;
  /** Clave `c_UsoCFDI`. G03 (gastos en general) es lo normal para una flota. */
  usoCfdi?: string;
}

/**
 * Crea el tenant y, si se dio correo, su primer `flota_admin`.
 *
 * EL RFC SE RECHAZA AQUÍ SI ESTÁ MAL, y es la única oportunidad barata de
 * hacerlo. `getConfig()` ya detecta un RFC con dígito verificador inválido,
 * pero para entonces solo puede escribir un `logger.error` y seguir con la
 * validación de receptor APAGADA: la flota cree que el sistema comprueba a
 * nombre de quién vienen sus facturas, y no. Un dato mal tecleado el día del
 * alta se arregla en dos segundos; descubierto tres meses después, ya contaminó
 * todas las liquidaciones.
 */
export async function crearFlota(
  f: NuevaFlota,
  actor?: { id?: string; email?: string },
): Promise<{ tenantId: string; userId?: string }> {
  const nombre = f.nombre.trim();
  if (nombre.length < 3) throw new DatoInvalido('El nombre de la flota necesita al menos 3 caracteres.');

  let rfc: string | undefined;
  if (f.rfc?.trim()) {
    rfc = f.rfc.toUpperCase().replace(/[^A-ZÑ&0-9]/g, '');
    if (!esRfcValido(rfc) || !rfcChecksumOk(rfc)) {
      throw new DatoInvalido(
        `El RFC "${f.rfc}" no pasa el dígito verificador. Revísalo: con un RFC inválido, ` +
        `la validación de facturas a nombre de la flota queda apagada y ninguna se rechaza por estar a nombre de otro.`,
      );
    }
  }

  // ── LOS CINCO DEL RECEPTOR, O NINGUNO ──────────────────────────────────────
  //
  // Se validan ANTES del insert y con el MISMO validador que la pantalla de
  // datos fiscales, para que no existan dos criterios de qué es un CP bueno.
  //
  // Por qué esto entró al alta (20-ago-2026): `getFiscalDeFlota` exige los cinco
  // —RFC, razón social, régimen, CP fiscal y uso— y sin ellos devuelve `falta` y
  // la flota NO se registra para facturar. El alta solo pedía tres, así que toda
  // flota nueva nacía sin poder facturar y nada lo decía: el hueco aparecía
  // semanas después, como un cron que no hacía nada, sin un error que mirar.
  //
  // OPCIONALES A PROPÓSITO. Una flota se puede dar de alta para operar viajes y
  // capturar lo fiscal más tarde en `/dashboard/suscripcion`. Lo que ya no pasa
  // es que se capture a MEDIAS y parezca completo: o van los cinco, o va solo el
  // RFC suelto como hasta hoy.
  const fiscalCompleto = Boolean(
    f.rfc?.trim() && f.razonSocial?.trim() && f.regimenFiscal?.trim()
    && f.codigoPostalFiscal?.trim() && f.usoCfdi?.trim(),
  );
  const filaFiscal = fiscalCompleto
    ? validarDatosFiscales({
        rfc: f.rfc!, razonSocial: f.razonSocial!, regimenFiscal: f.regimenFiscal!,
        codigoPostal: f.codigoPostalFiscal!, usoCfdi: f.usoCfdi!,
      })
    : null;

  const admin = supabaseAdmin();
  // RFA 2026 regla 2.9: el régimen se captura como el código SAT REAL
  // (tenant.regimen_fiscal — la columna que la facturación ya lee) y la
  // elegibilidad se DERIVA de él. El booleano `dedicacionExclusivaCarga` se
  // guarda en la config (el otro requisito, que el alta ya pregunta).
  //
  // FISC-C2-1 (auditoría 18-c2, CRÍTICO): aquí decía `['601', '612']` con el
  // comentario «601 (General de Ley PM — coordinados)», y son dos cosas
  // distintas del catálogo `c_RegimenFiscal`. La regla admite «Título II,
  // Capítulo VII o Título IV, Capítulo II, Sección I» (ficha
  // `normas/rfa-2026-2.9.yaml`, verificada contra fuente primaria):
  //   · Título II Cap. VII = COORDINADOS (LISR 72-73)  → clave **624**
  //   · Título II a secas  = la S.A. de C.V. ordinaria → clave 601, que NO
  //     entra: para ella sigue aplicando la LISR 27-III sin excepción.
  //   · Título IV Cap. II Secc. I = PF con act. empresarial → clave 612. ✔
  // Se falla cerrado a propósito: conceder de más imprime en el PDF, citando el
  // artículo, una deducción que la norma niega.
  //
  // 624 entra en `REGIMENES` y en el CHECK (mig. 0170). Un coordinado ya puede
  // declararse; la facilidad del 15% deja de ser solo para PF 612.
  const REGIMENES_ELEGIBLES = ['624', '612'];
  const regimenElegible = f.regimenFiscal ? REGIMENES_ELEGIBLES.includes(f.regimenFiscal) : undefined;
  const facilidad15 = (typeof f.dedicacionExclusivaCarga === 'boolean' && regimenElegible !== undefined)
    ? {
        facilidadCombustibleEfectivo: {
          dedicacionExclusivaCarga: f.dedicacionExclusivaCarga,
          regimenElegible,
        },
      }
    : undefined;
  const { data, error } = await admin
    .from('tenant')
    .insert({
      nombre, rfc: rfc ?? null, ciudad: f.ciudad?.trim() || null,
      regimen_fiscal: f.regimenFiscal ?? null,
      ...(facilidad15 ? { config: facilidad15 } : {}),
      // Va al final para que gane: `filaFiscal` trae el RFC y el régimen ya
      // normalizados por el mismo validador que usa la pantalla fiscal.
      ...(filaFiscal ?? {}),
    })
    .select('id')
    .maybeSingle();

  if (error) {
    // El nombre no es único por constraint, pero un duplicado exacto casi
    // siempre es un doble clic, no dos flotas que se llaman igual.
    throw new Error(`crearFlota: ${error.message}`);
  }
  const tenantId = data?.id as string | undefined;
  if (!tenantId) throw new Error('crearFlota: el insert no devolvió id');

  await anotar(tenantId, 'flota.creada', 'tenant', tenantId, { nombre, rfc: rfc ?? null }, actor);

  let userId: string | undefined;
  if (f.emailAdmin?.trim()) {
    const { provisionarUsuario } = await import('@/lib/auth/provisionar');
    const r = await provisionarUsuario(tenantId, f.emailAdmin.trim().toLowerCase(), f.nombreAdmin, 'flota_admin', f.telefonoAdmin);
    userId = r.userId;
    await anotar(tenantId, 'usuario.provisionado', 'app_user', userId, { rol: 'flota_admin' }, actor);
  }

  return { tenantId, userId };
}

// ── 2. Registrar un operador ───────────────────────────────────────────────

export interface NuevoOperador {
  nombre: string;
  telefono: string;
  numeroEmpleado?: string;
  licencia?: string;
  licenciaTipo?: string;
  /** ISO `AAAA-MM-DD`. */
  licenciaVence?: string;
}

/**
 * Registra un operador y su teléfono de WhatsApp.
 *
 * EL TELÉFONO SE COMPRUEBA CONTRA TODAS LAS FLOTAS, no solo contra ésta, y eso
 * no es exceso de celo: `resolveOperador()` busca por teléfono SIN filtrar por
 * tenant. Si dos flotas registran el mismo número, la resolución devuelve una
 * fila arbitraria y con ella se decide el `tenant_id` con el que se escriben el
 * gasto y la liquidación — dinero de una flota anotado en la de otra, y en
 * silencio. El propio `conv.ts` lo advierte; aquí es donde se puede impedir.
 *
 * Se guarda en la forma que Meta usa para ENVIAR (`52` + 10 dígitos, sin el 1),
 * que es la que `destinatarioWhatsApp` produce. La lectura sigue aceptando
 * todas las variantes.
 */
export async function crearOperador(
  tenantId: string,
  o: NuevoOperador,
  actor?: { id?: string; email?: string },
): Promise<string> {
  const nombre = o.nombre.trim();
  if (nombre.length < 3) throw new DatoInvalido('El nombre del operador necesita al menos 3 caracteres.');

  const soloDigitos = o.telefono.replace(/[^\d]/g, '');
  if (soloDigitos.length < 10) {
    throw new DatoInvalido(`El teléfono "${o.telefono}" tiene ${soloDigitos.length} dígitos; un número mexicano necesita 10 más la lada 52.`);
  }
  // 10 dígitos sueltos = número nacional sin lada: se le antepone 52. Con más,
  // se respeta lo tecleado y solo se quita el "1" que Meta ya no usa al enviar.
  const telefono = destinatarioWhatsApp(soloDigitos.length === 10 ? `52${soloDigitos}` : soloDigitos);

  const admin = supabaseAdmin();
  const { data: choque, error: errBusca } = await admin
    .from('operador')
    .select('id, tenant_id, nombre, activo')
    .in('telefono', variantesTelefono(telefono))
    .limit(2);

  // Fallar cerrado: sin poder comprobar el duplicado NO se da de alta. Seguir
  // sería justo el caso que esta comprobación existe para impedir.
  if (errBusca) throw new Error(`crearOperador: no se pudo comprobar el teléfono — ${errBusca.message}`);

  if (choque && choque.length > 0) {
    const c = choque[0] as { tenant_id: string; nombre: string };
    throw new DatoInvalido(
      c.tenant_id === tenantId
        ? `Ese teléfono ya está registrado en esta flota, a nombre de ${c.nombre}.`
        : `Ese teléfono ya está registrado en OTRA flota. Dos operadores con el mismo número harían que sus comprobantes se anoten en la flota equivocada.`,
    );
  }

  const { data, error } = await admin
    .from('operador')
    .insert({
      tenant_id: tenantId,
      nombre,
      telefono,
      numero_empleado: o.numeroEmpleado?.trim() || null,
      licencia: o.licencia?.trim() || null,
      licencia_tipo: o.licenciaTipo?.trim() || null,
      licencia_vence: o.licenciaVence || null,
    })
    .select('id')
    .maybeSingle();

  if (error) throw new Error(`crearOperador: ${error.message}`);
  const id = data?.id as string | undefined;
  if (!id) throw new Error('crearOperador: el insert no devolvió id');

  await anotar(tenantId, 'operador.creado', 'operador', id, { nombre, telefono }, actor);
  return id;
}

/** Lo que la pantalla deja editar de un operador ya dado de alta. `undefined`
 *  en cualquier llave = "no se tocó" (no se manda al `update`); `null` o `''`
 *  en las que lo aceptan = "bórralo". El teléfono NO vive aquí: cambiarlo
 *  reabriría la comprobación de duplicado entre flotas que `crearOperador`
 *  hace al dar de alta, y esta pantalla (auditoría 2, A2) solo necesitaba
 *  arreglar la licencia y el RFC — ampliarla a teléfono es otro cambio. */
export interface CambiosOperador {
  nombre?: string;
  numeroEmpleado?: string | null;
  licencia?: string | null;
  licenciaTipo?: string | null;
  /** ISO `AAAA-MM-DD`, o `null`/`''` para borrarla. */
  licenciaVence?: string | null;
  /** RFC del trabajador (migración 0080, RLISR 57). */
  rfc?: string | null;
}

/**
 * Corrige los datos de un operador ya existente — la puerta que faltaba
 * (auditoría 2): un chofer con la licencia mal tecleada o sin RFC se quedaba
 * así para siempre, porque `operadores/vista.tsx` solo listaba.
 *
 * ANCLADO A `tenant_id` EN EL WHERE Y COMPROBADO CON `.select('id')` DESPUÉS,
 * igual que `editarCliente` (clientes.ts): con el id de un operador de OTRA
 * flota, un `.update().eq('id', ...)` sin el `.eq('tenant_id', ...)` lo
 * editaría igual — y CON el tenant en el where pero SIN mirar cuántas filas
 * tocó, Postgres no marca error: el update de cero filas y el de una se ven
 * idénticos, y la pantalla diría "guardado" sobre un cambio que nunca ocurrió.
 * Es el mismo `fallar cerrado y decirlo` que ya cuesta este archivo entero.
 */
export async function actualizarOperador(
  tenantId: string,
  operadorId: string,
  cambios: CambiosOperador,
  actor?: { id?: string; email?: string },
): Promise<void> {
  if (!esUuidValido(operadorId)) {
    throw new DatoInvalido('No se reconoce ese operador. Vuelve a abrir la pantalla.');
  }

  const fila: Record<string, unknown> = {};

  if (cambios.nombre !== undefined) {
    const nombre = cambios.nombre.trim();
    if (nombre.length < 3) throw new DatoInvalido('El nombre del operador necesita al menos 3 caracteres.');
    fila.nombre = nombre;
  }

  if (cambios.numeroEmpleado !== undefined) {
    fila.numero_empleado = cambios.numeroEmpleado?.trim() || null;
  }

  if (cambios.licencia !== undefined) {
    fila.licencia = cambios.licencia?.trim() || null;
  }

  if (cambios.licenciaTipo !== undefined) {
    fila.licencia_tipo = cambios.licenciaTipo?.trim() || null;
  }

  if (cambios.licenciaVence !== undefined) {
    const v = cambios.licenciaVence?.trim();
    if (!v) {
      fila.licencia_vence = null;
    } else {
      // Mismo criterio que `operador.licencia_vence` (0053): una fecha que no
      // se pueda interpretar tal cual se guardaría vencida o vigente sin
      // serlo — ninguna de las dos es honesta si lo tecleado no es una fecha.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
        throw new DatoInvalido(`"${cambios.licenciaVence}" no es una fecha válida (AAAA-MM-DD).`);
      }
      fila.licencia_vence = v;
    }
  }

  if (cambios.rfc !== undefined) {
    const crudo = cambios.rfc?.trim();
    if (!crudo) {
      fila.rfc = null;
    } else {
      // Mismo candado que `crearFlota`: un RFC con el dígito verificador mal
      // no truena aquí, pero sí más adelante en `engine.ts` (RLISR 57) — mejor
      // rechazarlo en la captura, que es la oportunidad barata de corregirlo.
      const rfc = crudo.toUpperCase().replace(/[^A-ZÑ&0-9]/g, '');
      if (!esRfcValido(rfc) || !rfcChecksumOk(rfc)) {
        throw new DatoInvalido(
          `El RFC "${cambios.rfc}" no pasa el dígito verificador. Revísalo antes de guardar.`,
        );
      }
      fila.rfc = rfc;
    }
  }

  if (Object.keys(fila).length === 0) {
    throw new DatoInvalido('No hay ningún cambio que guardar.');
  }

  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from('operador')
    .update(fila)
    .eq('id', operadorId)
    .eq('tenant_id', tenantId) // el tenant SIEMPRE en el where: ver comentario de arriba
    .select('id');

  if (error) throw new Error(`actualizarOperador: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) {
    throw new DatoInvalido('No se encontró ese operador en tu flota. Puede que alguien lo haya borrado — recarga la pantalla.');
  }

  await anotar(tenantId, 'operador.editado', 'operador', operadorId, fila, actor);
}

// ── 3. Editar la política de gastos ────────────────────────────────────────

/**
 * Guarda la política de la flota en `tenant.config.politica`.
 *
 * LEE-MODIFICA-ESCRIBE sobre `config`, nunca `update({config: {politica}})`.
 * `config` es un jsonb con MÁS cosas dentro (estímulos, hidrocarburos,
 * validación); escribir el objeto entero con solo la política se lleva por
 * delante los topes fiscales, y el motor los lee con `if (x != null)` — así que
 * no truena: se SALTA el bloque. Es exactamente el bug que documenta
 * `fusionarConfig`, y su modo de fallo es una liquidación que declara todo
 * deducible sin un solo error en el log.
 *
 * `politica_gasto` (la tabla) está muerta desde hace tiempo. La política viva es
 * ésta.
 */
export async function guardarPolitica(
  tenantId: string,
  politica: PoliticaGasto[],
  actor?: { id?: string; email?: string },
): Promise<void> {
  if (!Array.isArray(politica)) throw new DatoInvalido('La política tiene que ser una lista de conceptos.');

  for (const p of politica) {
    if (!p.concepto?.trim()) throw new DatoInvalido('Hay un renglón de la política sin concepto.');
    if (p.topeMonto != null) {
      if (!Number.isFinite(p.topeMonto) || p.topeMonto < 0) {
        throw new DatoInvalido(`El tope de "${p.concepto}" tiene que ser un número mayor o igual a 0.`);
      }
      // Un tope de 0 es una decisión válida (no se permite el concepto), pero
      // se distingue de "sin tope", que es `undefined`. Escribir 0 creyendo que
      // es "sin límite" prohibiría el gasto entero.
    }
  }

  // La mezcla ocurre DENTRO del UPDATE (`tenant_config_merge`, 0159). El
  // lee-modifica-escribe de antes conservaba los hermanos de `config` —eso ya
  // estaba arreglado— pero contra el `config` que se leyó, no contra el que hay
  // al escribir: dos ediciones simultáneas y la de en medio desaparece sin
  // ruido. En `tenant.config` viven los topes fiscales, así que perder una
  // mezcla no es perder una preferencia (DAT-20).
  const { error } = await mezclarConfig(tenantId, { politica }, 'guardarPolitica');
  if (error) throw error;

  await anotar(tenantId, 'politica.editada', 'tenant', tenantId, { conceptos: politica.length }, actor);
}

/**
 * Guarda los ajustes OPERATIVOS de la flota (tabulador, catálogo de cuentas y
 * formato de salida) en `tenant.config`.
 *
 * Mismo LEE-MODIFICA-ESCRIBE que `guardarPolitica`, y por la misma razón: el
 * `config` es un jsonb con los topes fiscales adentro (estímulos,
 * hidrocarburos, validación). Escribirlo entero con solo estas tres llaves se
 * los lleva por delante, y el motor los lee con `if (x != null)` — así que no
 * truena: se SALTA el bloque, y la liquidación sale declarando todo deducible
 * sin un solo error en el log.
 *
 * Lo que este módulo NO deja tocar está documentado en `ajustes_operativos.ts`:
 * el corte entre "parámetros del negocio" y "parámetros de la ley" es legal,
 * no de interfaz. Aquí solo se escriben las tres llaves de negocio, y eso es
 * estructural — `validarAjustes` no puede devolver ninguna otra.
 *
 * VA A LA BITÁCORA porque cambia la aritmética de TODA liquidación futura: sin
 * rastro, un rendimiento que alguien bajó de 3.0 a 2.4 se ve idéntico a un
 * error del motor tres semanas después.
 */
export async function guardarAjustesOperativos(
  tenantId: string,
  ajustes: AjustesValidos,
  actor?: { id?: string; email?: string },
): Promise<void> {
  // Mismo motivo que en `guardarPolitica`: la mezcla la hace la base en un solo
  // UPDATE, así que dos pantallas guardando a la vez ya no se pisan (DAT-20).
  const { error } = await mezclarConfig(tenantId, {
    tabulador: ajustes.tabulador,
    catalogoCuentas: ajustes.catalogoCuentas,
    salida: ajustes.salida,
  }, 'guardarAjustesOperativos');
  if (error) throw error;

  // El detalle guarda los VALORES, no solo "se editó": el para qué de la
  // bitácora aquí es poder contestar "¿con qué rendimiento se cuadró el viaje
  // de marzo?" cuando el número de hoy ya es otro.
  await anotar(tenantId, 'ajustes.editados', 'tenant', tenantId, {
    tabulador: ajustes.tabulador,
    salida: ajustes.salida,
    cuentas: Object.keys(ajustes.catalogoCuentas).length,
  }, actor);
}

/** La política vigente de la flota, ya fusionada con la base. */
export async function politicaVigente(tenantId: string): Promise<PoliticaGasto[]> {
  return (await getConfig(tenantId)).politica;
}

/** Lo que un renglón del formulario de políticas manda por concepto. */
export interface RenglonPolitica {
  concepto: string;
  /** Tal como se tecleó. `''` es SIN TOPE; `'0'` es tope de cero. */
  tope: string;
  exigeCfdi: boolean;
}

/**
 * Arma la política que se va a guardar a partir de lo que se capturó.
 *
 * VIVE AQUÍ Y NO EN LA PÁGINA PORQUE PUEDE PERDER DATOS, y eso hay que poder
 * probarlo. `fusionarConfig` REEMPLAZA el arreglo completo en vez de fusionarlo
 * renglón por renglón, así que lo que esta función devuelva es la política
 * entera de la flota: lo que no venga aquí, se borró.
 *
 * De ahí `porRuta`. El formulario se indexa por CONCEPTO y no tiene dónde poner
 * la ruta, así que las reglas por ruta no viajan en el formulario — y guardar
 * sin ellas se las lleva. Se reponen verbatim. Borrarle a una flota su tope de
 * casetas de una ruta concreta, en silencio, por haber guardado otra cosa, es
 * el tipo de daño que nadie relaciona con esta pantalla tres semanas después.
 *
 * `''` vs `'0'`: vacío es SIN TOPE y cero es TOPE DE CERO (el concepto deja de
 * permitirse). `Number('')` da 0, que los confundiría — y confundirlos prohíbe
 * un gasto que nadie quiso prohibir.
 */
export function armarPolitica(
  renglones: RenglonPolitica[],
  porRuta: PoliticaGasto[] = [],
): PoliticaGasto[] {
  const nueva: PoliticaGasto[] = [];

  for (const r of renglones) {
    const concepto = r.concepto.trim();
    if (!concepto) throw new DatoInvalido('Hay un renglón de la política sin concepto.');

    const crudo = r.tope.trim();
    let topeMonto: number | undefined;
    if (crudo !== '') {
      const n = Number(crudo);
      if (!Number.isFinite(n) || n < 0) {
        throw new DatoInvalido(`El tope de "${concepto}" tiene que ser un número mayor o igual a 0.`);
      }
      topeMonto = n;
    }

    // Un renglón sin tope y sin exigir CFDI no dice nada: el motor lo ignora
    // igual y guardarlo solo ensucia la config.
    if (topeMonto === undefined && !r.exigeCfdi) continue;
    nueva.push({ concepto, topeMonto, requiereCfdi: r.exigeCfdi });
  }

  return [...nueva, ...porRuta];
}

// ── 4. Reabrir un viaje liquidado ──────────────────────────────────────────

/**
 * Reabre un viaje ya liquidado para que vuelva a aceptar comprobantes.
 *
 * NO BASTA CAMBIAR `viaje.estatus`, y esto costó cuatro "ya lo reabrí" que no
 * reabrían nada: el trigger de la 0036 mira si EXISTE una fila de `liquidacion`,
 * no el estatus. Mientras esa fila esté, no entra ni un gasto. La fila se
 * regenera sola al próximo `listo` (es un upsert).
 *
 * ES DESTRUCTIVO y por eso pide `confirmar`. Se pierde la liquidación anterior
 * —incluida la liga a su PDF— y ese PDF pudo haberse entregado ya. Quien reabre
 * tiene que saber que el papel que el operador tiene en la mano dejará de
 * cuadrar con lo que el sistema diga después.
 *
 * TOMA `acquireViajeLock` (auditoría 10, MEDIO de concurrencia) — el MISMO
 * mutex por viaje que `processor.ts` toma antes de cerrar (líneas 1290, 1646)
 * o de emparejar un XML. Sin él hay una carrera real, no solo teórica: borrar
 * la fila de `liquidacion` (paso 1) y poner `viaje.estatus = 'abierto'` (paso 2)
 * son DOS statements sueltos, cada uno su propia transacción — no la función
 * `guardar_liquidacion_tx` (0013), que sólo es atómica CONSIGO MISMA. Si un
 * "listo" que ya estaba en vuelo (mensaje reclamado antes de que se reabriera)
 * llega a `guardar_liquidacion_tx` justo entre esos dos pasos, su INSERT ya no
 * choca contra nada —la liquidación vieja se acaba de borrar— y crea una NUEVA
 * antes de que el paso 2 de aquí alcance a correr. El resultado, si el paso 2
 * gana la carrera: `viaje.estatus = 'abierto'` con una liquidación VIVA
 * apuntando al mismo viaje — el trigger de la 0036 (`gasto_no_tras_liquidar`,
 * que sólo mira si la fila EXISTE, no el estatus) bloquea entonces cualquier
 * gasto nuevo sobre un viaje que la pantalla enseña como abierto. Es exactamente
 * el mismo síntoma que el comentario de abajo describe para el bug del `error`
 * sin comprobar, pero producido por una carrera real en vez de por un bug de
 * lectura. `liquidacion_viaje_uidx` (0005) sólo impide que DOS liquidaciones
 * convivan para el mismo viaje; no impide el intercalado borrar→re-crear.
 * `acquireViajeLock` cierra la ventana por completo: mientras se reabre, ningún
 * cierre puede estar corriendo sobre el mismo viaje, y viceversa.
 *
 * AUDITORÍA 18 (DAT-06): los dos statements sueltos son ahora UNA transacción
 * (`reabrir_viaje_tx`, 0159) y van en el orden contrario —el estatus del viaje
 * PRIMERO, que es el paso que puede rebotar contra
 * `uq_viaje_abierto_por_operador`—, así que un rebote ya no deja un viaje
 * liquidado sin liquidación. Y la liquidación no se pierde: se archiva en
 * `liquidacion_historico` antes de retirarse, porque era la única constancia de
 * un papel que el operador ya tiene en la mano.
 */
export async function reabrirViaje(
  tenantId: string,
  folio: string,
  confirmar: boolean,
  actor?: { id?: string; email?: string },
): Promise<{ pdfPerdido: string | null }> {
  if (!confirmar) {
    throw new DatoInvalido('Reabrir retira la liquidación anterior y su PDF (queda archivada, pero deja de valer). Hay que confirmarlo explícitamente.');
  }

  const admin = supabaseAdmin();
  const { data: viaje, error: errViaje } = await admin
    .from('viaje')
    .select('id, estatus')
    .eq('tenant_id', tenantId)   // el tenant SIEMPRE en el where: el folio no es único global
    .eq('folio', folio)
    .maybeSingle();

  if (errViaje) throw new Error(`reabrirViaje: ${errViaje.message}`);
  if (!viaje) throw new DatoInvalido(`No existe el viaje ${folio} en esta flota.`);

  const viajeId = viaje.id as string;

  // Mutex ANTES de leer, igual que el brazo del XML en processor.ts: leer sin
  // exclusividad ya es parte de la carrera (la liquidación que se lee aquí
  // podría dejar de existir un instante después, por un cierre en vuelo).
  const lock = await acquireViajeLock(viajeId);
  if (!lock) {
    throw new DatoInvalido(
      `El viaje ${folio} está siendo procesado en este momento (un cierre o un XML en curso). ` +
      `Espera unos segundos y vuelve a intentar reabrirlo.`,
    );
  }

  try {
    // ── DAT-06 · EL ORDEN, Y EN UNA SOLA TRANSACCIÓN ──────────────────────
    //
    // Aquí se borraba la liquidación y DESPUÉS se abría el viaje. El segundo
    // paso puede rebotar: si el operador ya tiene otro viaje abierto,
    // `uq_viaje_abierto_por_operador` (0029) lanza 23505 — y la liquidación ya
    // no existe. Queda un viaje `liquidado` SIN liquidación: no se consulta, no
    // se re-cierra, y el PDF que el operador ya recibió no lo respalda nada.
    //
    // `reabrir_viaje_tx` (0159) lo hace al revés y en UNA transacción: traba el
    // viaje, lo pone `abierto` primero —el paso que puede fallar— y sólo
    // entonces ARCHIVA la liquidación en `liquidacion_historico` y la retira.
    // Si el estatus rebota, revierte todo con la liquidación intacta. Y el
    // papel emitido deja de desaparecer sin rastro: hasta hoy, reabrir borraba
    // la única constancia de lo que se le liquidó al operador.
    //
    // El mutex de arriba SIGUE: la transacción protege estas escrituras entre
    // sí, pero no contra el cierre, que calcula y genera el PDF FUERA de ella.
    const { data, error } = await acotada(
      admin.rpc('reabrir_viaje_tx', { p_tenant: tenantId, p_viaje: viajeId }),
      'reabrirViaje',
    );
    if (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new DatoInvalido(
          `No se puede reabrir ${folio}: su operador ya tiene otro viaje abierto. ` +
          'Cierra o cancela ese viaje primero — un operador solo puede tener uno abierto a la vez. ' +
          'La liquidación de este viaje NO se tocó.',
        );
      }
      if ((error as { code?: string }).code === 'CU012') {
        throw new DatoInvalido(`No existe el viaje ${folio} en esta flota.`);
      }
      throw new Error(`reabrirViaje: ${error.message}`);
    }

    const pdfPerdido = ((data as { pdf_perdido?: string | null } | null)?.pdf_perdido ?? null) as string | null;

    // La conversación de WhatsApp queda fuera de la transacción a propósito:
    // que no se pueda desligar el hilo NO es razón para no reabrir el viaje
    // (por eso es un warn y no un throw), y meterla dentro la volvería fatal.
    const { error: errConv } = await admin
      .from('wa_conversacion')
      .update({ viaje_id: null })
      .eq('tenant_id', tenantId)
      .eq('viaje_id', viajeId);
    if (errConv) logger.warn('reabrirViaje.conversacion', { folio, err: errConv.message });

    await anotar(tenantId, 'viaje.reabierto', 'viaje', viajeId, { folio, pdfPerdido }, actor);
    return { pdfPerdido };
  } finally {
    await releaseViajeLock(viajeId);
  }
}
