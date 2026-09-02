// ═══════════════════════════════════════════════════════════════════════════
// COMPLEMENTO CARTA PORTE 3.1 — el clasificador, los 37 campos y el validador.
//
// Fuente: docs/conocimiento/02-carta-porte.md (investigación verificada contra
// RMF 2026 DOF 28-dic-2025, Estándar CCP 3.1 y el Instructivo Autotransporte;
// cada regla de aquí cita su fundamento). Ficha normativa: normas/rmf-2026-2.7.7.yaml.
//
// LO QUE ESTE MÓDULO ES: la mitad DECIDIBLE de la Carta Porte —
//   1. ¿este viaje la necesita? (el árbol de tres entradas de la regla
//      2.7.7.2.1 y la excepción del radio de 30 km de la 2.7.7.2.8);
//   2. ¿qué dato falta y DE QUIÉN ES? (los 37 campos del Apéndice 3 del
//      Instructivo: 19 del cliente, 18 del transportista — la responsabilidad
//      ante el SAT se limita a los datos que aportó cada parte, regla
//      2.7.7.1.1 último párrafo);
//   3. ¿el complemento armado pasaría las validaciones duras del PAC?
//      (sección 8 del Estándar 3.1 — las aritméticas que son rechazo seguro).
//
// LO QUE NO ES: un timbrador. Likida NO timbra (0049): el CFDI de ingreso con
// su complemento lo emite el PAC de la flota. Este módulo prepara y valida
// para que esa emisión no rebote — y para que el contralor sepa, ANTES del
// viaje, qué le falta pedir y a quién.
//
// TODO PURO A PROPÓSITO (sin Supabase): las reglas fiscales se prueban solas,
// sin base. Quien junta los datos reales es `carta_porte_lectura.ts`.
// ═══════════════════════════════════════════════════════════════════════════

// ── 1. ¿Este viaje necesita Carta Porte? ───────────────────────────────────

/**
 * Configuraciones vehiculares (catálogo `c_ConfigAutotransporte`) que NO
 * exceden un camión C2 conforme a la NOM-012-SCT-2-2017.
 *
 * `VL` (vehículo ligero) y `C2` (camión unitario de 2 ejes / 6 llantas) caben
 * seguro. Todo lo que se sabe MAYOR (C3 en adelante, tractocamiones y sus
 * combinaciones) queda fuera seguro. El caso con remolque (C2R2…) la propia
 * regla 2.7.7.2.8 lo admite "siempre que el remolque no exceda las
 * características del C2" — eso no se decide desde un catálogo, así que sale
 * como `null`: CONFÍRMALO, no lo supongas.
 */
const HASTA_C2 = new Set(['VL', 'C2']);
const MAYOR_QUE_C2 = new Set([
  'C3', 'C2R2', 'C3R2', 'C2R3', 'C3R3',
  'T2S1', 'T2S2', 'T2S3', 'T3S1', 'T3S2', 'T3S3',
  'T2S1R2', 'T2S2R2', 'T2S1R3', 'T3S1R2', 'T3S1R3', 'T3S2R2', 'T3S2R3', 'T3S2R4',
  'T2S2S2', 'T3S2S2', 'T3S3S2',
]);
// C2R2/C2R3 van en MAYOR_QUE_C2 y no en la duda: la combinación ya es un
// camión C2 MÁS remolque, y la facilidad del remolque exige verificar pesos
// contra la NOM — el lado seguro es exigir el complemento.

/** `true`/`false` cuando el catálogo alcanza para decidir; `null` = hay que
 *  confirmar contra la NOM-012 (configuración desconocida o caso remolque). */
export function configNoExcedeC2(configVehicular: string | null): boolean | null {
  if (configVehicular === null || configVehicular.trim() === '') return null;
  const c = configVehicular.trim().toUpperCase();
  if (HASTA_C2.has(c)) return true;
  if (MAYOR_QUE_C2.has(c)) return false;
  return null;
}

export interface EntradaDecision {
  /** ¿La ruta pisa carretera de jurisdicción federal? Lo DECLARA quien conoce
   *  la ruta (regla 2.7.7.2.1 exige "plena certeza"); Likida no lo adivina. */
  pisaTramoFederal: boolean | null;
  /** Catálogo `c_ConfigAutotransporte` de la unidad asignada. */
  configVehicular: string | null;
  /** El RADIO en km del tramo federal entre origen inicial y destino final,
   *  incluyendo puntos intermedios (2.7.7.2.8). NO son km lineales: un reparto
   *  con 90 km de federal puede caber en un radio de 25. */
  radioFederalKm: number | null;
  /** Las materias que anulan toda facilidad (2.7.7.2.1 cuarto párrafo y
   *  2.7.7.2.8 tercero): hidrocarburos, medicamentos, despacho aduanero,
   *  transportista extranjero. */
  materiaExcluida: boolean;
}

