// ═══════════════════════════════════════════════════════════════════════════
// VALIDACIÓN — catálogos SAT, RFC, CP, pesos y coherencia, y el BLOQUEO.
//
// Tres severidades, y la diferencia entre ellas es lo que hace seguro el flujo:
//
//   · bloqueo   el valor falta o NO puede ser verdad (formato imposible, peso que
//               ningún camión carga, clave de producto fuera de rango). No se
//               aprueba hasta que alguien lo escriba bien: confirmar no basta.
//   · confirmar el valor PUEDE ser verdad pero hay una razón para dudar (el
//               modelo no está seguro, el RFC no pasa el dígito verificador, el
//               CP no es del estado que dice, los pesos no suman, el documento
//               trató de darle órdenes al modelo). Se aprueba cuando un humano lo
//               confirma o lo corrige: `origen: humano` limpia el hallazgo.
//   · aviso     informativo: se muestra y no frena nada.
//
// Un campo CRÍTICO (RFC, CP, descripción, clave, cantidad, unidad, peso) que falta
// bloquea; uno que viene dudoso exige confirmación. Es el «bloqueo de campos
// críticos dudosos» del encargo, y la razón es la de siempre: un dato falso en el
// complemento es un comprobante falso (CFF 29-A fr. IX), no un error de captura.
// ═══════════════════════════════════════════════════════════════════════════

import { CAMPOS_DOC, CAMPOS_MERCANCIA, UMBRAL_CRITICO, etiquetaCampo, type CampoDoc, type CampoValor, type Extraccion } from './campos';
import { CLAVES_UNIDAD, CODIGOS_ESTADO, FACTOR_A_KG, estadoDeCp } from './catalogos';
import { valorSospechoso } from './inyeccion';
import { normalizarNumero } from './normalizar';
import { rfcChecksumOk } from '../intake/cfdi';

export type Severidad = 'bloqueo' | 'confirmar' | 'aviso';

export interface Hallazgo {
  /** Clave del campo (`origen_cp`, `peso_kg`…) o `documento` / `mercancias`. */
  campo: string;
  /** Índice del renglón de mercancía, o `null` si es del documento. */
  renglon: number | null;
  severidad: Severidad;
  codigo: string;
  mensaje: string;
  /** Otros campos que, al confirmarse, también resuelven este hallazgo. */
  relacionados?: Array<{ campo: string; renglon: number | null }>;
}

export interface ResultadoValidacion {
  hallazgos: Hallazgo[];
  bloqueos: number;
  porConfirmar: number;
  /** Sin bloqueos y sin nada por confirmar: un humano puede aprobar. */
  listoParaAprobar: boolean;
}

export interface OpcionesValidacion {
  riesgoInyeccion?: boolean;
  remitenteReconocido?: boolean | null;
  /** Para probar con un reloj fijo. */
  ahora?: Date;
}

const RFC_MORAL = /^[A-ZÑ&]{3}\d{6}[A-Z0-9]{3}$/;
const RFC_FISICA = /^[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}$/;
const RFC_GENERICOS = new Set(['XAXX010101000', 'XEXX010101000']);
const FECHA_DIA_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const FECHA_HORA_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;
/** `[año, mes, día, hora?, minuto?]` o `null` si no es una fecha ISO del módulo (sin cuantificadores anidados). */
const partesFecha = (v: string | null | undefined): number[] | null => {
  const m = FECHA_HORA_RE.exec(v ?? '') ?? FECHA_DIA_RE.exec(v ?? '');
  return m ? m.slice(1).map(Number) : null;
};
const PLACA_RE = /^[A-Z0-9]{5,7}$/;
const PESO_MAX_BLOQUEO_KG = 80_000;
const PESO_ALERTA_KG = 60_000;

const esVacio = (c: CampoValor | undefined): boolean => !c || c.valor === null || c.valor === '';

