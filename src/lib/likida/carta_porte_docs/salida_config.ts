// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN DE SALIDA AL TMS (tabla cp_salida_config, migración 0790).
//
// Reintentos, frecuencia y destinatarios NO los definió el cliente: los valores
// de abajo son de ARRANQUE, visibles y editables («valores de arranque, ajústalos»).
// Sin fila para la flota se devuelven estos valores — nunca un error.
//
// GUARDIA: aquí no hay credenciales. Las del TMS viven en el cofre de PS; el
// esquema es `.strict()`, así que un `token`/`password` en la entrada se RECHAZA.
// La ventana horaria son HH:MM en la hora LOCAL de la flota (no se convierte a UTC).
// ═══════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { DatoInvalido } from '../errores';
import { anotarBitacora } from '../bitacora_escritura';
import * as repo from './repo';
import type { SalidaConfigFila } from './repo';
import type { ContextoPlantilla } from './plantilla_tms';

export type ConfigSalida = SalidaConfigFila;

/** Valores de arranque (los mismos defaults de la tabla, 0790). */
export const CONFIG_SALIDA_ARRANQUE: Readonly<ConfigSalida> = Object.freeze({
  modo: 'descarga', plantillaPorDefecto: 'normal', reintentosMax: 6, frecuenciaMin: 60,
  ventanaInicio: null, ventanaFin: null,
  destinatarioAlertaCorreo: null, destinatarioAlertaUsuario: null,
  destinatarioRevisionUsuario: null, destinatarioRevisionCorreo: null,
  siTmsDesconocido: 'retener', distanciaFormato: 'texto_km',
});

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const correo = (campo: string) => z.string({ error: `${campo}: escribe un correo.` }).trim().max(254, `${campo}: máximo 254 caracteres.`)
  .regex(CORREO, `${campo}: el correo no es válido.`).nullable();
const hora = (campo: string) => z.string({ error: `${campo}: usa el formato HH:MM.` }).regex(HHMM, `${campo}: usa el formato HH:MM (24 horas).`).nullable();
const usuario = (campo: string) => z.string({ error: `${campo}: elige un usuario.` }).regex(UUID, `${campo}: el usuario no es válido.`).nullable();

export const esquemaConfigSalida = z.strictObject({
  modo: z.enum(['descarga', 'api'], { error: 'Modo de salida: elige descarga o API.' }),
  plantillaPorDefecto: z.enum(['normal', 'nueva'], { error: 'Plantilla por defecto: elige normal o nueva.' }),
  reintentosMax: z.number({ error: 'Reintentos: escribe un número.' }).int('Reintentos: debe ser un número entero.')
    .min(0, 'Reintentos: el mínimo es 0.').max(50, 'Reintentos: el máximo es 50.'),
  frecuenciaMin: z.number({ error: 'Frecuencia: escribe los minutos.' }).int('Frecuencia: debe ser un número entero de minutos.')
    .min(5, 'Frecuencia: el mínimo es 5 minutos.').max(1440, 'Frecuencia: el máximo es 1440 minutos (24 horas).'),
  ventanaInicio: hora('Inicio de la ventana'),
  ventanaFin: hora('Fin de la ventana'),
  destinatarioAlertaCorreo: correo('Correo de la alerta'),
  destinatarioAlertaUsuario: usuario('Usuario de la alerta'),
  destinatarioRevisionUsuario: usuario('Usuario de la revisión'),
  destinatarioRevisionCorreo: correo('Correo de la revisión'),
  siTmsDesconocido: z.enum(['retener', 'enviar'], { error: 'Si el TMS es desconocido: elige retener o enviar.' }),
  distanciaFormato: z.enum(['texto_km', 'numero'], { error: 'Formato de distancia: elige texto_km o numero.' }),
}).refine((c) => (c.ventanaInicio === null) === (c.ventanaFin === null), {
  message: 'Ventana horaria: escribe inicio y fin, o deja ambos vacíos.', path: ['ventanaInicio'],
});

export type EntradaConfigSalida = Partial<ConfigSalida>;

/** Valida una configuración COMPLETA. Lanza `DatoInvalido` con el primer error en español. */
export function validarConfigSalida(c: unknown): ConfigSalida {
  const r = esquemaConfigSalida.safeParse(c);
  if (r.success) return r.data;
  const clavesDesconocidas = r.error.issues.find((i) => i.code === 'unrecognized_keys');
  throw new DatoInvalido(clavesDesconocidas ? 'La configuración trae campos que no existen (las credenciales no se guardan aquí).' : r.error.issues[0].message);
}