export interface DecisionCcp {
  necesita: 'si' | 'no' | 'falta_declarar';
  motivo: string;
  fundamento: string;
  /** Lo que falta declarar para poder decidir, cuando aplica. */
  pendientes: string[];
}

/**
 * El árbol de decisión verificado (02-carta-porte.md §12.1a). Tres entradas:
 *
 *   1. ¿pisa tramo federal? NO y sin materia excluida → sin complemento
 *      (regla 2.7.7.2.1; el CFDI de ingreso se emite igual, clave 78101801).
 *   2. SÍ pisa → ¿la unidad no excede un C2? NO → complemento, punto.
 *   3. ≤ C2 → ¿el tramo federal cabe en un RADIO de 30 km? SÍ → se considera
 *      que no transitó por federal (regla 2.7.7.2.8).
 *
 * CON HUECOS NO SE DECIDE. Un "no necesita" adivinado vale una presunción de
 * contrabando (CFF 103-XXII, 3 a 6 años): si falta una entrada, la respuesta
 * es `falta_declarar` con la lista exacta — nunca el lado cómodo.
 */
export function necesitaCartaPorte(e: EntradaDecision): DecisionCcp {
  if (e.materiaExcluida) {
    return {
      necesita: 'si',
      motivo: 'La carga o el caso está excluido de toda facilidad (hidrocarburos, medicamentos, despacho aduanero o transportista extranjero): el complemento se emite aunque el viaje sea local.',
      fundamento: 'RMF 2026, reglas 2.7.7.2.1 cuarto párrafo, 2.7.7.2.4 y 2.7.7.2.8 tercer párrafo',
      pendientes: [],
    };
  }

  if (e.pisaTramoFederal === null) {
    return {
      necesita: 'falta_declarar',
      motivo: 'Nadie ha declarado si la ruta pisa carretera federal. La regla exige "plena certeza" para no emitir el complemento — no se adivina: si por cualquier causa se pisa federal, la obligación revive completa.',
      fundamento: 'RMF 2026, regla 2.7.7.2.1 tercer párrafo',
      pendientes: ['¿La ruta pisa algún tramo de jurisdicción federal?'],
    };
  }

  if (!e.pisaTramoFederal) {
    return {
      necesita: 'no',
      motivo: 'Traslado local: no se pisa tramo federal. El CFDI de ingreso se emite de todas formas (clave 78101801, "en área local") — la facilidad quita el complemento, no la factura.',
      fundamento: 'RMF 2026, regla 2.7.7.2.1; clave del Apéndice 4 del Instructivo',
      pendientes: [],
    };
  }

  const hastaC2 = configNoExcedeC2(e.configVehicular);
  if (hastaC2 === false) {
    return {
      necesita: 'si',
      motivo: `La unidad (${e.configVehicular?.trim().toUpperCase()}) excede un camión C2: pisando federal, el complemento es obligatorio sin excepción que alcance.`,
      fundamento: 'RMF 2026, reglas 2.7.7.1.1 y 2.7.7.2.8 (la excepción es solo hasta C2, NOM-012-SCT-2-2017)',
      pendientes: [],
    };
  }

  const pendientes: string[] = [];
  if (hastaC2 === null) {
    pendientes.push(
      e.configVehicular
        ? `Confirmar contra la NOM-012 que la configuración «${e.configVehicular}» no excede un C2 (el caso con remolque exige verificar pesos y dimensiones)`
        : 'La configuración vehicular de la unidad (catálogo c_ConfigAutotransporte)',
    );
  }
  if (e.radioFederalKm === null) {
    pendientes.push('El radio del tramo federal entre origen inicial y destino final (con puntos intermedios) — es un RADIO geodésico, no kilómetros de odómetro');
  }
  if (pendientes.length > 0) {
    return {
      necesita: 'falta_declarar',
      motivo: 'Pisa federal y la unidad podría caber en la excepción del C2 con radio de 30 km, pero faltan datos para afirmarlo. Sin ellos, lo seguro es tratar el viaje como CON complemento.',
      fundamento: 'RMF 2026, regla 2.7.7.2.8',
      pendientes,
    };
  }

  if ((e.radioFederalKm as number) <= 30) {
    return {
      necesita: 'no',
      motivo: `Unidad hasta C2 y el tramo federal cabe en un radio de ${e.radioFederalKm} km (≤ 30): la regla considera que NO se transitó por federal. Deja rastro de quién midió el radio y cómo — la zona gris real es el método de medición, que el SAT no publica.`,
      fundamento: 'RMF 2026, regla 2.7.7.2.8',
      pendientes: [],
    };
  }

  return {
    necesita: 'si',
    motivo: `El tramo federal sale del radio de 30 km (${e.radioFederalKm} km): la excepción del C2 no alcanza.`,
    fundamento: 'RMF 2026, reglas 2.7.7.1.1 y 2.7.7.2.8',
    pendientes: [],
  };
}

