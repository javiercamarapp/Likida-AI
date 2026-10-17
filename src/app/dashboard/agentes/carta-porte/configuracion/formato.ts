// Piezas puras de la pantalla «Configuración de la salida» (T-A3-32): leer el formulario, validar en línea y armar la
// vista previa. SIN imports de servidor: las usan la vista (cliente) y la acción (servidor) por igual. La validación
// REAL es `validarConfigSalida` (zod) en el servidor; la de aquí solo adelanta el mensaje y una prueba vigila que
// coincidan.

import type { ConfigSalida } from '@/lib/likida/carta_porte_docs/salida_config';

export const ROTULO_ARRANQUE = 'No definidos por el cliente: valores de arranque';
export const FRASE_SIN_DESTINATARIO = 'el jefe de tráfico';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Lo que el formulario manda: todo texto. Vacío = «sin valor». */
export type CamposTexto = Record<keyof ConfigSalida, string>;

export function textoDeConfig(c: ConfigSalida): CamposTexto {
  const t = (v: string | null) => v ?? '';
  return {
    modo: c.modo, plantillaPorDefecto: c.plantillaPorDefecto, reintentosMax: String(c.reintentosMax), frecuenciaMin: String(c.frecuenciaMin),
    ventanaInicio: t(c.ventanaInicio), ventanaFin: t(c.ventanaFin),
    destinatarioAlertaCorreo: t(c.destinatarioAlertaCorreo), destinatarioAlertaUsuario: t(c.destinatarioAlertaUsuario),
    destinatarioRevisionUsuario: t(c.destinatarioRevisionUsuario), destinatarioRevisionCorreo: t(c.destinatarioRevisionCorreo),
    siTmsDesconocido: c.siTmsDesconocido, distanciaFormato: c.distanciaFormato,
  };
}

const vacio = (v: string): boolean => v.trim() === '';
const aNulo = (v: string): string | null => (vacio(v) ? null : v.trim());
const aNumero = (v: string): number => (vacio(v) ? Number.NaN : Number(v.trim()));

/** Del texto del formulario a la entrada de `guardarConfigSalida` (los vacíos pasan a null; un número ilegible a NaN, que el esquema rechaza). */
export function entradaDeTexto(t: CamposTexto): Record<string, unknown> {
  return {
    modo: t.modo, plantillaPorDefecto: t.plantillaPorDefecto, reintentosMax: aNumero(t.reintentosMax), frecuenciaMin: aNumero(t.frecuenciaMin),
    ventanaInicio: aNulo(t.ventanaInicio), ventanaFin: aNulo(t.ventanaFin),
    destinatarioAlertaCorreo: aNulo(t.destinatarioAlertaCorreo), destinatarioAlertaUsuario: aNulo(t.destinatarioAlertaUsuario),
    destinatarioRevisionUsuario: aNulo(t.destinatarioRevisionUsuario), destinatarioRevisionCorreo: aNulo(t.destinatarioRevisionCorreo),
    siTmsDesconocido: t.siTmsDesconocido, distanciaFormato: t.distanciaFormato,
  };
}

export type ErroresCampos = Partial<Record<keyof ConfigSalida, string>>;

/** Mensajes en español por campo, sin ir al servidor. Vacío = todo bien. */
export function erroresEnLinea(t: CamposTexto): ErroresCampos {
  const e: ErroresCampos = {};
  const entero = (v: string): boolean => !vacio(v) && Number.isFinite(Number(v)) && Number.isInteger(Number(v));
  if (vacio(t.reintentosMax) || !Number.isFinite(Number(t.reintentosMax))) e.reintentosMax = 'Reintentos: escribe un número.';
  else if (!entero(t.reintentosMax)) e.reintentosMax = 'Reintentos: debe ser un número entero.';
  else if (Number(t.reintentosMax) < 0) e.reintentosMax = 'Reintentos: el mínimo es 0.';
  else if (Number(t.reintentosMax) > 50) e.reintentosMax = 'Reintentos: el máximo es 50.';
  if (vacio(t.frecuenciaMin) || !Number.isFinite(Number(t.frecuenciaMin))) e.frecuenciaMin = 'Frecuencia: escribe los minutos.';
  else if (!entero(t.frecuenciaMin)) e.frecuenciaMin = 'Frecuencia: debe ser un número entero de minutos.';
  else if (Number(t.frecuenciaMin) < 5) e.frecuenciaMin = 'Frecuencia: el mínimo es 5 minutos.';
  else if (Number(t.frecuenciaMin) > 1440) e.frecuenciaMin = 'Frecuencia: el máximo es 1440 minutos (24 horas).';
  if (!vacio(t.ventanaInicio) && !HHMM.test(t.ventanaInicio.trim())) e.ventanaInicio = 'Inicio de la ventana: usa el formato HH:MM (24 horas).';
  if (!vacio(t.ventanaFin) && !HHMM.test(t.ventanaFin.trim())) e.ventanaFin = 'Fin de la ventana: usa el formato HH:MM (24 horas).';
  if (!e.ventanaInicio && !e.ventanaFin && vacio(t.ventanaInicio) !== vacio(t.ventanaFin)) e.ventanaInicio = 'Ventana horaria: escribe inicio y fin, o deja ambos vacíos.';
  if (!vacio(t.destinatarioAlertaCorreo) && !CORREO.test(t.destinatarioAlertaCorreo.trim())) e.destinatarioAlertaCorreo = 'Correo de la alerta: el correo no es válido.';
  if (!vacio(t.destinatarioRevisionCorreo) && !CORREO.test(t.destinatarioRevisionCorreo.trim())) e.destinatarioRevisionCorreo = 'Correo de la revisión: el correo no es válido.';
  return e;
}

/** «Si el requerimiento no existe: reintento cada 60 min, hasta 6 veces, luego aviso a <destinatario>». */
export function frasePrevia(reintentos: number, frecuenciaMin: number, destinatario: string): string {
  const veces = reintentos === 1 ? '1 vez' : `${reintentos} veces`;
  if (reintentos === 0) return `Si el requerimiento no existe: no se reintenta; se avisa de inmediato a ${destinatario}.`;
  return `Si el requerimiento no existe: reintento cada ${frecuenciaMin} min, hasta ${veces}, luego aviso a ${destinatario}.`;
}

/** A quién llega el aviso hoy, en palabras: correo y/o persona configurados; si no hay nada, el jefe de tráfico. */
export function nombreDestinatario(correo: string, usuarioNombre: string | null): string {
  const partes = [usuarioNombre, vacio(correo) ? null : correo.trim()].filter((x): x is string => !!x);
  return partes.length > 0 ? partes.join(' y ') : FRASE_SIN_DESTINATARIO;
}

/** Contrato que PS entregará para «Probar conexión». Mientras no exista, el botón no se pinta. */
export interface ConectorProbable { probar(): Promise<{ ok: boolean; mensaje: string }> }
export const esProbable = (p: unknown): p is ConectorProbable => typeof p === 'object' && p !== null && typeof (p as { probar?: unknown }).probar === 'function';
