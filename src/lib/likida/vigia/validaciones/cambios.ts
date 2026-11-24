// Familia cambios y prealerta: V07 cambio tras prealerta, V11 tipo/planta vs CI, V15 programa que cambia.
import { MIN, ausente, cajaNorm, esPendiente, hallazgo, lista, norm, parseInstante, placaNorm, txt } from './base';
import type { ConfigValidaciones, ContextoValidacion, FichaValidable, Hallazgo, Regla, ServicioPrograma } from './tipos';

/** Campos que, si cambian, obligan a rehacer prealerta/QR/CCP. */
const CAMPOS_CLAVE: Array<[string, (f: FichaValidable, p: string[]) => string]> = [
  ['caja.numero', (f, p) => cajaNorm(f.caja?.numero, p)],
  ['caja.placas', (f) => placaNorm(f.caja?.placas)],
  ['unidad.eco', (f) => norm(f.unidad?.eco)],
  ['unidad.placa', (f) => placaNorm(f.unidad?.placa)],
  ['operador.nombre', (f) => norm(f.operador?.nombre)],
  ['team.nombre', (f) => norm(f.team?.nombre)],
];

/** Huella determinista (FNV-1a de 32 bits, hex) de los campos clave de una ficha: sin datos legibles. */
export function huellaFicha(f: FichaValidable, prefijos: readonly string[] = []): string {
  const base = CAMPOS_CLAVE.map(([k, fn]) => `${k}=${fn(f ?? {}, [...prefijos])}`).join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < base.length; i += 1) {
    h ^= base.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function camposCambiados(antes: FichaValidable, despues: FichaValidable, prefijos: readonly string[] = []): string[] {
  return CAMPOS_CLAVE.filter(([, fn]) => fn(antes ?? {}, [...prefijos]) !== fn(despues ?? {}, [...prefijos])).map(([k]) => k);
}

function inestable(c: ContextoValidacion, cfg: ConfigValidaciones, cambiosNuevos: number): boolean {
  const ahora = parseInstante(c.ahora);
  if (ahora === null) return false;
  const previos = lista(c.cambiosRecientes).filter((x) => {
    const t = parseInstante(x);
    return t !== null && ahora - t >= 0 && ahora - t <= cfg.ventanaInestableMin * MIN;
  }).length;
  return previos + cambiosNuevos >= 2;
}

// ── V07 ─────────────────────────────────────────────────────────────────────
export function validarCambio(antes: FichaValidable, despues: FichaValidable, c: ContextoValidacion, cfg: ConfigValidaciones): Hallazgo[] {
  if (!antes || !despues) return [ausente('V07', 'la ficha anterior y la nueva', ['antes', 'despues'], 'bloqueo')];
  const cambiados = camposCambiados(antes, despues, cfg.prefijosCaja);
  if (cambiados.length === 0) return [];
  const hs: Hallazgo[] = [];
  const hayPrealerta = c.prealerta?.enviadaEn !== undefined && !esPendiente(c.prealerta.enviadaEn);
  const cambioCaja = cambiados.some((k) => k.startsWith('caja.'));
  hs.push(hallazgo('V07', hayPrealerta ? 'bloqueo' : 'aviso',
    hayPrealerta ? 'Cambio de unidad/operador/caja después de enviada la prealerta.' : 'La ficha cambió respecto de la última enviada.',
    cambiados,
    hayPrealerta
      ? `Avisar al encargado; enviar la ficha con «Actualización» una sola vez; el cliente debe rehacer prealerta/QR${cambioCaja ? ' y la CCP/DODA (cambio de caja)' : ''}. No reenviar sin confirmación.`
      : `Enviar la ficha con «Actualización: campo de A a B; motivo» una sola vez${cambioCaja ? '; el cambio de caja implica nueva CCP' : ''}.`));
  if (inestable(c, cfg, 1)) {
    hs.push(hallazgo('V07', 'bloqueo', `Dos o más cambios en ${cfg.ventanaInestableMin} minutos: servicio inestable.`, cambiados, 'Escalar a gerencia de operación; no enviar otra ficha sin explicación.'));
  }
  return hs;
}

/** En `validarFicha`: compara la huella de la ficha vigente contra la de la prealerta enviada. */
export function validarPostPrealerta(f: FichaValidable, c: ContextoValidacion, cfg: ConfigValidaciones): Hallazgo[] {
  const huella = c.prealerta?.huella;
  if (esPendiente(huella)) return [ausente('V07', 'la huella de la ficha al enviar la prealerta', ['prealerta.huella'], 'info')];
  const hs: Hallazgo[] = [];
  if (huellaFicha(f, cfg.prefijosCaja) !== huella) {
    hs.push(hallazgo('V07', 'bloqueo', 'La ficha vigente difiere de la que se prealertó.', ['prealerta.huella'], 'Avisar al encargado; el cliente debe rehacer la prealerta; no reenviar sin confirmación.'));
  }
  if (inestable(c, cfg, 0) && lista(c.cambiosRecientes).length >= 2) {
    hs.push(hallazgo('V07', 'bloqueo', `Dos o más cambios en ${cfg.ventanaInestableMin} minutos: servicio inestable.`, ['cambiosRecientes'], 'Escalar a gerencia de operación.'));
  }
  return hs;
}

// ── V11 ─────────────────────────────────────────────────────────────────────
export function validarContraCi(f: FichaValidable, c: ContextoValidacion): Hallazgo[] {
  const ci = c.ci;
  if (!ci) return [ausente('V11', 'la instrucción del cliente (CI) o el programa', ['ci'])];
  const hs: Hallazgo[] = [];
  const cmp = (campo: string, a: unknown, b: unknown, msg: string, sev: 'bloqueo' | 'aviso' = 'bloqueo') => {
    if (esPendiente(a) || esPendiente(b)) return;
    if (norm(a) !== norm(b)) hs.push(hallazgo('V11', sev, msg, [campo], 'Avisar al encargado; la corrección de la CCP la hace una persona.'));
  };
  cmp('caja.tipo', f.caja?.tipo, ci.tipoCaja, 'El tipo de caja asignado no coincide con la CI.');
  cmp('tipoTracto', f.tipoTracto, ci.tipoTracto, 'El tipo de tracto (blindado/regular) no coincide con la CI.');
  cmp('planta', f.planta, ci.planta, 'La planta del servicio no coincide con la CI.');
  cmp('origenCcp', f.origenCcp, ci.planta ?? ci.origenCcp, 'El origen de la CCP no coincide con la planta de la CI.');
  if (typeof f.accesorios?.gatas === 'number' && typeof ci.gatas === 'number' && f.accesorios.gatas !== ci.gatas) {
    hs.push(hallazgo('V11', 'aviso', 'La cantidad de gatas no coincide con la CI.', ['accesorios.gatas'], 'Confirmar accesorios con el encargado.'));
  }
  return hs;
}

// ── V15 ─────────────────────────────────────────────────────────────────────
/** Compara dos versiones del programa del día: conteo, horas, cancelaciones y drops nuevos. */
export function validarPrograma(anterior: readonly ServicioPrograma[] | undefined, actual: readonly ServicioPrograma[] | undefined): Hallazgo[] {
  if (!Array.isArray(anterior) || !Array.isArray(actual)) return [ausente('V15', 'las dos versiones del programa', ['anterior', 'actual'])];
  const hs: Hallazgo[] = [];
  const vivos = (p: readonly ServicioPrograma[]) => p.filter((s) => s.cancelado !== true);
  if (vivos(anterior).length !== vivos(actual).length) {
    hs.push(hallazgo('V15', 'aviso', `El programa cambió de ${vivos(anterior).length} a ${vivos(actual).length} servicios.`, ['programa'], 'Enviar la confirmación de recepción con los cambios y avisar al encargado; no confirmar disponibilidad.'));
  }
  const clave = (s: ServicioPrograma) => `${txt(s.hora)}|${norm(s.planta)}|${norm(s.modalidad)}`;
  const antes = new Set(vivos(anterior).map(clave));
  const despues = new Set(vivos(actual).map(clave));
  const desaparecen = [...antes].filter((k) => !despues.has(k)).length;
  const aparecen = [...despues].filter((k) => !antes.has(k)).length;
  if (vivos(anterior).length === vivos(actual).length && (desaparecen > 0 || aparecen > 0)) {
    hs.push(hallazgo('V15', 'aviso', `Cambian ${Math.max(desaparecen, aparecen)} servicio(s) en hora, planta o modalidad.`, ['programa'], 'Enviar la confirmación de recepción con los cambios y avisar al encargado.'));
  }
  const nuevasCanc = actual.filter((s) => s.cancelado === true).length - anterior.filter((s) => s.cancelado === true).length;
  if (nuevasCanc > 0) hs.push(hallazgo('V15', 'aviso', `${nuevasCanc} servicio(s) cancelados desde la versión anterior.`, ['programa'], 'Registrar la instrucción literal y avisar al encargado para liberar unidades.'));
  const dropsNuevos = vivos(actual).filter((s) => norm(s.modalidad) === 'DROP').length - vivos(anterior).filter((s) => norm(s.modalidad) === 'DROP').length;
  if (dropsNuevos > 0) hs.push(hallazgo('V15', 'aviso', `${dropsNuevos} servicio(s) pasaron a drop o son drops nuevos.`, ['programa'], 'Avisar al encargado: para el transportista equivale a una cancelación.'));
  return hs;
}

export const REGLAS_CAMBIOS: Regla[] = [
  { id: 'V07', nombre: 'Cambio tras prealerta', familia: 'cambios_prealerta', entradas: ['ficha', 'prealerta.huella|prealerta.enviadaEn', 'cambiosRecientes'], nucleo: false, aplica: (_f, c) => c.prealerta !== undefined, evaluar: (f, c, cfg) => validarPostPrealerta(f, c, cfg) },
  { id: 'V11', nombre: 'Tipo de caja/tracto o planta vs CI', familia: 'cambios_prealerta', entradas: ['caja.tipo', 'tipoTracto', 'planta', 'origenCcp', 'ci'], nucleo: false, aplica: (_f, c) => c.ci !== undefined, evaluar: (f, c) => validarContraCi(f, c) },
];