// ── 2. Los 37 datos mínimos, partidos por responsable ──────────────────────

export type ResponsableCcp = 'cliente' | 'transportista';

export interface CampoCcp {
  clave: string;
  rotulo: string;
  responsable: ResponsableCcp;
  /** De dónde lo saca (o lo sacaría) Likida. `null` = hoy no se captura en
   *  ninguna pantalla — y el checklist LO DICE en vez de esconderlo. */
  fuente: string | null;
}

/**
 * Apéndice 3 del Instructivo de llenado CCP 3.1 Autotransporte (pp. 77-78):
 * 19 datos del CLIENTE (contratante) y 18 del TRANSPORTISTA. La regla
 * 2.7.7.1.1 limita la responsabilidad de cada parte A SUS DATOS — esta lista
 * es literalmente el reparto de culpas cuando la Guardia Nacional encuentra
 * una irregularidad, y por eso cada campo dice de quién es.
 */
export const CAMPOS_CCP: ReadonlyArray<CampoCcp> = [
  // ── Los 19 del cliente ──
  // Desde la 0204 los datos del cliente SÍ tienen casilla: los CCP viven en el
  // viaje (`viaje.ccp_*`) y la mercancía en `viaje_mercancia` — la fuente
  // `mercancia.*` es esa tabla. Los dos países son los únicos DERIVADOS: solo
  // cuando la flota declaró "no es internacional" se puede afirmar MEX-MEX.
  { clave: 'transp_internac', rotulo: 'Transporte internacional (Sí/No)', responsable: 'cliente', fuente: 'viaje.ccp_transp_internac' },
  { clave: 'origen_ubicacion', rotulo: 'Origen (ubicación)', responsable: 'cliente', fuente: 'viaje.origen' },
  { clave: 'rfc_remitente', rotulo: 'RFC del remitente', responsable: 'cliente', fuente: 'cliente.rfc' },
  { clave: 'origen_estado', rotulo: 'Estado (domicilio origen)', responsable: 'cliente', fuente: 'viaje.ccp_origen_estado' },
  { clave: 'origen_pais', rotulo: 'País (origen)', responsable: 'cliente', fuente: 'derivado: MEX si se declaró no internacional' },
  { clave: 'origen_cp', rotulo: 'Código postal (origen)', responsable: 'cliente', fuente: 'viaje.ccp_origen_cp' },
  { clave: 'destino_ubicacion', rotulo: 'Destino (ubicación)', responsable: 'cliente', fuente: 'viaje.destino' },
  { clave: 'rfc_destinatario', rotulo: 'RFC del destinatario', responsable: 'cliente', fuente: 'viaje.ccp_rfc_destinatario' },
  { clave: 'destino_estado', rotulo: 'Estado (domicilio destino)', responsable: 'cliente', fuente: 'viaje.ccp_destino_estado' },
  { clave: 'destino_pais', rotulo: 'País (destino)', responsable: 'cliente', fuente: 'derivado: MEX si se declaró no internacional' },
  { clave: 'destino_cp', rotulo: 'Código postal (destino)', responsable: 'cliente', fuente: 'viaje.ccp_destino_cp' },
  { clave: 'peso_bruto_total', rotulo: 'Peso bruto total de la carga', responsable: 'cliente', fuente: 'mercancia.peso_kg (suma)' },
  { clave: 'unidad_peso', rotulo: 'Unidad de peso', responsable: 'cliente', fuente: 'mercancia.peso_kg (KGM)' },
  { clave: 'num_total_mercancias', rotulo: 'Número total de mercancías', responsable: 'cliente', fuente: 'mercancia (conteo)' },
  { clave: 'bienes_transp', rotulo: 'Clave de bienes transportados (c_ClaveProdServCP)', responsable: 'cliente', fuente: 'mercancia.bienes_transp' },
  { clave: 'descripcion_mercancia', rotulo: 'Descripción de la mercancía', responsable: 'cliente', fuente: 'mercancia.descripcion' },
  { clave: 'cantidad', rotulo: 'Cantidad', responsable: 'cliente', fuente: 'mercancia.cantidad' },
  { clave: 'clave_unidad', rotulo: 'Clave de unidad', responsable: 'cliente', fuente: 'mercancia.clave_unidad' },
  { clave: 'peso_en_kg', rotulo: 'Peso en kilogramos (por mercancía)', responsable: 'cliente', fuente: 'mercancia.peso_kg' },
  // ── Los 18 del transportista ──
  { clave: 'version', rotulo: 'Versión del complemento (3.1)', responsable: 'transportista', fuente: 'fija' },
  { clave: 'id_ccp', rotulo: 'IdCCP (folio del complemento)', responsable: 'transportista', fuente: 'generado al emitir' },
  { clave: 'total_dist_rec', rotulo: 'Total de distancia recorrida', responsable: 'transportista', fuente: 'viaje.km_recorridos' },
  { clave: 'fecha_salida', rotulo: 'Fecha y hora de salida', responsable: 'transportista', fuente: 'viaje.fecha_inicio' },
  // La llegada del complemento es ESTIMADA (FechaHoraSalidaLlegada) y se
  // declara al armar el CFDI, no antes: es artefacto de emisión, como el IdCCP.
  { clave: 'fecha_llegada', rotulo: 'Fecha y hora estimada de llegada', responsable: 'transportista', fuente: 'se declara al emitir' },
  { clave: 'distancia_recorrida', rotulo: 'Distancia recorrida (por destino)', responsable: 'transportista', fuente: 'viaje.km_recorridos' },
  { clave: 'perm_sct', rotulo: 'Tipo de permiso SICT', responsable: 'transportista', fuente: 'unidad.permiso_sict_tipo' },
  { clave: 'num_permiso_sct', rotulo: 'Número de permiso SICT', responsable: 'transportista', fuente: 'unidad.permiso_sict_numero' },
  { clave: 'config_vehicular', rotulo: 'Configuración vehicular', responsable: 'transportista', fuente: 'unidad.config_vehicular' },
  { clave: 'peso_bruto_vehicular', rotulo: 'Peso bruto vehicular (toneladas)', responsable: 'transportista', fuente: 'unidad.peso_bruto_ton' },
  { clave: 'placa_vm', rotulo: 'Placa del vehículo', responsable: 'transportista', fuente: 'unidad.placas' },
  { clave: 'anio_modelo', rotulo: 'Año del vehículo', responsable: 'transportista', fuente: 'unidad.anio' },
  { clave: 'aseguradora', rotulo: 'Aseguradora de responsabilidad civil', responsable: 'transportista', fuente: 'unidad.aseguradora_rc' },
  { clave: 'poliza_rc', rotulo: 'Número de póliza de responsabilidad civil', responsable: 'transportista', fuente: 'unidad.poliza_rc_numero' },
  { clave: 'operador_nombre', rotulo: 'Nombre del operador', responsable: 'transportista', fuente: 'operador.nombre' },
  { clave: 'operador_rfc', rotulo: 'RFC del operador', responsable: 'transportista', fuente: 'operador.rfc' },
  { clave: 'num_licencia', rotulo: 'Número de licencia federal del operador', responsable: 'transportista', fuente: 'operador.licencia' },
  { clave: 'nombre_figura', rotulo: 'Nombre de la figura de transporte', responsable: 'transportista', fuente: 'operador.nombre' },
];

