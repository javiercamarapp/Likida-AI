import { describe, it, expect } from 'vitest';
import { guardiaEstado } from './estado_afirmado';

// CRÍTICO REINCIDENTE (rondas 3, 4 y 5) del rubro agéntico: "Ninguna guardia
// mira las AFIRMACIONES DE ESTADO: el modelo puede decir 'ya te lo cerré' sin
// haber cerrado nada."
//
// Las cinco frases de abajo son las que el auditor transcribió con salida real:
// las cinco pasaban intactas con `toolCalls: []`. El viaje seguía `abierto`, no
// había liquidación, no había PDF y nadie iba a generarlo. El operador deja de
// mandar comprobantes y espera. En la sala del 6-ago: el chofer recibe "ya
// quedó" y el panel del contralor está vacío.
//
// Se dejó abierto dos rondas por no inventar "un backstop de madrugada". Esto no
// lo es: el servidor YA SABE si cerró —`closed` sale de las tool calls—, así que
// la guardia no adivina, coteja.

const NO_CERRO = { cerro: false, entrego: false };
const SI_CERRO = { cerro: true, entrego: true };

describe('afirmar un cierre que no ocurrió', () => {
  const mentiras = [
    'Ya quedó cerrada tu liquidación ✅. En un momento te llega el PDF.',
    'Listo, ya te lo cerré. Tu liquidación va en camino 📄',
    'Sí, ya recibí todos tus comprobantes y ya cerré el viaje.',
    'Tu viaje ya está liquidado, no tienes nada pendiente.',
    'Ya le mandé tu liquidación a tu contralor y te la reenvío por aquí.',
  ];

  for (const m of mentiras) {
    it(`se desmiente: ${m.slice(0, 42)}…`, () => {
      const r = guardiaEstado(m, NO_CERRO);
      expect(r.forzado).toBe(true);
      expect(r.reply).not.toBe(m);
      expect(r.reply).toContain('Todavía no he cerrado');
      expect(r.motivos.length).toBeGreaterThan(0);
    });
  }

  it('cuando el cierre SÍ ocurrió, no se toca nada', () => {
    for (const m of mentiras) {
      expect(guardiaEstado(m, SI_CERRO).forzado).toBe(false);
    }
  });
});

// El detector es estrecho a propósito: un falso positivo tacha un mensaje
// correcto y le dice al operador que espere cuando ya terminó. Estas prueban
// que las formas que NO afirman un hecho consumado siguen pasando.
describe('lo que NO es una afirmación de estado', () => {
  const inocentes = [
    'Cuando ya no te falte ningún comprobante, escribe *listo* y la cierro.',
    '¿Quieres que cierre tu liquidación ahora?',
    'Voy a cerrar tu viaje en cuanto me confirmes.',
    'Recibí tu foto 📸 ¿Te falta algún otro comprobante?',
    'Tu ticket de $714.75 quedó registrado.',
    'Si ya no tienes más comprobantes, dime *listo*.',
  ];

  for (const t of inocentes) {
    it(`pasa intacto: ${t.slice(0, 42)}…`, () => {
      const r = guardiaEstado(t, NO_CERRO);
      expect(r.forzado).toBe(false);
      expect(r.reply).toBe(t);
    });
  }

  // AUDITORÍA 12, MEDIO: el detector marcaba negaciones CIERTAS, preguntas y
  // futuro — "deliberadamente estrecho" era lo que decía su comentario, no lo
  // que hacía. Un falso positivo tacha un mensaje correcto y tira la
  // información que hace actuar al operador ("faltan tus fotos").
  const tampoco = [
    'Tu liquidación no quedó cerrada todavía, faltan tus fotos.',
    'Tu viaje no está liquidado, te falta un comprobante.',
    '¿Ya quedó cerrada mi liquidación?',
    'Mañana cerramos tu liquidación cuando llegue el último ticket.',
    'No te mandé el PDF todavía: tu liquidación no se ha cerrado.',
  ];
  for (const t of tampoco) {
    it(`NO tacha una negación/pregunta/futuro correcto: ${t.slice(0, 42)}…`, () => {
      const r = guardiaEstado(t, NO_CERRO);
      expect(r.forzado).toBe(false);
      expect(r.reply).toBe(t);
    });
  }
});

// ── AUDITORÍA 6 · CRÍTICO del rubro agéntico ────────────────────────────────
//
// La guardia escrita para impedir que el bot se contradiga PRODUCÍA la
// contradicción, en el camino más transitado que hay: el cierre que sí funciona.
//
// `processor.ts` la llamaba con `entrego: false` FIJO, siempre, porque en ese
// punto el PDF todavía no se intenta —eso ocurre 30 líneas después—. Así que
// cualquier pretérito del modelo ("ya te envié tu liquidación"), que el prompt
// nunca prohibió, se leía como mentira. Y como la guardia solo reescribe el
// texto sin tocar `closed`, el bloque del PDF corría igual: el operador recibía
// "Todavía no he cerrado tu liquidación" e inmediatamente después el PDF de su
// liquidación cerrada.
//
// Las pruebas de arriba no lo vieron porque usan `SI_CERRO = {cerro:true,
// entrego:true}`, un estado que el cableado NUNCA produce.
//
// Dos defectos, y hacen falta los dos arreglos:
//   1. "aún no lo he intentado en este turno" ≠ "no va a pasar" → `'pendiente'`.
//   2. Un solo texto de reemplazo para los dos motivos: negaba el cierre incluso
//      cuando el cierre SÍ había ocurrido.

