// ═══════════════════════════════════════════════════════════════════════════
// CONVENIOS DE CLIENTE — el vocabulario (0580). Sin I/O.
//
// Todo nace del convenio: punto A→B, tarifa, requisitos de cobro y las
// INSTRUCCIONES DE OPERACIÓN (la «calle de instrucciones»): qué puerta, con quién
// reportarse, peculiaridades de la planta, qué documentos llevar. Al despachar el
// viaje, las instrucciones vigentes se FOTOGRAFÍAN en `viaje_convenio` y de ahí
// salen al operador por WhatsApp (al despachar y al acercarse a la planta), a la
// pregunta «¿por dónde entro?» y a la exportación para el sistema de la flota.
// ═══════════════════════════════════════════════════════════════════════════

export const CATEGORIAS = ['puerta', 'reportarse', 'peculiaridad', 'documentos', 'horario', 'seguridad', 'otro'] as const;
export type Categoria = typeof CATEGORIAS[number];

export const MOMENTOS = ['despacho', 'acercamiento', 'ambos'] as const;
export type Momento = typeof MOMENTOS[number];

export const LUGARES = ['origen', 'destino', 'ambos'] as const;
export type Lugar = typeof LUGARES[number];

/** Cómo se le dice a cada categoría al operador (voz del chofer, tuteo). */
export const ETIQUETA_CATEGORIA: Readonly<Record<Categoria, string>> = {
  puerta: 'Por dónde entras',
  reportarse: 'Con quién te reportas',
  peculiaridad: 'Ten en cuenta',
  documentos: 'Documentos que llevas',
  horario: 'Horario',
  seguridad: 'Seguridad',
  otro: 'Otro',
};

export const MAX_TEXTO_INSTRUCCION = 400;
export const MAX_INSTRUCCIONES_POR_CONVENIO = 40;

/** Una línea de la calle de instrucciones, tal como vive en el convenio y en la foto del viaje. */
export interface Instruccion {
  categoria: Categoria;
  texto: string;
  momento: Momento;
  lugar: Lugar;
  orden: number;
}

export const esCategoria = (v: unknown): v is Categoria => typeof v === 'string' && (CATEGORIAS as readonly string[]).includes(v);
export const esMomento = (v: unknown): v is Momento => typeof v === 'string' && (MOMENTOS as readonly string[]).includes(v);
export const esLugar = (v: unknown): v is Lugar => typeof v === 'string' && (LUGARES as readonly string[]).includes(v);

export const MODOS_TARIFA = ['por_viaje', 'por_km', 'por_tonelada'] as const;
export type ModoTarifa = typeof MODOS_TARIFA[number];

/** El lado del viaje al que se acerca o en el que está el operador. */
export type LadoViaje = 'origen' | 'destino';

/**
 * Lee con tolerancia la foto guardada en `viaje_convenio.instrucciones` (jsonb): la base la acota a un arreglo,
 * pero lo que hay adentro lo escribió el servidor y se vuelve a validar aquí — una fila rara se descarta, no truena.
 */
export function leerFoto(crudo: unknown): Instruccion[] {
  if (!Array.isArray(crudo)) return [];
  const salida: Instruccion[] = [];
  for (const x of crudo.slice(0, MAX_INSTRUCCIONES_POR_CONVENIO)) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    if (!esCategoria(o.categoria) || typeof o.texto !== 'string') continue;
    const texto = o.texto.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXTO_INSTRUCCION);
    if (texto === '') continue;
    salida.push({
      categoria: o.categoria,
      texto,
      momento: esMomento(o.momento) ? o.momento : 'ambos',
      lugar: esLugar(o.lugar) ? o.lugar : 'ambos',
      orden: typeof o.orden === 'number' && Number.isFinite(o.orden) ? o.orden : 0,
    });
  }
  return salida;
}