export interface EstadoCampoCcp extends CampoCcp {
  /** `true` hay dato, `false` falta, `null` = Likida no lo captura todavía
   *  (que TAMBIÉN es un faltante, pero uno del producto, no de la captura). */
  presente: boolean | null;
  valor: string | null;
}

export interface ChecklistCcp {
  campos: EstadoCampoCcp[];
  faltanCliente: number;
  faltanTransportista: number;
  /** Los 18 del transportista, completos. Los del cliente son responsabilidad
   *  del cliente (2.7.7.1.1) y su hueco se REPORTA, no bloquea el semáforo
   *  del transportista. */
  transportistaListo: boolean;
}

/** Un renglón de `viaje_mercancia` tal cual se capturó. Los nullables son los
 *  campos que el cliente todavía no da — nunca se rellenan por él. */
export interface MercanciaCapturada {
  descripcion: string;
  /** Clave c_ClaveProdServCP (8 dígitos). `null` = el cliente no la ha dado;
   *  JAMÁS se adivina — el catálogo es del SAT y una clave inventada es un
   *  complemento con dato falso. */
  bienesTransp: string | null;
  cantidad: number;
  claveUnidad: string | null;
  pesoKg: number | null;
  /** `null` = NO DECLARADO (contrato de la 0204): un false supuesto decidiría
   *  por su cuenta que AseguraMedAmbiente no aplica. */
  materialPeligroso: boolean | null;
}

/** Los valores con los que se llena el checklist. Todo nullable: la ausencia
 *  es un estado, no un error. */
