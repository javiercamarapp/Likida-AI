// Familia documentos y sellos: V08 documento de otra caja, V09 sello distinto, V16 POD inválido, V18 vigencias vencidas, V20 evidencia de salida.
import { DIA, MIN, ausente, cajaNorm, distanciaEdicion, esPendiente, hallazgo, lista, norm, parseInstante, placaNorm, txt } from './base';
import type { ConfigValidaciones, ContextoValidacion, FichaValidable, Hallazgo, Regla } from './tipos';

// ── V08 ─────────────────────────────────────────────────────────────────────
export function validarDocumentosOtraCaja(f: FichaValidable, c: ContextoValidacion, cfg: ConfigValidaciones): Hallazgo[] {
  const hs: Hallazgo[] = [];
  const docs = lista(c.documentos);
  if (docs.length === 0) return [ausente('V08', 'los metadatos de los documentos adjuntos', ['documentos'])];
  const caja = cajaNorm(f.caja?.numero ?? c.cajaAsignada, cfg.prefijosCaja);
  const ref = norm(f.ref);
  const placas = placaNorm(f.caja?.placas);
  if (caja === '' && ref === '') return [ausente('V08', 'la caja o la referencia del servicio', ['caja.numero', 'ref'])];
  for (const d of docs) {
    const tipo = txt(d.tipo) || 'documento';
    let declara = false;
    if (!esPendiente(d.caja) && caja !== '') {
      declara = true;
      const dc = cajaNorm(d.caja, cfg.prefijosCaja);
      if (dc !== caja) {
        const un = distanciaEdicion(dc, caja) <= 1;
        hs.push(hallazgo('V08', 'bloqueo', `El ${tipo} declara la caja ${dc} y el servicio tiene la ${caja}${un ? ' (un carácter de diferencia)' : ''}.`, ['documentos.caja', 'caja.numero'],
          'Rechazar el adjunto; avisar a importación/cruces; no reenviarlo al cliente.'));
      }
    }
    if (!esPendiente(d.ref) && ref !== '') {
      declara = true;
      if (norm(d.ref) !== ref) hs.push(hallazgo('V08', 'bloqueo', `El ${tipo} declara una referencia distinta a la del servicio.`, ['documentos.ref', 'ref'], 'Rechazar el adjunto; avisar a importación/cruces.'));
    }
    if (!esPendiente(d.placasCaja) && placas !== '') {
      declara = true;
      if (placaNorm(d.placasCaja) !== placas) hs.push(hallazgo('V08', 'bloqueo', `El ${tipo} declara placas de caja distintas a las del servicio.`, ['documentos.placasCaja', 'caja.placas'], 'Rechazar el adjunto; avisar a importación/cruces.'));
    }
    if (!declara) hs.push(hallazgo('V08', 'aviso', `El ${tipo} no declara caja, referencia ni placas verificables.`, ['documentos'], 'Verificar a mano antes de usarlo.', true));
  }
  return hs;
}

// ── V09 ─────────────────────────────────────────────────────────────────────
function selloNorm(v: unknown): string {
  return norm(v).replace(/[^A-Z0-9]/g, '');
}

