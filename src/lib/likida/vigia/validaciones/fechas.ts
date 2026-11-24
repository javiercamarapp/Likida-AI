// Familia fechas y horarios: V05 fecha mal capturada, V13 cuenta espejo, V14 ETA inconsistente, V19 hora fuera de ventana.
import { DIAS_SEMANA, MIN, ausente, diaIso, esPendiente, hallazgo, inicioDia, lista, norm, parseInstante, txt } from './base';
import type { ConfigValidaciones, ContextoValidacion, FichaValidable, Hallazgo, Regla } from './tipos';

interface FechaDescompuesta { y: number; m: number; d: number; ambigua: boolean; sinAnio: boolean }

/** Lee ISO (`2026-11-23`) o `dd/mm[/aa[aa]]`. Devuelve `null` si no es una fecha de calendario. */
export function descomponerFecha(texto: string): FechaDescompuesta | null {
  const s = txt(texto);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  let y: number; let mo: number; let d: number; let ambigua = false; let sinAnio = false;
  if (m) { y = Number(m[1]); mo = Number(m[2]); d = Number(m[3]); }
  else {
    // eslint-disable-next-line security/detect-unsafe-regex
    m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(s);
    if (!m) return null;
    d = Number(m[1]); mo = Number(m[2]);
    sinAnio = m[3] === undefined;
    y = m[3] === undefined ? 0 : m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    ambigua = d <= 12 && mo <= 12 && d !== mo;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (y !== 0) {
    const f = new Date(Date.UTC(y, mo - 1, d));
    if (f.getUTCFullYear() !== y || f.getUTCMonth() !== mo - 1 || f.getUTCDate() !== d) return null;
  }
  return { y, m: mo, d, ambigua, sinAnio };
}

// ── V05 ─────────────────────────────────────────────────────────────────────
export function validarFechas(f: FichaValidable, c: ContextoValidacion, cfg: ConfigValidaciones): Hallazgo[] {
  const hs: Hallazgo[] = [];
  const ahora = parseInstante(c.ahora);
  if (ahora === null) return [ausente('V05', 'la fecha de referencia (ahora)', ['ahora'], 'bloqueo')];
  const hoy = inicioDia(ahora);
  const anioHoy = new Date(ahora).getUTCFullYear();
  if (f.cita !== undefined && parseInstante(f.cita) === null) hs.push(hallazgo('V05', 'bloqueo', 'La fecha/hora de la cita no es válida.', ['cita'], 'Pedir la fecha completa con día.'));
  for (const fc of lista(f.fechas)) {
    const campo = `fechas.${txt(fc.campo) || '?'}`;
    const p = descomponerFecha(fc.texto);
    if (!p) { hs.push(hallazgo('V05', 'bloqueo', 'La fecha capturada no es una fecha de calendario válida.', [campo], 'Pedir la fecha completa; no se interpreta.')); continue; }
    if (p.sinAnio) { hs.push(hallazgo('V05', 'aviso', 'La fecha no trae año.', [campo], 'Confirmar la fecha completa con año y día de la semana.')); continue; }
    if (p.y < anioHoy - 1 || p.y > anioHoy + 1) { hs.push(hallazgo('V05', 'bloqueo', 'La fecha tiene un año fuera de rango razonable.', [campo], 'Corregir la fecha con quien la capturó.')); continue; }
    const ms = Date.UTC(p.y, p.m - 1, p.d);
    if (ms < hoy && fc.permitePasado !== true) hs.push(hallazgo('V05', 'bloqueo', 'La fecha capturada ya pasó.', [campo], 'Confirmar la fecha; mostrar fecha completa con día.'));
    if (p.ambigua) hs.push(hallazgo('V05', 'aviso', 'Formato ambiguo día/mes: ambos números son ≤ 12.', [campo], 'Reescribir la fecha como AAAA-MM-DD.'));
    if (!esPendiente(fc.diaSemana)) {
      const real = DIAS_SEMANA[new Date(ms).getUTCDay()];
      if (norm(fc.diaSemana) !== real) hs.push(hallazgo('V05', 'bloqueo', 'El día de la semana no coincide con la fecha.', [campo], 'Confirmar cuál es correcto: la fecha o el día.'));
    }
  }
  // La fecha del documento debe ser la de la cita.
  const cita = parseInstante(f.cita);
  const doc = parseInstante(f.fechaDocumento);
  if (f.fechaDocumento !== undefined && doc === null) hs.push(hallazgo('V05', 'bloqueo', 'La fecha del documento no es válida.', ['fechaDocumento'], 'Pedir el documento corregido.'));
  if (cita !== null && doc !== null && inicioDia(cita) !== inicioDia(doc)) {
    hs.push(hallazgo('V05', 'aviso', `La fecha del documento (${diaIso(doc)}) es distinta a la fecha de la cita (${diaIso(cita)}).`, ['fechaDocumento', 'cita'], 'Confirmar con importación/cruces antes de enviar.'));
  }
  // Horas sin zona.
  if (cfg.exigirZonaHoraria && f.eta?.valor !== undefined && esPendiente(f.eta.zona)) {
    hs.push(hallazgo('V05', 'aviso', 'La hora no indica zona (Centro/Laredo).', ['eta.zona'], 'Etiquetar la zona en cada hora.'));
  }
  return hs;
}

// ── V13 ─────────────────────────────────────────────────────────────────────
export function validarCuentaEspejo(f: FichaValidable, c: ContextoValidacion): Hallazgo[] {
  const ce = f.ce;
  if (f.cajaDeTerceros === true && esPendiente(ce?.url)) {
    return [hallazgo('V13', 'info', 'Caja de terceros: no tiene cuenta espejo.', ['ce.url'], 'Decirlo explícitamente al cliente; no prometer un link.')];
  }
  if (!ce || esPendiente(ce.url)) return [hallazgo('V13', 'aviso', 'La unidad no tiene cuenta espejo registrada.', ['ce.url'], 'Pedir/generar el link antes de la cita.', true)];
  const ahora = parseInstante(c.ahora);
  const vence = parseInstante(ce.venceEn);
  if (ce.venceEn === undefined || vence === null) return [ausente('V13', 'la vigencia de la cuenta espejo', ['ce.venceEn'])];
  if (ahora === null) return [ausente('V13', 'la fecha de referencia (ahora)', ['ahora'])];
  if (vence <= ahora) return [hallazgo('V13', 'bloqueo', 'La cuenta espejo está vencida.', ['ce.venceEn'], 'Generar un link nuevo y avisar a quien lo emite; no reenviar el vencido.')];
  const cita = parseInstante(f.cita);
  if (cita !== null && vence < cita) return [hallazgo('V13', 'aviso', 'La cuenta espejo vence antes de la cita.', ['ce.venceEn', 'cita'], 'Regenerar el link antes de la cita.')];
  return [];
}

// ── V14 ─────────────────────────────────────────────────────────────────────
export function validarEta(f: FichaValidable, c: ContextoValidacion, cfg: ConfigValidaciones): Hallazgo[] {
  const hs: Hallazgo[] = [];
  const eta = f.eta;
  if (!eta || esPendiente(eta.valor)) return [ausente('V14', 'el ETA vigente', ['eta.valor'])];
  const valor = parseInstante(eta.valor);
  const ahora = parseInstante(c.ahora);
  if (valor === null) return [hallazgo('V14', 'bloqueo', 'El ETA no es una fecha/hora válida.', ['eta.valor'], 'Pedir el ETA completo; el agente no lo calcula.')];
  if (ahora === null) return [ausente('V14', 'la fecha de referencia (ahora)', ['ahora'])];
  if (valor < ahora) hs.push(hallazgo('V14', 'bloqueo', 'El ETA ya venció.', ['eta.valor'], 'No enviarlo como vigente; avisar al encargado.'));
  if (eta.punto === undefined) hs.push(hallazgo('V14', 'aviso', 'El ETA no dice si es a planta o a patio.', ['eta.punto'], 'Etiquetar el punto: ETA a patio no es ETA a planta.'));
  const act = parseInstante(eta.actualizadoEn);
  if (eta.actualizadoEn === undefined || act === null) hs.push(hallazgo('V14', 'aviso', 'El ETA no trae hora de actualización.', ['eta.actualizadoEn'], 'Registrar la hora de actualización.', true));
  else if ((ahora - act) / MIN > cfg.maxAntiguedadEtaMin) hs.push(hallazgo('V14', 'aviso', 'El ETA tiene más antigüedad que el máximo permitido.', ['eta.actualizadoEn'], 'Tratarlo como «sin dato vigente».'));
  const cita = parseInstante(f.cita);
  if (cita !== null && valor > cita) {
    const retraso = (valor - cita) / MIN;
    hs.push(hallazgo('V14', retraso > cfg.retrasoEscalaMin ? 'bloqueo' : 'aviso', 'El ETA es posterior a la cita: avisar el retraso antes de que ocurra.', ['eta.valor', 'cita'],
      retraso > cfg.retrasoEscalaMin ? 'Escalar a gerencia de operación; el aviso de retraso va al cliente 1-2 h antes de la cita.' : 'Avisar al encargado para informar al cliente con anticipación.'));
  }
  if (!esPendiente(eta.anterior) && parseInstante(eta.anterior) !== valor && esPendiente(eta.causaCambio)) {
    hs.push(hallazgo('V14', 'bloqueo', 'El ETA cambió sin causa registrada.', ['eta.causaCambio', 'eta.anterior'], 'Retener el cambio y pedir la causa al encargado; no se comunica un cambio sin causa.'));
  }
  const cambios = lista(c.historialEta).filter((h) => {
    const t = parseInstante(h.registradoEn);
    return t !== null && ahora - t <= 60 * MIN && ahora - t >= 0;
  }).length;
  if (cambios >= 3) hs.push(hallazgo('V14', 'bloqueo', 'Tres o más cambios de ETA en 60 minutos.', ['historialEta'], 'Escalar a gerencia de operación.'));
  else if (cambios === 2) hs.push(hallazgo('V14', 'aviso', 'Dos cambios de ETA en 60 minutos.', ['historialEta'], 'Avisar al encargado antes de enviar otro cambio.'));
  for (const o of lista(c.otrasEtas)) {
    const t = parseInstante(o.valor);
    if (t !== null && Math.abs(t - valor) / MIN > cfg.toleranciaEtaContiguaMin && esPendiente(eta.causaCambio)) {
      hs.push(hallazgo('V14', 'aviso', `Otra caja del mismo grupo (${norm(o.caja)}) tiene un ETA distinto sin explicación.`, ['otrasEtas'], 'Pedir la causa antes de enviar.'));
      break;
    }
  }
  return hs;
}

// ── V19 ─────────────────────────────────────────────────────────────────────
function aMinutos(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function validarHoraVentana(f: FichaValidable, _c: ContextoValidacion, cfg: ConfigValidaciones): Hallazgo[] {
  const mv = f.movimiento;
  if (!mv) return [ausente('V19', 'el movimiento a validar', ['movimiento'], 'info')];
  const t = parseInstante(mv.fechaHora);
  if (t === null) return [ausente('V19', 'la fecha y hora del movimiento', ['movimiento.fechaHora'])];
  const hs: Hallazgo[] = [];
  const dia = diaIso(t);
  if (cfg.fechasExtraordinarias.includes(dia) || (cfg.domingoExtraordinario && new Date(t).getUTCDay() === 0)) {
    hs.push(hallazgo('V19', 'bloqueo', 'El movimiento cae en domingo o festivo (servicio extraordinario).', ['movimiento.fechaHora'],
      'Escalar a gerencia de operación; solo se informa la regla procedimental si la flota la autoriza. El costo es decisión humana.'));
  }
  const v = cfg.ventanasPorMovimiento[mv.tipo];
  if (!v) { hs.push(hallazgo('V19', 'info', `No hay ventana horaria configurada para «${mv.tipo}»: no se evaluó.`, ['ventanasPorMovimiento'], 'Configurar la ventana del cliente/almacén.', true)); return hs; }
  const desde = aMinutos(v.desde);
  const hasta = aMinutos(v.hasta);
  if (desde === null || hasta === null) { hs.push(hallazgo('V19', 'aviso', 'La ventana horaria configurada no es válida (HH:MM).', ['ventanasPorMovimiento'], 'Corregir la configuración.')); return hs; }
  const min = Math.floor((t - inicioDia(t)) / MIN);
  if (min < desde || min > hasta) hs.push(hallazgo('V19', 'aviso', `El movimiento «${mv.tipo}» queda fuera de la ventana configurada.`, ['movimiento.fechaHora'], 'Informar la regla solo si está autorizado; avisar al encargado.'));
  return hs;
}

export const REGLAS_FECHAS: Regla[] = [
  { id: 'V05', nombre: 'Fecha mal capturada', familia: 'fechas_horarios', entradas: ['fechas', 'cita', 'fechaDocumento', 'ahora'], nucleo: true, aplica: () => true, evaluar: validarFechas },
  { id: 'V13', nombre: 'Cuenta espejo vencida o ausente', familia: 'fechas_horarios', entradas: ['ce.url', 'ce.venceEn', 'ahora'], nucleo: false, aplica: (f) => f.ce !== undefined || f.cajaDeTerceros !== undefined, evaluar: (f, c) => validarCuentaEspejo(f, c) },
  { id: 'V14', nombre: 'ETA inconsistente', familia: 'fechas_horarios', entradas: ['eta', 'cita', 'historialEta', 'otrasEtas'], nucleo: false, aplica: (f) => f.eta !== undefined, evaluar: validarEta },
  { id: 'V19', nombre: 'Hora fuera de ventana', familia: 'fechas_horarios', entradas: ['movimiento', 'ventanasPorMovimiento (config)', 'fechasExtraordinarias (config)'], nucleo: false, aplica: (f) => f.movimiento !== undefined, evaluar: validarHoraVentana },
];