export interface DatosChecklist {
  viaje: { origen: string | null; destino: string | null; fechaInicio: string | null; kmRecorridos: number | null };
  clienteRfc: string | null;
  unidad: {
    placas: string | null; anio: number | null;
    configVehicular: string | null; pesoBrutoTon: number | null;
    aseguradoraRc: string | null; polizaRcNumero: string | null;
    permisoSictTipo: string | null; permisoSictNumero: string | null;
  } | null;
  operador: { nombre: string | null; rfc: string | null; licencia: string | null } | null;
  /** Los datos CCP capturados en el viaje (0204). Opcionales para no romper a
   *  los llamadores que aún no los juntan — ausentes cuentan como faltantes. */
  ccpViaje?: {
    origenCp: string | null; destinoCp: string | null;
    origenEstado: string | null; destinoEstado: string | null;
    rfcDestinatario: string | null; transpInternac: boolean | null;
  } | null;
  mercancias?: MercanciaCapturada[];
}

const texto = (v: string | number | null | undefined): string | null =>
  v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim();

const redondea3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Suma de pesos SOLO cuando hay renglones y TODOS traen peso: una suma
 *  parcial se leería como el peso bruto total y no lo es. */
export function pesoBrutoDe(mercancias: MercanciaCapturada[]): number | null {
  if (mercancias.length === 0 || mercancias.some((m) => m.pesoKg === null)) return null;
  return redondea3(mercancias.reduce((s, m) => s + (m.pesoKg as number), 0));
}

export function checklistCcp(d: DatosChecklist): ChecklistCcp {
  const ccp = d.ccpViaje ?? null;
  const mercs = d.mercancias ?? [];
  const pesoTotal = pesoBrutoDe(mercs);
  const todas = (f: (m: MercanciaCapturada) => string | null): string | null => {
    if (mercs.length === 0) return null;
    const vals = mercs.map(f);
    if (vals.some((v) => texto(v) === null)) return null;
    return [...new Set(vals.map((v) => String(v).trim()))].join(', ');
  };

  // El valor de cada campo capturable, por clave. Un campo sin entrada aquí es
  // uno que Likida no captura todavía (`presente: null`).
  const valores: Record<string, string | null> = {
    origen_ubicacion: texto(d.viaje.origen),
    destino_ubicacion: texto(d.viaje.destino),
    rfc_remitente: texto(d.clienteRfc),
    // Los del cliente con casilla desde la 0204. El país solo se deriva con la
    // declaración "no internacional" en la mano — sin ella, ni MEX se supone.
    transp_internac: ccp?.transpInternac === true ? 'Sí' : ccp?.transpInternac === false ? 'No' : null,
    origen_estado: texto(ccp?.origenEstado ?? null),
    origen_cp: texto(ccp?.origenCp ?? null),
    origen_pais: ccp?.transpInternac === false ? 'MEX' : null,
    destino_estado: texto(ccp?.destinoEstado ?? null),
    destino_cp: texto(ccp?.destinoCp ?? null),
    destino_pais: ccp?.transpInternac === false ? 'MEX' : null,
    rfc_destinatario: texto(ccp?.rfcDestinatario ?? null),
    peso_bruto_total: pesoTotal === null ? null : `${pesoTotal} kg`,
    unidad_peso: pesoTotal === null ? null : 'KGM',
    num_total_mercancias: mercs.length > 0 ? String(mercs.length) : null,
    bienes_transp: todas((m) => m.bienesTransp),
    descripcion_mercancia: todas((m) => m.descripcion),
    cantidad: todas((m) => String(m.cantidad)),
    clave_unidad: todas((m) => m.claveUnidad),
    peso_en_kg: todas((m) => (m.pesoKg === null ? null : String(m.pesoKg))),
    version: '3.1',
    id_ccp: 'se genera al emitir',
    fecha_llegada: 'se declara al emitir',
    total_dist_rec: texto(d.viaje.kmRecorridos),
    fecha_salida: texto(d.viaje.fechaInicio),
    distancia_recorrida: texto(d.viaje.kmRecorridos),
    perm_sct: texto(d.unidad?.permisoSictTipo ?? null),
    num_permiso_sct: texto(d.unidad?.permisoSictNumero ?? null),
    config_vehicular: texto(d.unidad?.configVehicular ?? null),
    peso_bruto_vehicular: texto(d.unidad?.pesoBrutoTon ?? null),
    placa_vm: texto(d.unidad?.placas ?? null),
    anio_modelo: texto(d.unidad?.anio ?? null),
    aseguradora: texto(d.unidad?.aseguradoraRc ?? null),
    poliza_rc: texto(d.unidad?.polizaRcNumero ?? null),
    operador_nombre: texto(d.operador?.nombre ?? null),
    operador_rfc: texto(d.operador?.rfc ?? null),
    num_licencia: texto(d.operador?.licencia ?? null),
    nombre_figura: texto(d.operador?.nombre ?? null),
  };

  const campos: EstadoCampoCcp[] = CAMPOS_CCP.map((c) => {
    if (c.fuente === null) return { ...c, presente: null, valor: null };
    const valor = valores[c.clave] ?? null;
    return { ...c, presente: valor !== null, valor };
  });

  // Un campo sin captura en el producto CUENTA como faltante de su
  // responsable: el hueco existe aunque el software no tenga la casilla.
  const falta = (r: ResponsableCcp) => campos.filter((c) => c.responsable === r && c.presente !== true).length;
  const faltanCliente = falta('cliente');
  const faltanTransportista = falta('transportista');
  return { campos, faltanCliente, faltanTransportista, transportistaListo: faltanTransportista === 0 };
}

