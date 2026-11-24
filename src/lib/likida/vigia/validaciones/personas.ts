// Familia personas y licencias: V04 licencia, V10 ficha completa, V12 operador no disponible.
import { DIA, ausente, esPendiente, hallazgo, leerRuta, parseInstante, txt } from './base';
import type { ConfigValidaciones, ContextoValidacion, FichaValidable, Hallazgo, Regla } from './tipos';
import { detectarFicha } from '../historial/ficha_unidad';

// ── V04 ─────────────────────────────────────────────────────────────────────
export function validarLicencia(f: FichaValidable, c: ContextoValidacion, cfg: ConfigValidaciones): Hallazgo[] {
  const vig = f.operador?.vigenciaLicencia;
  if (esPendiente(vig)) return [ausente('V04', 'la vigencia de la licencia/resello del operador', ['operador.vigenciaLicencia'])];
  const vigMs = parseInstante(vig);
  if (vigMs === null) return [hallazgo('V04', 'bloqueo', 'La vigencia de la licencia no es una fecha válida.', ['operador.vigenciaLicencia'], 'Pedir la fecha completa; no se interpreta.')];
  const servicio = parseInstante(f.cita) ?? parseInstante(c.ahora);
  if (servicio === null) return [ausente('V04', 'la fecha de servicio o la fecha de referencia', ['cita'])];
  const hs: Hallazgo[] = [];
  const dia = Math.floor(vigMs / DIA);
  if (dia < Math.floor(servicio / DIA)) {
    hs.push(hallazgo('V04', 'bloqueo', 'La vigencia del operador está vencida a la fecha del servicio.', ['operador.vigenciaLicencia', 'cita'],
      'No incluirla en la ficha; avisar al encargado. Operador alterno: decisión humana.'));
  } else {
    const fin = f.salida !== undefined && typeof f.horasViaje === 'number' && Number.isFinite(f.horasViaje) ? (parseInstante(f.salida) ?? servicio) + f.horasViaje * 3600000 : null;
    if (fin !== null && dia < Math.floor(fin / DIA)) {
      hs.push(hallazgo('V04', 'bloqueo', 'La vigencia del operador vence antes de que termine el viaje estimado.', ['operador.vigenciaLicencia', 'horasViaje'], 'Avisar al encargado; operador alterno: decisión humana.'));
    } else if (dia - Math.floor(servicio / DIA) <= cfg.diasAvisoVigencia) {
      hs.push(hallazgo('V04', 'aviso', `La vigencia del operador vence en ${cfg.diasAvisoVigencia} días o menos.`, ['operador.vigenciaLicencia'], 'Avisar al encargado para renovarla.'));
    }
  }
  return hs;
}

// ── V10 ─────────────────────────────────────────────────────────────────────
const SENSIBLES = ['operador.licencia', 'operador.vigenciaLicencia', 'operador.celular'];
const CAMPOS_QR = ['operador', 'placas', 'caja', 'color', 'anio', 'modelo', 'marca', 'linea'];

