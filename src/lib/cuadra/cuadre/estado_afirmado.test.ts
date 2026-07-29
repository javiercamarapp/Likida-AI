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
});