// ── 3. Las validaciones duras del Estándar 3.1 (rechazo seguro del PAC) ────

export interface MercanciaCcp {
  bienesTransp: string;
  descripcion: string;
  cantidad: number;
  claveUnidad: string;
  pesoEnKg: number;
  materialPeligroso?: boolean;
}

export interface UbicacionCcp {
  tipo: 'Origen' | 'Destino';
  rfc: string;
  fechaHora: string;
  distanciaRecorrida?: number | null;
}

export interface FiguraCcp {
  tipoFigura: '01' | '02' | '03' | '04' | '05';
  nombre: string;
  numLicencia?: string | null;
  tienePartesTransporte?: boolean;
}

export interface ComplementoBorrador {
  tipoComprobante: 'I' | 'T';
  totalDistRec: number;
  pesoBrutoTotal: number;
  numTotalMercancias: number;
  mercancias: MercanciaCcp[];
  ubicaciones: UbicacionCcp[];
  placaVm: string;
  aseguraMedAmbiente?: string | null;
  figuras: FiguraCcp[];
  /** Solo para tipo `T`: */
  subTotal?: number;
  total?: number;
  moneda?: string;
  rfcEmisor?: string;
  rfcReceptor?: string;
  usoCfdi?: string;
}

export interface FallaCcp {
  campo: string;
  detalle: string;
  fundamento: string;
}

const PLACA_RE = /^[A-Z0-9]{5,7}$/i;

/**
 * Las validaciones aritméticas y estructurales que el PAC rechaza SEGURO
 * (Estándar CCP 3.1, sección 8; destiladas en 02-carta-porte.md §12.1c).
 * Correrlas antes de mandar nada al PAC convierte "rebotó el timbrado con el
 * viaje ya entregado" en "te faltó esto, antes de salir".
 */
