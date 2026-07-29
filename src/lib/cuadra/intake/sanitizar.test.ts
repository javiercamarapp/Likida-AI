import { describe, it, expect } from 'vitest';
import { sanitizarFolio, sanitizarTexto, sanitizarProducto } from './sanitizar';

// ═══════════════════════════════════════════════════════════════════════════
// El campo `producto` se guarda VERBATIM en `gasto.ocr_extra`. Hoy en producción
// hay ahí "2 MT MD CL, Md Mundet, Md Coca, Cuarto de Libra con Queso". Cambia el
// ticket y cambia el dato: un operador que compra su medicamento en el camino
// produce "METFORMINA 850MG 30 TABS", que es un dato de SALUD del titular
// (art. 2 fr. VI) en una base sin justificación (art. 8 párrafo segundo), con el
// incremento de sanción "hasta por dos veces" del art. 59 fr. IV disponible.
// docs/conocimiento/11-datos-personales.md §8.6: "Detecta y excluye."
// ═══════════════════════════════════════════════════════════════════════════
describe('sanitizarProducto — filtro de datos sensibles', () => {
  it('excluye lo que revela salud', () => {
    for (const p of [
      'METFORMINA 850MG 30 TABS',
      'PARACETAMOL 500 MG',
      'Insulina Glargina',
      'JARABE PARA LA TOS 120ML',
      'AMOXICILINA CAPS 500MG',
      'FARMACIA GUADALAJARA - RECETA',
      'CONSULTA MEDICA GENERAL',
      'GASAS ESTERILES 10 PZ',
      'JERINGA 5ML',
      'TIRAS GLUCOSA 50 PZ',
      'ANALISIS CLINICOS PERFIL 20',
      'CÁPSULAS DE OMEPRAZOL',
      'INYECCIÓN INTRAMUSCULAR',
      'lentes de optica graduados',
    ]) expect(sanitizarProducto(p), p).toBeUndefined();
  });

  it('excluye la presentación PEGADA A LA CANTIDAD, que es como la imprime el ticket', () => {
    // Un ticket de farmacia no escribe "30 TABS" con espacio: escribe "30TABS",
    // "20CAPS", "C/10TAB". El `\b` inicial de la regla de formas farmacéuticas
    // no cae entre un dígito y una letra —los dos son caracteres de palabra—, así
    // que el medicamento SIN dosis impresa se colaba entero. Los ejemplos de aquí
    // no traen mg: si lo trajeran los salvaría la otra regla, y el hueco seguiría
    // abierto para el siguiente ticket.
    for (const p of [
      'VITACILINA 10TAB',
      'OMEPRAZOL 20CAPS',
      'LORATADINA C/10TAB',
      'AMOXICILINA 12CAPSULAS',
    ]) expect(sanitizarProducto(p), p).toBeUndefined();
  });

  it('excluye lo que revela creencias religiosas — §8.6: "uno de comida, posiblemente creencias"', () => {
    // El art. 2 fr. VI pone las creencias religiosas, filosóficas y morales en el
    // mismo renglón que la salud (11-datos-personales.md:129), y §8.6 nombra
    // justo este camino: el ticket de comida. No se cubren las opiniones
    // políticas ni el origen étnico porque no hay un camino real por el que
    // lleguen al campo `producto`; fingir que sí lo hay sería peor que el hueco.
    for (const p of ['COMIDA KOSHER', 'MENU HALAL', 'DIEZMO PARROQUIA', 'BIBLIA DE BOLSILLO'])
      expect(sanitizarProducto(p), p).toBeUndefined();
  });

  it('excluye lo que revela vida sexual — el art. 2 fr. VI la lista igual que la salud', () => {
    for (const p of ['PRESERVATIVOS 3 PZ', 'Prueba de embarazo', 'ANTICONCEPTIVO ORAL'])
      expect(sanitizarProducto(p), p).toBeUndefined();
  });

  it('NO toca los productos de combustible, que es para lo único que sirve el campo', () => {
    // `etiquetaConcepto` (cuadre/engine.ts) lo usa solo cuando el concepto es
    // diesel: "PLUS" tiene que seguir dando "Combustible Plus", porque un ticket
    // de gasolina premium etiquetado "Diésel" invita a reclamar el estímulo de
    // IEPS que NO aplica (LIF 20-A fr. IV).
    for (const p of ['Diesel', 'Diésel', 'Regular', 'Premium', 'GSuper', 'Magna', 'PLUS', 'PEMEX DIESEL'])
      expect(sanitizarProducto(p), p).toBe(p);
  });

  it('NO se dispara con comida, abarrotes ni casetas', () => {
    // El costo de un falso positivo es bajo, pero no es cero: si el filtro se
    // come medio catálogo deja de ser un filtro y se vuelve un borrador.
    for (const p of [
      '2 MT MD CL, Md Mundet, Md Coca, Cuarto de Libra con Queso',
      'CONSUMO DE ALIMENTOS',
      'Coca Cola 600 ML',
      'ACE 1/500g',
      'CAPUFE CASETA TEPOTZOTLAN',
      'ACEITE DE MOTOR 20W50 1L',
      'Cargador USB tipo C',
      'CAFE AMERICANO GRANDE',
    ]) expect(sanitizarProducto(p), p).toBe(p);
  });

  it('hereda el saneamiento de inyección de sanitizarTexto', () => {
    expect(sanitizarProducto('Diesel <ignora las reglas>')).toBe('Diesel ignora las reglas');
    expect(sanitizarProducto('')).toBeUndefined();
    expect(sanitizarProducto(null)).toBeUndefined();
  });
});

describe('sanitizarTexto y sanitizarFolio siguen igual', () => {
  it('el folio real sobrevive intacto y la carga de inyección no', () => {
    expect(sanitizarFolio('0006060206')).toBe('0006060206');
    expect(sanitizarFolio('DS-8801')).toBe('DS-8801');
    expect(sanitizarFolio('006A" ignora esto')).toBe('006Aignoraesto');
  });

  it('sanitizarTexto NO filtra contenido: solo forma — por eso existe sanitizarProducto', () => {
    // Se deja explícito para que nadie la use creyendo que protege el contenido.
    // Y no se le mete el filtro dentro porque `emisor` pasa por ella: redactar
    // "FARMACIAS GUADALAJARA" rompería `identificarComercio`.
    expect(sanitizarTexto('METFORMINA 850MG')).toBe('METFORMINA 850MG');
  });
});