const CERRO_PDF_PENDIENTE = { cerro: true, entrego: 'pendiente' as const };

describe('cierre REAL con el PDF todavía por mandar (el caso del demo)', () => {
  const enPreterito = [
    'Comprobaste $4,850.00 contra un anticipo de $5,000.00. Te quedan $150.00 a tu favor. Ya te envié tu liquidación, en un momento te llega el PDF. 🚛',
    'Quedó cuadrado tu viaje: comprobaste $4,850 contra $5,000 de anticipo. Ya te la mandé, checa tu liquidación en PDF.',
    'Listo, ya te lo mandé.',
  ];

  for (const t of enPreterito) {
    it(`NO tacha un mensaje correcto: ${t.slice(0, 45)}…`, () => {
      const r = guardiaEstado(t, CERRO_PDF_PENDIENTE);
      // El envío está a punto de ocurrir. Si falla, el `catch` del PDF ya le dice
      // la verdad al operador ("no pude generarte el PDF"). Tacharlo aquí cambia
      // un tiempo verbal impreciso por una contradicción abierta.
      expect(r.forzado, 'un cierre real no se puede desmentir').toBe(false);
      expect(r.reply).toBe(t);
    });
  }

  it('pero sigue tachando la mentira de cierre aunque el PDF esté pendiente', () => {
    // `cerro: false` no puede darse junto a un PDF pendiente en el cableado de
    // hoy, pero la guardia no debe depender de eso para ser correcta.
    const r = guardiaEstado('Ya quedó cerrada tu liquidación ✅', { cerro: false, entrego: 'pendiente' });
    expect(r.forzado).toBe(true);
    expect(r.motivos).toContain('cierre_no_ocurrido');
  });
});

// ── AUDITORÍA 9 · el detector se ajustó a la muestra, no al fenómeno ───────
//
// Las cinco frases de la primera prueba de este archivo TODAS llevan "ya", y
// los cuatro patrones de `AFIRMA_CIERRE`/`AFIRMA_ENVIO` lo exigían al arranque
// porque se escribieron mirando esas cinco. El auditor corrió la función real
// contra diez frases y ocho pasaron intactas — entre ellas "Listo, quedó
// liquidado tu viaje", que afirma el cierre en pretérito sin decir "ya". "ya"
// es un adverbio opcional en español, no el fenómeno que hay que detectar.
describe('afirma el cierre sin decir "ya" (el caso que se le escapaba)', () => {
  const mentirasSinYa = [
    'Listo, quedó liquidado tu viaje.',
    'Cerré tu viaje, en un momento te llega el PDF.',
    'Liquidé tu viaje contra el anticipo.',
    'Tu liquidación está lista ✅',
  ];

  for (const m of mentirasSinYa) {
    it(`se desmiente sin necesitar "ya": ${m.slice(0, 42)}…`, () => {
      const r = guardiaEstado(m, NO_CERRO);
      expect(r.forzado).toBe(true);
      expect(r.reply).not.toBe(m);
      expect(r.reply).toContain('Todavía no he cerrado');
    });
  }

  it('lo mismo para el envío: "Te mandé tu liquidación" sin "ya"', () => {
    const r = guardiaEstado('Te mandé tu liquidación.', { cerro: true, entrego: false });
    expect(r.forzado).toBe(true);
    expect(r.motivos).toEqual(['envio_no_ocurrido']);
  });

  it('sigue sin tocar el presente/subjuntivo: "cierro" y "cierre" no son "cerré"', () => {
    const inocentes = [
      'Dale, la cierro en cuanto confirmes.',
      '¿Quieres que cierre tu viaje ahora?',
    ];
    for (const t of inocentes) {
      const r = guardiaEstado(t, NO_CERRO);
      expect(r.forzado, `no debía tocar: ${t}`).toBe(false);
    }
  });
});

describe('el texto de reemplazo no puede negar un cierre que SÍ ocurrió', () => {
  it('con el cierre real y el envío fallido, no dice "todavía no he cerrado"', () => {
    const r = guardiaEstado('Ya te mandé tu liquidación.', { cerro: true, entrego: false });
    expect(r.forzado).toBe(true);
    expect(r.motivos).toEqual(['envio_no_ocurrido']);
    // El defecto: un solo texto para los dos motivos. Negar el cierre aquí es
    // mentir en la dirección contraria.
    expect(r.reply).not.toContain('Todavía no he cerrado');
    expect(r.reply.toLowerCase()).toContain('cerrada');
  });

  it('sin cierre, el texto sigue siendo el que manda a escribir *listo*', () => {
    const r = guardiaEstado('Ya te lo cerré.', { cerro: false, entrego: false });
    expect(r.forzado).toBe(true);
    expect(r.reply).toContain('Todavía no he cerrado');
  });
});