export function validarComplemento(c: ComplementoBorrador): FallaCcp[] {
  const fallas: FallaCcp[] = [];
  const F = 'Estándar CCP 3.1, sección 8';

  const sumaPesos = c.mercancias.reduce((s, m) => s + m.pesoEnKg, 0);
  if (Math.abs(c.pesoBrutoTotal - sumaPesos) > 0.001) {
    fallas.push({ campo: 'PesoBrutoTotal', detalle: `Debe ser exactamente la suma de los PesoEnKg (${sumaPesos.toFixed(3)}); trae ${c.pesoBrutoTotal}.`, fundamento: F });
  }
  if (c.numTotalMercancias !== c.mercancias.length) {
    fallas.push({ campo: 'NumTotalMercancias', detalle: `Debe ser el número de nodos Mercancia (${c.mercancias.length}); trae ${c.numTotalMercancias}.`, fundamento: F });
  }

  const destinos = c.ubicaciones.filter((u) => u.tipo === 'Destino');
  if (c.ubicaciones.filter((u) => u.tipo === 'Origen').length < 1 || destinos.length < 1) {
    fallas.push({ campo: 'Ubicaciones', detalle: 'Con autotransporte se exigen al menos una ubicación Origen y una Destino.', fundamento: F });
  }
  const sinDistancia = destinos.filter((u) => u.distanciaRecorrida === null || u.distanciaRecorrida === undefined);
  if (sinDistancia.length > 0) {
    fallas.push({ campo: 'DistanciaRecorrida', detalle: `Obligatoria en CADA ubicación Destino cuando hay Autotransporte; falta en ${sinDistancia.length}.`, fundamento: F });
  } else {
    const sumaDist = destinos.reduce((s, u) => s + (u.distanciaRecorrida as number), 0);
    if (Math.abs(c.totalDistRec - sumaDist) > 0.01) {
      fallas.push({ campo: 'TotalDistRec', detalle: `Debe ser la suma de las DistanciaRecorrida de los Destinos (${sumaDist}); trae ${c.totalDistRec}.`, fundamento: F });
    }
  }

  if (!PLACA_RE.test(c.placaVm)) {
    fallas.push({ campo: 'PlacaVM', detalle: `"${c.placaVm}" no cumple: 5 a 7 caracteres alfanuméricos, SIN guiones ni espacios.`, fundamento: F });
  }

  const hayPeligroso = c.mercancias.some((m) => m.materialPeligroso === true);
  if (hayPeligroso && texto(c.aseguraMedAmbiente ?? null) === null) {
    fallas.push({ campo: 'AseguraMedAmbiente', detalle: 'Obligatoria cuando alguna mercancía es material peligroso.', fundamento: F });
  }

  if (!c.figuras.some((f) => f.tipoFigura === '01')) {
    fallas.push({ campo: 'FiguraTransporte', detalle: 'Debe existir al menos una figura TipoFigura=01 (Operador).', fundamento: F });
  }
  for (const f of c.figuras) {
    const licencia = texto(f.numLicencia ?? null);
    if (f.tipoFigura === '01' && licencia === null) {
      fallas.push({ campo: 'NumLicencia', detalle: `El operador "${f.nombre}" no trae número de licencia, y para TipoFigura=01 es obligatorio (6 a 16 caracteres).`, fundamento: F });
    }
    if (f.tipoFigura !== '01' && licencia !== null) {
      fallas.push({ campo: 'NumLicencia', detalle: `"${f.nombre}" (TipoFigura=${f.tipoFigura}) trae licencia, y fuera del operador DEBE omitirse.`, fundamento: F });
    }
    const partes = f.tienePartesTransporte === true;
    if ((f.tipoFigura === '02' || f.tipoFigura === '03') && !partes) {
      fallas.push({ campo: 'PartesTransporte', detalle: `Obligatorio para TipoFigura=${f.tipoFigura} (propietario/arrendador).`, fundamento: F });
    }
    if (f.tipoFigura !== '02' && f.tipoFigura !== '03' && partes) {
      fallas.push({ campo: 'PartesTransporte', detalle: `Debe omitirse fuera de propietario/arrendador (trae TipoFigura=${f.tipoFigura}).`, fundamento: F });
    }
  }

  if (c.tipoComprobante === 'T') {
    if ((c.subTotal ?? NaN) !== 0) fallas.push({ campo: 'SubTotal', detalle: 'En CFDI de traslado debe ser cero.', fundamento: F });
    if ((c.total ?? NaN) !== 0) fallas.push({ campo: 'Total', detalle: 'En CFDI de traslado debe ser cero.', fundamento: F });
    if (c.moneda !== 'XXX') fallas.push({ campo: 'Moneda', detalle: 'En CFDI de traslado debe ser XXX.', fundamento: F });
    if (texto(c.rfcEmisor ?? null) === null || c.rfcEmisor !== c.rfcReceptor) {
      fallas.push({ campo: 'Receptor.Rfc', detalle: 'En CFDI de traslado el receptor debe ser el MISMO RFC que el emisor.', fundamento: F });
    }
    if (c.usoCfdi !== 'S01') fallas.push({ campo: 'UsoCFDI', detalle: 'En CFDI de traslado debe ser S01 "Sin efectos fiscales".', fundamento: F });
  } else if (c.moneda === 'XXX') {
    fallas.push({ campo: 'Moneda', detalle: 'En CFDI de ingreso la moneda debe ser DISTINTA de XXX.', fundamento: F });
  }

  return fallas;
}

// ── 4. Armar el borrador desde lo capturado ────────────────────────────────

export interface ResultadoBorrador {
  /** `null` mientras falte algo ESTRUCTURAL: no se arma un complemento a
   *  medias que después alguien tome por completo. */
  borrador: ComplementoBorrador | null;
  /** Lo que impide armar el borrador, en el idioma del que lo va a pedir. */
  faltantes: string[];
  /** Lo que no bloquea pero el contralor debe saber antes de emitir. */
  advertencias: string[];
  /** `validarComplemento` sobre el borrador armado; vacío si no se armó. */
  fallas: FallaCcp[];
}

/**
 * Convierte lo capturado (viaje + mercancías + unidad + operador) en un
 * `ComplementoBorrador` tipo INGRESO y lo pasa por el validador de rechazo
 * seguro. Fase C del blueprint: el entregable es el BORRADOR VALIDADO — el
 * timbrado no existe aquí (0049) y la fecha estimada de llegada es artefacto
 * de emisión, igual que el IdCCP.
 *
 * PURO: los datos llegan por argumento; los junta `carta_porte_datos.ts`.
 */