/** Valida la forma de UN RFC. `null` = bien; si no, el motivo. */
export function problemaRfc(rfc: string): { codigo: string; mensaje: string; severidad: Severidad } | null {
  if (RFC_GENERICOS.has(rfc)) return null;
  if (!(RFC_MORAL.test(rfc) || RFC_FISICA.test(rfc))) {
    return { codigo: 'rfc_forma', mensaje: `«${rfc}» no tiene forma de RFC (12 caracteres para persona moral, 13 para física).`, severidad: 'bloqueo' };
  }
  const m = /(\d{2})(\d{2})(\d{2})/.exec(rfc.slice(rfc.length - 9));
  if (m) {
    const mes = Number(m[2]); const dia = Number(m[3]);
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) {
      return { codigo: 'rfc_fecha', mensaje: `El RFC «${rfc}» trae una fecha de constitución/nacimiento imposible (${m[1]}-${m[2]}-${m[3]}).`, severidad: 'bloqueo' };
    }
  }
  if (!rfcChecksumOk(rfc)) {
    return { codigo: 'rfc_digito', mensaje: `El dígito verificador del RFC «${rfc}» no cuadra: probable error de lectura o de captura. Confírmalo contra la constancia fiscal.`, severidad: 'confirmar' };
  }
  return null;
}

type Registrar = (h: Hallazgo) => void;

function validarFormato(def: CampoDoc, c: CampoValor, renglon: number | null, reg: Registrar): void {
  const v = c.valor as string;
  const aqui = (severidad: Severidad, codigo: string, mensaje: string, relacionados?: Hallazgo['relacionados']) =>
    reg({ campo: def.clave, renglon, severidad, codigo, mensaje: `${etiquetaCampo(def.clave, renglon)}: ${mensaje}`, relacionados });

  switch (def.tipo) {
    case 'rfc': {
      const p = problemaRfc(v);
      if (p) aqui(p.severidad, p.codigo, p.mensaje);
      break;
    }
    case 'cp': {
      if (!/^\d{5}$/.test(v)) aqui('bloqueo', 'cp_forma', `«${v}» no es un código postal (5 dígitos).`);
      else if (estadoDeCp(v) === null) aqui('bloqueo', 'cp_inexistente', `El código postal ${v} no existe (los dos primeros dígitos no corresponden a ninguna entidad).`);
      break;
    }
    case 'estado':
      if (!CODIGOS_ESTADO.has(v)) aqui('confirmar', 'estado_no_catalogo', `«${v}» no es una clave del catálogo c_Estado (p. ej. JAL, NLE, CMX).`);
      break;
    case 'fecha': {
      if (partesFecha(v) === null) aqui('confirmar', 'fecha_forma', `«${v}» no se reconoció como fecha.`);
      break;
    }
    case 'numero': {
      const n = normalizarNumero(v).valor;
      if (n === null) { aqui('bloqueo', 'numero_forma', `«${v}» no es un número.`); break; }
      if (def.clave === 'valor_mercancia' ? n < 0 : n <= 0) aqui('bloqueo', 'numero_no_positivo', `Debe ser mayor que cero (leí ${v}).`);
      else if (n >= 1e9) aqui('bloqueo', 'numero_excesivo', `${v} es una cifra fuera de rango.`);
      if (def.clave === 'peso_kg' || def.clave === 'peso_bruto_total') {
        if (n > PESO_MAX_BLOQUEO_KG) aqui('bloqueo', 'peso_imposible', `${v} kg excede el peso bruto máximo que autoriza la NOM-012 (≈ 80,000 kg). ¿Está en toneladas o gramos?`);
        else if (n > PESO_ALERTA_KG) aqui('confirmar', 'peso_alto', `${v} kg es un peso de carga excepcional (más de 60,000 kg). Confírmalo.`);
      }
      break;
    }
    case 'clave_prod': {
      if (!/^\d{8}$/.test(v)) { aqui('bloqueo', 'clave_forma', `«${v}» no es una clave c_ClaveProdServCP (8 dígitos).`); break; }
      const seg = Number(v.slice(0, 2));
      if (seg < 10 || seg > 95) aqui('bloqueo', 'clave_segmento', `La clave ${v} no pertenece a ningún segmento del catálogo (10 a 95).`);
      else if (v === '78101800') aqui('confirmar', 'clave_servicio', 'La 78101800 es el SERVICIO de transporte de carga, no la mercancía. Pon la clave del producto que se transporta.');
      else aqui('aviso', 'clave_sin_catalogo', `La clave ${v} tiene forma válida; el catálogo completo lo valida el PAC al timbrar.`);
      break;
    }
    case 'clave_unidad': {
      if (CLAVES_UNIDAD.has(v)) break;
      if (!/^[A-Z0-9]{2,3}$/.test(v)) aqui('bloqueo', 'unidad_forma', `«${v}» no es una clave c_ClaveUnidad (2 o 3 caracteres, p. ej. KGM, H87, XBX).`);
      else aqui('aviso', 'unidad_fuera_subconjunto', `La clave ${v} no está entre las de uso común que Likida reconoce; verifícala contra el catálogo c_ClaveUnidad.`);
      break;
    }
    case 'fraccion':
      if (!/^\d+$/.test(v) || (v.length !== 8 && v.length !== 10)) aqui('bloqueo', 'fraccion_forma', `«${v}» no es una fracción arancelaria (8 dígitos, o 10 con NICO).`);
      break;
    case 'moneda':
      if (!/^[A-Z]{3}$/.test(v)) aqui('bloqueo', 'moneda_forma', `«${v}» no es una clave de moneda ISO (MXN, USD…).`);
      else if (v !== 'MXN' && v !== 'USD') aqui('aviso', 'moneda_rara', `La moneda ${v} no es MXN ni USD; verifica el tipo de cambio al timbrar.`);
      break;
    case 'embalaje':
      if (!/^[0-9A-Z]{2,3}$/.test(v)) aqui('confirmar', 'embalaje_forma', `«${v}» no parece una clave c_TipoEmbalaje (2 o 3 caracteres).`);
      break;
    case 'placa':
      if (!PLACA_RE.test(v)) aqui('confirmar', 'placa_forma', `«${v}» no cumple 5 a 7 caracteres alfanuméricos sin guiones ni espacios.`);
      break;
    case 'booleano':
      if (v !== 'true' && v !== 'false') aqui('confirmar', 'booleano_forma', `«${v}» no se reconoció como sí/no.`);
      break;
    case 'texto':
      if (def.clave === 'operador_licencia' && !/^[A-Z0-9-]{6,16}$/i.test(v)) {
        aqui('confirmar', 'licencia_forma', `La licencia federal lleva de 6 a 16 caracteres (leí «${v}»).`);
      }
      break;
  }
}