export function validarSello(f: FichaValidable, c: ContextoValidacion, cfg: ConfigValidaciones): Hallazgo[] {
  const hs: Hallazgo[] = [];
  const declarado = selloNorm(c.prealerta?.sello ?? f.sello);
  const actual = selloNorm(f.selloFoto ?? f.sello);
  if (declarado === '' && actual === '') {
    const cita = parseInstante(f.cita);
    const ahora = parseInstante(c.ahora);
    if (cita !== null && ahora !== null && (cita - ahora) / MIN <= cfg.minutosSelloPendiente) {
      return [hallazgo('V09', 'aviso', 'No hay sello registrado y la cita está cerca.', ['sello', 'cita'], 'Avisar al encargado; el agente no teclea ni recuerda sellos.', true)];
    }
    return [hallazgo('V09', 'info', 'Sello pendiente de registro: solo existe tras la colocación en planta.', ['sello'], 'Informar «pendiente»; se comparte antes de salir.', true)];
  }
  if (declarado !== '' && actual !== '' && declarado !== actual) {
    const cerca = distanciaEdicion(declarado, actual) <= 1;
    hs.push(hallazgo('V09', 'bloqueo', `El sello leído no coincide con el declarado${cerca ? ' (un carácter de diferencia: posible captura errónea)' : ''}.`, ['sello', 'selloFoto'],
      'Retener; exigir foto nítida y número el mismo día. El agente no teclea sellos.'));
  }
  for (const d of lista(c.documentos)) {
    const s = selloNorm(d.sello);
    const ref = declarado !== '' ? declarado : actual;
    if (s !== '' && ref !== '' && s !== ref) {
      hs.push(hallazgo('V09', 'bloqueo', `El ${txt(d.tipo) || 'documento'} trae un sello distinto al vigente.`, ['documentos.sello', 'sello'],
        c.inspeccionRojo === true ? 'Tras revisión física el sello cambia: se necesita documento nuevo con el sello vigente.' : 'Retener; pedir el documento con el sello correcto.'));
    }
  }
  if (c.inspeccionRojo === true && declarado !== '' && actual !== '' && declarado === actual) {
    hs.push(hallazgo('V09', 'aviso', 'Hubo revisión física y el sello no cambió respecto del declarado.', ['sello', 'inspeccionRojo'], 'Confirmar con cruces; tras revisión el sello debe tener documento nuevo.'));
  }
  const propio = cajaNorm(f.caja?.numero ?? c.cajaAsignada, cfg.prefijosCaja);
  const vigente = actual !== '' ? actual : declarado;
  if (vigente !== '' && lista(c.selloPorCaja).some((x) => selloNorm(x.sello) === vigente && cajaNorm(x.caja, cfg.prefijosCaja) !== propio)) {
    hs.push(hallazgo('V09', 'bloqueo', 'El mismo sello figura en dos cajas distintas.', ['sello', 'selloPorCaja'], 'Retener; verificar con la foto de cada caja.'));
  }
  return hs;
}

// ── V16 ─────────────────────────────────────────────────────────────────────
const NO_ES_POD = ['CARTA_PORTE', 'CP', 'CP_SELLADA', 'CARTA PORTE'];

export function validarPod(_f: FichaValidable, c: ContextoValidacion, cfg: ConfigValidaciones): Hallazgo[] {
  const pod = c.pod;
  if (!pod) return [ausente('V16', 'el documento de POD y su clasificación', ['pod'])];
  const hs: Hallazgo[] = [];
  const clase = norm(pod.clasificacion);
  if (clase === '') hs.push(ausente('V16', 'la clasificación del archivo de POD', ['pod.clasificacion']));
  if (NO_ES_POD.includes(clase.replace(/ /g, '_')) || NO_ES_POD.includes(clase)) {
    hs.push(hallazgo('V16', 'bloqueo', 'El archivo es una carta porte (aunque esté sellada); no es POD.', ['pod.clasificacion'], 'Rechazar y decir qué documento falta; no reenviar la carta porte como POD.'));
  }
  if (clase === 'ILEGIBLE' || pod.legible === false) {
    hs.push(hallazgo('V16', 'bloqueo', 'El archivo de POD es ilegible.', ['pod.legible'], 'Pedir una foto nítida; no se clasifica como válido.'));
  }
  const fecha = parseInstante(pod.fecha);
  const entrega = parseInstante(c.entrega?.horaEntrega);
  if (fecha !== null && entrega !== null && Math.floor(fecha / DIA) < Math.floor(entrega / DIA)) {
    hs.push(hallazgo('V16', 'bloqueo', 'El POD tiene fecha anterior a la entrega.', ['pod.fecha', 'entrega.horaEntrega'], 'Rechazar: no puede probar una entrega que aún no ocurría.'));
  }
  if (cfg.requisitosPod.length === 0) {
    hs.push(hallazgo('V16', 'info', 'No hay documentos de POD configurados para este cliente: no se verificó la composición.', ['requisitosPod'], 'Configurar qué documento es POD para el cliente.', true));
  } else {
    const recibidos = lista(pod.recibidos).map((x) => norm(x));
    const faltan = cfg.requisitosPod.filter((r) => !recibidos.includes(norm(r)));
    if (faltan.length > 0) hs.push(hallazgo('V16', 'aviso', `Falta para el POD: ${faltan.join(', ')}.`, ['pod.recibidos'], 'Responder «falta {documento}» y avisar al encargado.', true));
  }
  return hs;
}