export function armarBorrador(d: DatosChecklist): ResultadoBorrador {
  const faltantes: string[] = [];
  const advertencias: string[] = [];
  const mercs = d.mercancias ?? [];
  const ccp = d.ccpViaje ?? null;

  if (mercs.length === 0) {
    faltantes.push('Ningún renglón de mercancía capturado — el complemento exige al menos uno, con clave, cantidad, unidad y peso.');
  } else {
    const sinClave = mercs.filter((m) => texto(m.bienesTransp) === null).length;
    const sinUnidad = mercs.filter((m) => texto(m.claveUnidad) === null).length;
    const sinPeso = mercs.filter((m) => m.pesoKg === null).length;
    if (sinClave > 0) faltantes.push(`${sinClave} renglón(es) de mercancía sin clave c_ClaveProdServCP — la clave la da tu cliente contra el catálogo del SAT; no se inventa.`);
    if (sinUnidad > 0) faltantes.push(`${sinUnidad} renglón(es) sin clave de unidad (catálogo c_ClaveUnidad, p. ej. KGM, H87, XBX).`);
    if (sinPeso > 0) faltantes.push(`${sinPeso} renglón(es) sin peso en kilogramos — sin todos los pesos no hay PesoBrutoTotal.`);
  }

  if (texto(d.clienteRfc) === null) faltantes.push('RFC del remitente — se captura en Clientes.');
  if (texto(ccp?.rfcDestinatario ?? null) === null) faltantes.push('RFC del destinatario — se captura en los datos del cliente del viaje.');
  if (texto(d.viaje.fechaInicio) === null) faltantes.push('Fecha y hora de salida del viaje.');
  if (d.viaje.kmRecorridos === null) faltantes.push('Kilómetros del viaje (TotalDistRec y DistanciaRecorrida del destino).');
  if (texto(d.unidad?.placas ?? null) === null) faltantes.push('Placas de la unidad — se capturan en Unidades.');
  if (texto(d.operador?.nombre ?? null) === null) faltantes.push('Operador asignado con nombre — se captura en Operadores.');

  const sinDeclararPeligroso = mercs.filter((m) => m.materialPeligroso === null).length;
  if (sinDeclararPeligroso > 0) {
    advertencias.push(`${sinDeclararPeligroso} renglón(es) sin declarar si son material peligroso. Un «no» no se supone: si alguno lo es, el complemento exige la póliza de medio ambiente (AseguraMedAmbiente).`);
  }
  if (mercs.some((m) => m.materialPeligroso === true)) {
    advertencias.push('Hay material peligroso declarado: AseguraMedAmbiente no tiene casilla en Likida todavía — la póliza de medio ambiente se declara al emitir, y el validador lo marca abajo.');
  }

  if (faltantes.length > 0) return { borrador: null, faltantes, advertencias, fallas: [] };

  const mercancias: MercanciaCcp[] = mercs.map((m) => ({
    bienesTransp: (m.bienesTransp as string).trim(),
    descripcion: m.descripcion.trim(),
    cantidad: m.cantidad,
    claveUnidad: (m.claveUnidad as string).trim(),
    pesoEnKg: m.pesoKg as number,
    ...(m.materialPeligroso === null ? {} : { materialPeligroso: m.materialPeligroso }),
  }));

  const borrador: ComplementoBorrador = {
    // INGRESO: la flota cobra el flete y el complemento viaja en su CFDI de
    // ingreso (2.7.7.1.1). El caso traslado (dedicado, 2.7.7.1.3) se ADVIERTE
    // aparte — la P40 del fiscalista sigue abierta y aquí no se decide.
    tipoComprobante: 'I',
    totalDistRec: d.viaje.kmRecorridos as number,
    pesoBrutoTotal: pesoBrutoDe(mercs) as number,
    numTotalMercancias: mercancias.length,
    mercancias,
    ubicaciones: [
      { tipo: 'Origen', rfc: (d.clienteRfc as string).trim(), fechaHora: (d.viaje.fechaInicio as string).trim() },
      // La fecha de llegada es ESTIMADA y se declara al emitir (mismo contrato
      // que el checklist); la distancia sí es dato del viaje.
      { tipo: 'Destino', rfc: (ccp?.rfcDestinatario as string).trim(), fechaHora: 'se declara al emitir', distanciaRecorrida: d.viaje.kmRecorridos },
    ],
    placaVm: (d.unidad?.placas as string).trim(),
    aseguraMedAmbiente: null,
    figuras: [{
      tipoFigura: '01',
      nombre: (d.operador?.nombre as string).trim(),
      numLicencia: texto(d.operador?.licencia ?? null),
    }],
  };

  return { borrador, faltantes, advertencias, fallas: validarComplemento(borrador) };
}

// ── El IdCCP ───────────────────────────────────────────────────────────────

/**
 * Folio propio del complemento (novedad de la 3.1): 36 caracteres conforme a
 * RFC 4122 con los tres primeros SIEMPRE `CCC`. Es requerido, entra a la
 * cadena original que sella el emisor, y lo genera el sistema que expide —
 * o sea, esto. (Estándar CCP 3.1, atributo IdCCP; FAQ pregunta 6.)
 */
export function generarIdCcp(): string {
  const uuid = globalThis.crypto.randomUUID();
  return `CCC${uuid.slice(3)}`;
}

export const ID_CCP_RE = /^CCC[0-9a-f]{5}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