/** La configuración de la flota; sin fila, los valores de arranque. Un fallo de lectura SÍ lanza (no se vuelve «arranque»). */
export async function leerConfigSalida(tenantId: string): Promise<ConfigSalida> {
  const fila = await repo.leerSalidaConfig(tenantId);
  return fila ? { ...fila } : { ...CONFIG_SALIDA_ARRANQUE };
}

/**
 * Guarda los campos recibidos sobre la configuración vigente (los demás se conservan), validando el resultado ENTERO.
 * Idempotente: guardar lo mismo dos veces deja el mismo estado y la segunda no anota bitácora.
 * La bitácora lleva solo los NOMBRES de los campos cambiados (jamás correos).
 */
export async function guardarConfigSalida(
  tenantId: string, valores: EntradaConfigSalida, actor: { id?: string | null; email?: string | null } | 'sistema',
): Promise<ConfigSalida> {
  const fila = await repo.leerSalidaConfig(tenantId);
  const actual: ConfigSalida = fila ? { ...fila } : { ...CONFIG_SALIDA_ARRANQUE };
  const nueva = validarConfigSalida({ ...actual, ...valores });
  const cambiados = (Object.keys(nueva) as Array<keyof ConfigSalida>).filter((k) => nueva[k] !== actual[k]);
  const actorId = actor === 'sistema' ? null : (actor.id ?? null);
  if (cambiados.length === 0 && fila) return nueva;
  await repo.guardarSalidaConfig(tenantId, nueva, actorId);
  await anotarBitacora(
    { tenantId, actor, accion: 'ccp.salida_config_guardada', entidad: 'tenant', entidadId: tenantId, detalle: { campos: cambiados } },
    { evento: 'carta_porte_docs.bitacora_no_escribio' },
  );
  return nueva;
}


// ── Elección de plantilla (normal / nueva) ──────────────────────────────────
// NUNCA se adivina por el contenido: el criterio real del cliente aún no existe (bloqueo B-2). Se usa lo configurado:
// `plantillaPorDefecto` y, si la flota lo definió, un override por perfil de cliente en `cp_salida_config.layout.porPerfil`
// ({ "<id de perfil>": "normal" | "nueva" }). `cp_perfil.firma` no cambia.

export const AVISO_PLANTILLA_POR_CONFIG = 'Plantilla elegida por configuración, no por el contenido.';
const AVISO_LAYOUT_INVALIDO = 'La configuración de plantillas por cliente no es válida: se usó la plantilla por defecto.';

const esquemaLayoutSalida = z.looseObject({
  porPerfil: z.record(z.string().max(128), z.enum(['normal', 'nueva'])).optional(),
});

export interface EleccionPlantilla { plantilla: 'normal' | 'nueva'; origen: 'perfil' | 'defecto'; avisos: string[] }

/** Elige la plantilla con el override del perfil si existe; si no, la de la flota más el aviso de que no salió del contenido. */
export function elegirPlantilla(config: Pick<ConfigSalida, 'plantillaPorDefecto'>, layoutConfig: unknown, perfilId: string | null): EleccionPlantilla {
  const avisos: string[] = [];
  if (layoutConfig !== null && layoutConfig !== undefined) {
    const r = esquemaLayoutSalida.safeParse(layoutConfig);
    if (!r.success) avisos.push(AVISO_LAYOUT_INVALIDO);
    else if (perfilId && r.data.porPerfil && Object.hasOwn(r.data.porPerfil, perfilId)) {
      return { plantilla: r.data.porPerfil[perfilId], origen: 'perfil', avisos };
    }
  }
  avisos.push(AVISO_PLANTILLA_POR_CONFIG);
  return { plantilla: config.plantillaPorDefecto, origen: 'defecto', avisos };
}

/** El contexto de `construirPlantilla` desde la configuración de la flota: plantilla elegida, formato de distancia y avisos. */
export function contextoPlantillaDeConfig(
  config: Pick<ConfigSalida, 'plantillaPorDefecto' | 'distanciaFormato'>, layoutConfig: unknown,
  opciones: { perfilId?: string | null; clienteInterno?: string | null; uso?: 'descarga' | 'envio' } = {},
): ContextoPlantilla {
  const e = elegirPlantilla(config, layoutConfig, opciones.perfilId ?? null);
  return { clienteInterno: opciones.clienteInterno ?? null, plantilla: e.plantilla, distanciaFormato: config.distanciaFormato, uso: opciones.uso, avisos: e.avisos };
}