// ── V18 ─────────────────────────────────────────────────────────────────────
export function validarVigenciasFlota(f: FichaValidable, c: ContextoValidacion, cfg: ConfigValidaciones): Hallazgo[] {
  const vs = lista(c.vigencias);
  if (vs.length === 0) return [ausente('V18', 'las vigencias de los documentos de la flota', ['vigencias'])];
  const uso = parseInstante(f.cita) ?? parseInstante(c.ahora);
  if (uso === null) return [ausente('V18', 'la fecha de uso', ['cita'])];
  const hs: Hallazgo[] = [];
  for (const v of vs) {
    const tipo = txt(v.tipo) || 'documento';
    const h = parseInstante(v.hasta);
    if (esPendiente(v.hasta) || h === null) { hs.push(hallazgo('V18', 'aviso', `Vigencia desconocida del ${tipo}: no se afirma que esté vigente.`, ['vigencias'], 'Pedir la vigencia al responsable.', true)); continue; }
    const dif = Math.floor(h / DIA) - Math.floor(uso / DIA);
    if (dif < 0) hs.push(hallazgo('V18', 'bloqueo', `El ${tipo} está vencido a la fecha de uso.`, ['vigencias'], 'Avisar al encargado; no afirmar vigencia al cliente.'));
    else if (dif <= cfg.diasAvisoVigencia) hs.push(hallazgo('V18', 'aviso', `El ${tipo} vence en ${cfg.diasAvisoVigencia} días o menos.`, ['vigencias'], 'Avisar al encargado para renovarlo.'));
  }
  return hs;
}

// ── V20 ─────────────────────────────────────────────────────────────────────
export function validarEvidenciaSalida(f: FichaValidable, c: ContextoValidacion, cfg: ConfigValidaciones): Hallazgo[] {
  const ev = c.evidenciaSalida;
  if (!ev) return [ausente('V20', 'las fotos registradas de salida', ['evidenciaSalida'])];
  const requeridas = [...cfg.checklistSalida];
  if (norm(f.caja?.tipo) === 'THERMO') requeridas.push('display', 'combustible');
  if (f.blindado === true) requeridas.push('fotos_custodia');
  const buenas = new Set(lista(ev.fotos).filter((x) => x.legible !== false).map((x) => norm(x.tipo)));
  const borrosas = lista(ev.fotos).filter((x) => x.legible === false).map((x) => norm(x.tipo));
  const faltan = [...new Set(requeridas)].filter((r) => !buenas.has(norm(r)));
  if (faltan.length === 0) return [];
  return [hallazgo('V20', 'aviso', `Evidencia de salida incompleta: faltan ${faltan.join(', ')}${borrosas.length ? ` (ilegibles: ${borrosas.join(', ')})` : ''}.`, ['evidenciaSalida'],
    'Recordar al equipo; no se solicita al cliente ni se autoriza la salida.', true)];
}

export const REGLAS_DOCUMENTOS: Regla[] = [
  { id: 'V08', nombre: 'Documento de otra caja', familia: 'documentos_sellos', entradas: ['documentos[caja|ref|placasCaja]', 'caja.numero', 'ref'], nucleo: false, aplica: (_f, c) => lista(c.documentos).length > 0, evaluar: validarDocumentosOtraCaja },
  { id: 'V09', nombre: 'Sello distinto al declarado', familia: 'documentos_sellos', entradas: ['sello', 'selloFoto', 'prealerta.sello', 'documentos[sello]', 'inspeccionRojo'], nucleo: true, aplica: () => true, evaluar: validarSello },
  { id: 'V16', nombre: 'POD inválido', familia: 'documentos_sellos', entradas: ['pod', 'entrega.horaEntrega', 'requisitosPod (config)'], nucleo: false, aplica: (_f, c) => c.pod !== undefined, evaluar: validarPod },
  { id: 'V18', nombre: 'Documentos vencidos de flota', familia: 'documentos_sellos', entradas: ['vigencias', 'cita'], nucleo: false, aplica: (_f, c) => lista(c.vigencias).length > 0, evaluar: validarVigenciasFlota },
  { id: 'V20', nombre: 'Evidencia incompleta de salida', familia: 'documentos_sellos', entradas: ['evidenciaSalida.fotos', 'checklistSalida (config)'], nucleo: false, aplica: (_f, c) => c.evidenciaSalida !== undefined, evaluar: validarEvidenciaSalida },
];