/** ¿Algún campo de la lista relacionada lo dejó un humano? Entonces el hallazgo «confirmar» ya se atendió. */
function confirmado(e: Extraccion, h: Hallazgo): boolean {
  const lista = [{ campo: h.campo, renglon: h.renglon }, ...(h.relacionados ?? [])];
  return lista.some((r) => (r.renglon === null ? e.campos[r.campo] : e.mercancias[r.renglon]?.[r.campo])?.origen === 'humano');
}

export function validarExtraccion(e: Extraccion, op: OpcionesValidacion = {}): ResultadoValidacion {
  const hallazgos: Hallazgo[] = [];
  const reg: Registrar = (h) => hallazgos.push(h);
  const ahora = op.ahora ?? new Date();

  const revisarCampo = (def: CampoDoc, c: CampoValor | undefined, renglon: number | null): void => {
    const etiqueta = etiquetaCampo(def.clave, renglon);
    if (esVacio(c)) {
      if (def.critico) reg({ campo: def.clave, renglon, severidad: 'bloqueo', codigo: 'critico_ausente', mensaje: `${etiqueta}: el documento no lo trae o no se pudo leer. Captúralo para poder aprobar.` });
      return;
    }
    const campo = c as CampoValor;
    validarFormato(def, campo, renglon, reg);
    if (campo.origen === 'humano') return; // lo demás son DUDAS sobre una lectura: un humano ya la resolvió.
    if (valorSospechoso(campo.valor)) {
      reg({ campo: def.clave, renglon, severidad: 'bloqueo', codigo: 'valor_sospechoso', mensaje: `${etiqueta}: el valor leído parece una instrucción, no un dato. Escríbelo tú.` });
    }
    if (def.critico && campo.confianza < UMBRAL_CRITICO) {
      reg({ campo: def.clave, renglon, severidad: 'confirmar', codigo: 'confianza_baja', mensaje: `${etiqueta}: la lectura no es segura (${Math.round(campo.confianza * 100)} %). Confírmala contra el documento.` });
    }
    if (def.critico && op.riesgoInyeccion) {
      reg({ campo: def.clave, renglon, severidad: 'confirmar', codigo: 'documento_con_instrucciones', mensaje: `${etiqueta}: el documento trae texto con forma de instrucción; confirma este dato a mano.` });
    }
    for (const nota of campo.notas ?? []) {
      if (/Confírmalo|confirma la cifra|No se reconoció/i.test(nota)) {
        reg({ campo: def.clave, renglon, severidad: 'confirmar', codigo: 'normalizacion_dudosa', mensaje: `${etiqueta}: ${nota}` });
      }
    }
  };

  for (const def of CAMPOS_DOC) revisarCampo(def, e.campos[def.clave], null);

  if (e.mercancias.length === 0) {
    reg({ campo: 'mercancias', renglon: null, severidad: 'bloqueo', codigo: 'sin_mercancias', mensaje: 'No se encontró ninguna mercancía en el documento. Agrega al menos un renglón para poder aprobar.' });
  }
  e.mercancias.forEach((fila, i) => { for (const def of CAMPOS_MERCANCIA) revisarCampo(def, fila[def.clave], i); });

  // ── Coherencia entre campos ───────────────────────────────────────────────
  for (const lado of ['origen', 'destino'] as const) {
    const cp = e.campos[`${lado}_cp`]?.valor; const est = e.campos[`${lado}_estado`]?.valor;
    if (cp && est && /^\d{5}$/.test(cp) && CODIGOS_ESTADO.has(est)) {
      const esperado = estadoDeCp(cp);
      if (esperado && esperado !== est) {
        reg({ campo: `${lado}_cp`, renglon: null, severidad: 'confirmar', codigo: 'cp_estado', mensaje: `El código postal ${cp} corresponde a ${esperado}, pero el estado de ${lado} dice ${est}. Revisa cuál de los dos está mal.`, relacionados: [{ campo: `${lado}_estado`, renglon: null }] });
      }
    }
  }
  const f1 = partesFecha(e.campos.fecha_salida?.valor); const f2 = partesFecha(e.campos.fecha_llegada?.valor);
  if (f1 && f2) {
    const a = Date.UTC(f1[0], f1[1] - 1, f1[2], f1[3] ?? 0, f1[4] ?? 0); const b = Date.UTC(f2[0], f2[1] - 1, f2[2], f2[3] ?? 0, f2[4] ?? 0);
    if (b < a) reg({ campo: 'fecha_llegada', renglon: null, severidad: 'confirmar', codigo: 'fecha_orden', mensaje: 'La llegada es anterior a la salida.', relacionados: [{ campo: 'fecha_salida', renglon: null }] });
  }
  if (f1) {
    const dias = (Date.UTC(f1[0], f1[1] - 1, f1[2]) - ahora.getTime()) / 86_400_000;
    if (dias < -365 || dias > 365) reg({ campo: 'fecha_salida', renglon: null, severidad: 'aviso', codigo: 'fecha_lejana', mensaje: 'La fecha de salida está a más de un año de hoy.' });
  }
  if (e.campos.origen_cp?.valor && e.campos.origen_cp.valor === e.campos.destino_cp?.valor) {
    reg({ campo: 'destino_cp', renglon: null, severidad: 'aviso', codigo: 'mismo_cp', mensaje: 'El origen y el destino tienen el mismo código postal.' });
  }
  // Pesos: el total del documento contra la suma de los renglones.
  const pesos = e.mercancias.map((f) => normalizarNumero(f.peso_kg?.valor ?? '').valor);
  const total = normalizarNumero(e.campos.peso_bruto_total?.valor ?? '').valor;
  if (total !== null && pesos.length > 0 && pesos.every((p): p is number => p !== null) && e.campos.peso_bruto_total.origen !== 'derivado') {
    const suma = pesos.reduce((s, p) => s + p, 0);
    if (Math.abs(total - suma) > Math.max(1, total * 0.005)) {
      reg({ campo: 'peso_bruto_total', renglon: null, severidad: 'confirmar', codigo: 'peso_suma', mensaje: `El peso bruto total (${total} kg) no es la suma de las mercancías (${Math.round(suma * 1000) / 1000} kg). El complemento exige que coincidan.`, relacionados: e.mercancias.map((_, i) => ({ campo: 'peso_kg', renglon: i })) });
    }
  }
  // Cantidad vs peso cuando la unidad es de masa.
  e.mercancias.forEach((fila, i) => {
    const u = fila.clave_unidad?.valor; const q = normalizarNumero(fila.cantidad?.valor ?? '').valor; const p = normalizarNumero(fila.peso_kg?.valor ?? '').valor;
    if ((u === 'KGM' || u === 'TNE') && q !== null && p !== null) {
      const esperado = q * FACTOR_A_KG[u];
      if (Math.abs(esperado - p) > Math.max(1, esperado * 0.01)) {
        reg({ campo: 'peso_kg', renglon: i, severidad: 'confirmar', codigo: 'cantidad_peso', mensaje: `${etiquetaCampo('peso_kg', i)}: la cantidad (${q} ${u}) equivale a ${Math.round(esperado * 1000) / 1000} kg y el peso dice ${p} kg.`, relacionados: [{ campo: 'cantidad', renglon: i }, { campo: 'clave_unidad', renglon: i }] });
      }
    }
    if (fila.valor_mercancia?.valor && !fila.moneda?.valor) {
      reg({ campo: 'moneda', renglon: i, severidad: 'confirmar', codigo: 'moneda_falta', mensaje: `${etiquetaCampo('valor_mercancia', i)}: hay valor pero el documento no dice la moneda. Indícala.` });
    }
    const pu = fila.peso_unidad?.valor;
    if (pu && pu !== 'KGM' && fila.peso_kg?.valor && fila.peso_kg.origen !== 'humano') {
      reg({ campo: 'peso_kg', renglon: i, severidad: 'confirmar', codigo: 'peso_unidad', mensaje: `${etiquetaCampo('peso_kg', i)}: el peso viene en «${pu}», que no se pudo convertir a kg. Escribe el peso en kilogramos.` });
    }
  });
  if (op.remitenteReconocido === false) {
    reg({ campo: 'documento', renglon: null, severidad: 'aviso', codigo: 'remitente_no_reconocido', mensaje: 'El documento llegó de un remitente que no está en la lista del buzón. Revisa que de verdad sea de tu cliente.' });
  }
  if (op.riesgoInyeccion) {
    reg({ campo: 'documento', renglon: null, severidad: 'aviso', codigo: 'inyeccion', mensaje: 'El documento trae texto con forma de instrucción para un modelo de IA. Se ignoró; confirma a mano cada dato crítico.' });
  }

  // Un «confirmar» que un humano ya resolvió deja de contar.
  const vigentes = hallazgos.filter((h) => h.severidad !== 'confirmar' || !confirmado(e, h));
  const bloqueos = vigentes.filter((h) => h.severidad === 'bloqueo').length;
  const porConfirmar = vigentes.filter((h) => h.severidad === 'confirmar').length;
  return { hallazgos: vigentes, bloqueos, porConfirmar, listoParaAprobar: bloqueos === 0 && porConfirmar === 0 };
}

/** La confianza mínima entre los campos críticos PRESENTES (para ordenar la bandeja). `null` si no hay ninguno. */
export function confianzaMinimaCritica(e: Extraccion): number | null {
  const valores: number[] = [];
  for (const def of CAMPOS_DOC) if (def.critico && !esVacio(e.campos[def.clave])) valores.push(e.campos[def.clave].confianza);
  for (const fila of e.mercancias) for (const def of CAMPOS_MERCANCIA) if (def.critico && !esVacio(fila[def.clave])) valores.push(fila[def.clave].confianza);
  return valores.length === 0 ? null : Math.round(Math.min(...valores) * 1000) / 1000;
}
