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
import { esRfcValido, rfcChecksumOk } from './intake/cfdi';
import { variantesTelefono, acquireViajeLock, releaseViajeLock } from './conv';
import { destinatarioWhatsApp } from '@/lib/meta/client';
import { getConfig } from './config';
import type { PoliticaGasto } from './cuadre/engine';
import { logger } from '@/lib/logger';
import { DatoInvalido } from './errores';

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
async function anotar(
  tenantId: string | null,
  accion: string,
  entidad: string,
  entidadId: string,
  detalle?: Record<string, unknown>,
  actor?: { id?: string; email?: string },
): Promise<void> {
  const { error } = await supabaseAdmin().from('bitacora_auditoria').insert({
    tenant_id: tenantId,
    actor_id: actor?.id ?? null,
    actor_email: actor?.email ?? null,
    accion,
    entidad,
    entidad_id: entidadId,
    detalle: detalle ?? null,
  });
  if (error) logger.warn('bitacora.no_escribio', { accion, err: error.message });
}

// ── 1. Dar de alta una flota ───────────────────────────────────────────────

export interface NuevaFlota {
  nombre: string;
  rfc?: string;
  ciudad?: string;
  /** Correo del primer administrador. Sin él la flota nace sin quién entre. */
  emailAdmin?: string;
  nombreAdmin?: string;
  /** RFA 2026 regla 2.9 (se piden AL REGISTRAR): ¿dedicación exclusiva al
   *  autotransporte terrestre de carga federal? Sin esta declaración el motor
   *  no puede abrir la facilidad del 15% de diésel en efectivo. */
  dedicacionExclusivaCarga?: boolean;
  /** RFA 2026 regla 2.9: ¿tributa en Título II Cap. VII (coordinados) o Título
   *  IV Cap. II Secc. I (PF con actividad empresarial)? */
  regimenElegible?: boolean;
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

  const admin = supabaseAdmin();
  // RFA 2026 regla 2.9: la declaración de dedicación/régimen se guarda en
  // `tenant.config.facilidadCombustibleEfectivo` (jsonb) — el dato que el
  // motor necesita para abrir la válvula del 15% de diésel en efectivo.
  const facilidad15 = (f.dedicacionExclusivaCarga !== undefined || f.regimenElegible !== undefined)
    ? {
        facilidadCombustibleEfectivo: {
          dedicacionExclusivaCarga: f.dedicacionExclusivaCarga ?? null,
          regimenElegible: f.regimenElegible ?? null,
        },
      }
    : undefined;
  const { data, error } = await admin
    .from('tenant')
    .insert({ nombre, rfc: rfc ?? null, ciudad: f.ciudad?.trim() || null, ...(facilidad15 ? { config: facilidad15 } : {}) })
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
    const r = await provisionarUsuario(tenantId, f.emailAdmin.trim().toLowerCase(), f.nombreAdmin, 'flota_admin');
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

  const admin = supabaseAdmin();
  const { data, error: errLee } = await admin.from('tenant').select('config').eq('id', tenantId).maybeSingle();
  if (errLee) throw new Error(`guardarPolitica: no se pudo leer la config — ${errLee.message}`);

  const actual = (data?.config as Record<string, unknown> | null) ?? {};
  const nueva = { ...actual, politica };

  const { error } = await admin.from('tenant').update({ config: nueva }).eq('id', tenantId);
  if (error) throw new Error(`guardarPolitica: ${error.message}`);

  await anotar(tenantId, 'politica.editada', 'tenant', tenantId, { conceptos: politica.length }, actor);
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
 */
export async function reabrirViaje(
  tenantId: string,
  folio: string,
  confirmar: boolean,
  actor?: { id?: string; email?: string },
): Promise<{ pdfPerdido: string | null }> {
  if (!confirmar) {
    throw new DatoInvalido('Reabrir borra la liquidación anterior y su PDF. Hay que confirmarlo explícitamente.');
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
    // EL `error` DE ESTA LECTURA ERA EL PEOR DEL ARCHIVO. Sin comprobarlo, un
    // fallo de red dejaba `liq` en `null` y a partir de ahí todo se leía al revés:
    // el `if (liq)` se saltaba el borrado, el viaje SÍ se ponía en `abierto`, y se
    // reportaba `pdfPerdido: null` —que en pantalla significa "no perdiste nada"—
    // cuando lo que pasó fue que no se pudo mirar. El resultado es un viaje
    // abierto con su liquidación viva: la 0036 no deja entrar ni un gasto, y con
    // `liquidacion_viaje_uidx` (0005) el siguiente cierre choca contra la fila que
    // nadie sabe que sigue ahí. "Ya lo reabrí" sobre algo que no se reabrió es
    // exactamente el fallo que esta función existe para cerrar.
    //
    // El `tenant_id` va en el where aunque `viajeId` ya se resolvió acotado: es
    // defensa en profundidad, y hace que la consulta se lea sola sin tener que
    // rastrear de dónde vino el id (auditoría de aislamiento entre flotas).
    const { data: liq, error: errLiq } = await admin
      .from('liquidacion')
      .select('id, pdf_url')
      .eq('tenant_id', tenantId)
      .eq('viaje_id', viajeId)
      .maybeSingle();
    if (errLiq) throw new Error(`reabrirViaje: no se pudo leer la liquidación de ${folio} — ${errLiq.message}`);

    const pdfPerdido = (liq?.pdf_url as string | null) ?? null;

    // 1) La fila de liquidación PRIMERO. Es la que el trigger mira.
    if (liq) {
      const { error } = await admin.from('liquidacion').delete()
        .eq('tenant_id', tenantId).eq('viaje_id', viajeId);
      if (error) throw new Error(`reabrirViaje: no se pudo borrar la liquidación — ${error.message}`);
    }

    // 2) El estatus después: si el paso 1 falla, el viaje se queda liquidado y
    //    coherente, en vez de abierto pero incapaz de recibir un gasto.
    const { error: errEstatus } = await admin
      .from('viaje')
      .update({ estatus: 'abierto' })
      .eq('tenant_id', tenantId)
      .eq('id', viajeId);
    if (errEstatus) throw new Error(`reabrirViaje: no se pudo abrir el viaje — ${errEstatus.message}`);

    // 3) La conversación de WhatsApp, para que el operador no siga hablando con
    //    el hilo de un viaje que ya se cerró.
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
