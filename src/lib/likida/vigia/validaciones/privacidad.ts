// Familia privacidad e identidad: V17 AVC/gafete vs operador, V21 correo sin buzón compartido, P01 datos del operador a solicitante no verificado.
import { ausente, esPendiente, hallazgo, lista, norm, txt } from './base';
import type { ConfigValidaciones, ContextoValidacion, FichaValidable, Hallazgo, Regla } from './tipos';

const SENSIBLES_OPERADOR = ['operador.licencia', 'operador.vigenciaLicencia', 'operador.celular', 'operador.nombre', 'operador.gafete'];

// ── V17 ─────────────────────────────────────────────────────────────────────
export function validarAvc(f: FichaValidable, _c: ContextoValidacion): Hallazgo[] {
  const avc = f.avc;
  if (!avc) return [ausente('V17', 'los identificadores declarados (AVC/gafete/TAG)', ['avc'])];
  const hs: Hallazgo[] = [];
  if (!esPendiente(avc.operador) && !esPendiente(f.operador?.nombre) && norm(avc.operador) !== norm(f.operador?.nombre)) {
    hs.push(hallazgo('V17', 'bloqueo', 'El operador declarado en el AVC no es el operador asignado.', ['avc.operador', 'operador.nombre'], 'Avisar a cruces antes del cruce: si no coincide la caja no sale.'));
  }
  if (!esPendiente(avc.gafete) && !esPendiente(f.operador?.gafete) && norm(avc.gafete) !== norm(f.operador?.gafete)) {
    hs.push(hallazgo('V17', 'bloqueo', 'El gafete declarado no es el del operador asignado.', ['avc.gafete', 'operador.gafete'], 'Avisar a cruces antes del cruce.'));
  }
  if (!esPendiente(avc.tag) && !esPendiente(f.unidad?.tag) && norm(avc.tag) !== norm(f.unidad?.tag)) {
    hs.push(hallazgo('V17', 'bloqueo', 'El TAG declarado no es el de la unidad asignada.', ['avc.tag', 'unidad.tag'], 'Avisar a cruces antes del cruce.'));
  }
  if (hs.length === 0 && esPendiente(avc.operador) && esPendiente(avc.gafete) && esPendiente(avc.tag)) hs.push(ausente('V17', 'operador, gafete o TAG declarados', ['avc']));
  return hs;
}

// ── V21 ─────────────────────────────────────────────────────────────────────
export function validarCorreo(_f: FichaValidable, c: ContextoValidacion, cfg: ConfigValidaciones): Hallazgo[] {
  const co = c.correo;
  if (!co) return [ausente('V21', 'las cabeceras del correo', ['correo'])];
  if (cfg.buzonCompartido === null || esPendiente(cfg.buzonCompartido)) {
    return [hallazgo('V21', 'info', 'No hay buzón compartido configurado: no se verificó la copia.', ['buzonCompartido'], 'Configurar el buzón de cruces/SAC que debe ir en copia.', true)];
  }
  const buzon = norm(cfg.buzonCompartido);
  const dests = [...lista(co.para), ...lista(co.cc)].map((x) => norm(x));
  if (dests.length === 0) return [ausente('V21', 'los destinatarios del correo', ['correo.para'])];
  if (!dests.includes(buzon)) {
    return [hallazgo('V21', 'aviso', 'El correo no lleva en copia el buzón compartido.', ['correo.para', 'correo.cc'], 'Avisar al encargado; el cliente reclama «ya se envió» si no hay constancia.')];
  }
  return [];
}

// ── P01 ─────────────────────────────────────────────────────────────────────
/** Quién pide datos del operador: ¿es un solicitante verificado y en la lista blanca de la flota? Falla cerrado. */
export function validarSolicitanteDatosOperador(solicitante: { id?: string; verificado?: boolean } | undefined, c: Pick<ContextoValidacion, 'listaBlancaDatosOperador'>): Hallazgo[] {
  if (!solicitante || esPendiente(solicitante.id)) {
    return [hallazgo('P01', 'bloqueo', 'No se identificó al solicitante de datos del operador.', ['solicitante'], 'No responder; avisar al encargado y a seguridad.', true)];
  }
  const lb = lista(c.listaBlancaDatosOperador).map((x) => txt(x));
  if (lb.length === 0) {
    return [hallazgo('P01', 'bloqueo', 'La flota no tiene lista blanca de solicitantes autorizados: no se entregan datos del operador.', ['listaBlancaDatosOperador'], 'No responder; avisar al encargado y a seguridad.', true)];
  }
  if (solicitante.verificado !== true) return [hallazgo('P01', 'bloqueo', 'El solicitante no está verificado.', ['solicitante.verificado'], 'No responder; avisar al encargado y a seguridad.')];
  if (!lb.includes(txt(solicitante.id))) return [hallazgo('P01', 'bloqueo', 'El solicitante no está en la lista blanca de la flota.', ['solicitante.id'], 'No responder; avisar al encargado y a seguridad.')];
  return [];
}

/** En `validarFicha`: si la ficha lleva datos personales del operador, el destinatario debe estar autorizado. */
export function validarDestinatarioFicha(f: FichaValidable, c: ContextoValidacion): Hallazgo[] {
  const lleva = SENSIBLES_OPERADOR.filter((r) => {
    const o = f.operador as Record<string, unknown> | undefined;
    const v = o?.[r.split('.')[1]];
    return !esPendiente(v);
  });
  if (lleva.length === 0) return [];
  if (!c.destinatario) return [hallazgo('P01', 'aviso', 'La ficha lleva datos personales del operador y no se indicó destinatario.', ['destinatario'], 'Indicar el destinatario antes de enviar; no se asume que esté autorizado.', true)];
  return validarSolicitanteDatosOperador(c.destinatario, c);
}

export const REGLAS_PRIVACIDAD: Regla[] = [
  { id: 'V17', nombre: 'Gafete/TAG/AVC distinto al operador presente', familia: 'privacidad_identidad', entradas: ['avc', 'operador.nombre', 'operador.gafete', 'unidad.tag'], nucleo: false, aplica: (f) => f.avc !== undefined, evaluar: (f, c) => validarAvc(f, c) },
  { id: 'V21', nombre: 'Correo sin buzón compartido', familia: 'privacidad_identidad', entradas: ['correo.para', 'correo.cc', 'buzonCompartido (config)'], nucleo: false, aplica: (_f, c) => c.correo !== undefined, evaluar: validarCorreo },
];