export function validarFichaCompleta(f: FichaValidable, _c: ContextoValidacion, cfg: ConfigValidaciones): Hallazgo[] {
  const hs: Hallazgo[] = [];
  const obligatorios = [...new Set([...cfg.camposObligatorios, ...(cfg.exigirSensibles ? SENSIBLES : [])])];
  for (const ruta of obligatorios) {
    if (esPendiente(leerRuta(f, ruta))) {
      hs.push(hallazgo('V10', 'aviso', `Falta un campo obligatorio de la ficha (${ruta}).`, [ruta], 'Enviar lo confirmado con «pendiente» explícito y avisar al encargado; no rellenar.', true));
    }
  }
  if (f.blindado === true && esPendiente(f.team?.nombre)) {
    hs.push(hallazgo('V10', 'aviso', 'Tracto blindado sin team driver.', ['team.nombre'], 'Pedir el team al encargado; no se rellena.', true));
  }
  if (f.dropQuitapon === true && esPendiente(f.qp)) {
    hs.push(hallazgo('V10', 'aviso', 'Drop con quitapon sin caja QP.', ['qp'], 'Pedir la caja QP: sin ella se niega el acceso.', true));
  }
  const cel = leerRuta(f, 'operador.celular');
  if (!esPendiente(cel)) {
    const dig = txt(cel).replace(/\D/g, '').length;
    if (dig !== cfg.digitosCelular) {
      hs.push(hallazgo('V10', 'aviso', `El celular no tiene los ${cfg.digitosCelular} dígitos esperados (posible número cortado).`, ['operador.celular'], 'Pedir el número completo.'));
    }
  }
  const nombre = leerRuta(f, 'operador.nombre');
  if (!esPendiente(nombre) && txt(nombre).split(/\s+/).filter(Boolean).length < cfg.minPalabrasNombre) {
    hs.push(hallazgo('V10', 'aviso', 'El nombre del operador no trae nombre y ambos apellidos.', ['operador.nombre'], 'Pedir el nombre completo: sin segundo apellido hubo rechazo en acceso.'));
  }
  if (f.modoQr === true) {
    const faltan = CAMPOS_QR.filter((k) => esPendiente(f.qr?.[k]));
    if (faltan.length > 0) {
      hs.push(hallazgo('V10', 'aviso', `El QR trae ${CAMPOS_QR.length - faltan.length} de ${CAMPOS_QR.length} campos.`, faltan.map((k) => `qr.${k}`),
        'Pedir los campos faltantes antes de que el cliente los reclame.', true));
    }
  }
  return hs;
}

/** Lo mismo para una ficha en TEXTO: usa el detector de plantillas y sus `faltan` (misma lista que el reconocimiento de fichas). */
export function validarFichaTexto(texto: string): Hallazgo[] {
  const det = detectarFicha(texto);
  if (!det) return [hallazgo('V10', 'info', 'El texto no se reconoce como una ficha de unidad.', [], 'Revisar el formato; no se asume contenido.', true)];
  return det.faltan.map((campo) => hallazgo('V10', 'aviso', `La ficha no trae el campo «${campo}».`, [campo], 'Enviar lo confirmado con «pendiente» y avisar al encargado.', true));
}

// ── V12 ─────────────────────────────────────────────────────────────────────
export function validarOperadorDisponible(f: FichaValidable, c: ContextoValidacion): Hallazgo[] {
  const op = f.operador;
  if (!op || op.estado === undefined) return [ausente('V12', 'el estado de disponibilidad del operador', ['operador.estado'], 'info')];
  const salida = parseInstante(f.salida) ?? parseInstante(f.cita) ?? parseInstante(c.ahora);
  const hs: Hallazgo[] = [];
  if (op.estado === 'descanso' || op.estado === 'no_disponible') {
    const hasta = parseInstante(op.descansoHasta);
    if (op.estado === 'descanso' && hasta !== null && salida !== null && hasta <= salida) return hs;
    hs.push(hallazgo('V12', 'bloqueo', 'El operador asignado figura en descanso o no disponible a la hora de salida.', ['operador.estado', 'operador.descansoHasta'], 'Revisar la asignación con el encargado; reasignar es decisión humana.'));
  }
  if (typeof op.horasDisponibles === 'number' && typeof f.horasViaje === 'number' && op.horasDisponibles < f.horasViaje) {
    hs.push(hallazgo('V12', 'aviso', 'Al operador le quedan menos horas disponibles que las del viaje estimado.', ['operador.horasDisponibles', 'horasViaje'], 'Revisar con el encargado (descanso legal).'));
  }
  return hs;
}

export const REGLAS_PERSONAS: Regla[] = [
  { id: 'V04', nombre: 'Vigencia de licencia/resello', familia: 'personas_licencias', entradas: ['operador.vigenciaLicencia', 'cita', 'ahora'], nucleo: true, aplica: () => true, evaluar: validarLicencia },
  { id: 'V10', nombre: 'Ficha sin campos obligatorios', familia: 'personas_licencias', entradas: ['camposObligatorios (config)', 'ficha'], nucleo: true, aplica: () => true, evaluar: validarFichaCompleta },
  { id: 'V12', nombre: 'Operador en descanso o no disponible', familia: 'personas_licencias', entradas: ['operador.estado', 'salida'], nucleo: false, aplica: (f) => f.operador?.estado !== undefined, evaluar: (f, c) => validarOperadorDisponible(f, c) },
];

