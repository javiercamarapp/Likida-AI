import { describe, it, expect } from 'vitest';
import { prioridadDe, type ContextoPrioridad, type NivelPrioridad } from './prioridad';
import { evaluarMolestia } from './molestia';

// Mensajes SINTÉTICOS (sin datos reales). Precisión sobre chats reales: SIN MEDIR (falta B5).
type Caso = [texto: string, esperado: NivelPrioridad, contexto?: ContextoPrioridad];
const TABLA: Caso[] = [
  // alta: urgencia
  ['Necesito la caja ASAP', 2],
  ['asap por favor', 2],
  ['Lo necesito A.S.A.P.', 2],
  ['Es urgente, el cliente espera', 2],
  ['URGENTE', 2],
  ['Mándame la ubicación lo antes posible', 2],
  ['Confírmame de inmediato', 2],
  ['Lo necesito ya mismo', 2],
  ['Respóndeme ya!', 2],
  // alta: pregunta directa
  ['¿Dónde va mi viaje?', 2],
  ['¿ya salió?', 2],
  ['cuándo llega?', 2],
  ['¿Me confirmas la cita?', 2],
  ['gracias, ¿y la caja?', 2],
  ['???', 2],
  // ignorar: monitoreo
  ['UNIDAD 4521 DETENIDA 45 min en patio', 0],
  ['UNIDAD 10 DETENIDA\nUNIDAD 22 DETENIDA\nUNIDAD 31 DETENIDA', 0],
  ['Alerta: unidad 77 detenida en caseta', 0],
  // ignorar: cortesía
  ['gracias', 0],
  ['Muchas gracias', 0],
  ['ok', 0],
  ['Enterado', 0],
  ['👍', 0],
  ['Ok, gracias', 0],
  ['gracias, ASAP no hace falta', 0],
  // ignorar: sticker y vacío
  ['', 0, { sticker: true }],
  ['', 0],
  // normal
  ['Adjunto el pedimento', 1],
  ['', 1, { adjunto: true }],
  ['Les paso el número de pedido 123 para el viaje de mañana', 1],
  ['sin prisa, cuando puedan nos dicen algo', 1],
];

describe('prioridadDe: tabla sintética de 30+ mensajes', () => {
  it.each(TABLA)('%j → %i', (texto, esperado, contexto) => {
    expect(prioridadDe(texto, contexto).nivel).toBe(esperado);
  });
  it('la tabla tiene al menos 30 casos', () => {
    expect(TABLA.length).toBeGreaterThanOrEqual(30);
  });
});

describe('prioridadDe: reglas y guardias', () => {
  it('«ya» suelto sin exclamación no es urgencia', () => {
    expect(prioridadDe('ya vi la caja').nivel).toBe(1);
  });
  it('el apremio negado con contenido real queda en normal', () => {
    const r = prioridadDe('ASAP no hace falta, mañana paso por los documentos');
    expect(r.nivel).toBe(1);
    expect(r.motivos).toContain('apremio_negado');
  });
  it('pregunta con negación de apremio sigue siendo pregunta (alta)', () => {
    expect(prioridadDe('no es urgente, ¿me confirmas?').nivel).toBe(2);
  });
  it('los motivos son categorías, nunca el texto', () => {
    const texto = 'URGENTE la caja del folio F-1042 ¿dónde está?';
    const r = prioridadDe(texto);
    expect(r.motivos).toEqual(['urgencia', 'pregunta']);
    expect(JSON.stringify(r)).not.toContain('F-1042');
  });
  it('es determinista', () => {
    expect(prioridadDe('Necesito esto ASAP')).toEqual(prioridadDe('Necesito esto ASAP'));
  });
  it('el sticker gana sobre cualquier texto', () => {
    expect(prioridadDe('urgente', { sticker: true }).nivel).toBe(0);
  });
  it('devuelve solo { nivel, motivos }: no hay campo de envío al cliente', () => {
    expect(Object.keys(prioridadDe('urgente')).sort()).toEqual(['motivos', 'nivel']);
  });
});

describe('«?» simple no suma molestia; ASAP suma +1 leve', () => {
  const base = { intencion: 'ubicacion' as const, entradasSinRespuesta: 1, minutosEsperando: 0, slaRespuestaMin: 30 };
  it('«?» simple: molestia nivel 0', () => {
    expect(evaluarMolestia({ ...base, texto: '¿Dónde va mi viaje?' })).toEqual({ nivel: 0, puntos: 0, motivos: [] });
    expect(evaluarMolestia({ ...base, texto: 'cuando llega?' }).nivel).toBe(0);
  });
  it('ASAP y A.S.A.P. = +1 leve', () => {
    for (const texto of ['Lo necesito ASAP', 'lo necesito a.s.a.p.']) {
      const r = evaluarMolestia({ ...base, texto });
      expect(r.nivel).toBe(1);
      expect(r.puntos).toBe(1);
      expect(r.motivos).toEqual(['lenguaje_de_molestia']);
    }
  });
});
