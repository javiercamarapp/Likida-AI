import { describe, it, expect } from 'vitest';
import { clasificar } from './clasificador';
import { clasificarPorReglas } from './intencion';
import { decidirEnvio, INTENCIONES_AUTOENVIABLES, type EntradaPolitica } from './politica';
import { redactarBorrador, type EntradaRedaccion } from './redactor';
import { AHORA, estatus } from './datos.fixture';
import type { Clasificacion } from './tipos';

// LÍMITES del agente 4, tomados de lo que pasa de verdad en los grupos de transporte (informes de 5 chats reales): el agente NO promete
// ETA, NO cotiza falsos/demoras/tarifas, NO emite ni corrige carta porte (CCP), POD ni DODA, y no decide capacidad ni cancelaciones. Textos
// sintéticos. Estas pruebas fijan lo que la política y el redactor YA hacen para que un cambio futuro no lo afloje sin querer.

const base = (c: Partial<EntradaRedaccion> = {}): EntradaRedaccion => ({
  clasificacion: { intencion: 'eta', secundarias: [], senales: [] },
  nombreContacto: 'Cliente Ejemplo', nombreFlota: 'Flota Ejemplo',
  viaje: { tipo: 'uno', estatus: estatus() }, ahora: AHORA, primerContacto: false, avisoPrivacidadUrl: null, ...c,
});

const politica = (cl: Pick<Clasificacion, 'intencion' | 'confianza' | 'senales'>, extra: Partial<EntradaPolitica> = {}): EntradaPolitica => ({
  config: { habilitado: true, modoAprobacion: 'autoenviar_bajo_riesgo', autoenviarMinAprobaciones: 1, soloAvisar: false },
  clasificacion: cl,
  borrador: { riesgo: 'bajo', faltantes: [], tareas: [], requiereHumano: false, origen: 'plantilla' },
  conversacion: { control: 'agente', molestiaNivel: 0, escalamientoNivel: 0 },
  aprobacionesSinEditar: 99, ...extra,
});

const PROMESA = /\b(garantiz|promet|aseguro|te aseguro|sin falta|llegar[aá] a las|estar[aá] a las|seguro llega)/i;
const MONTO = /\$\s?\d|\bmxn\b|\busd\b|\bpesos\b|\bdolares\b/i;
const VERBO_DOCUMENTAL = /\b(emit[ií]|timbr[eé]|gener[eé]|correg[ií]|cancel[eé]|sell[eé]|firm[eé]|apliqu[eé]|autoric[eé]|autorizo)\b/i;

describe('el agente NO promete ETA', () => {
  it('sin hora registrada no inventa una: dice que la consulta y lo marca como faltante', () => {
    const b = redactarBorrador(base({ viaje: { tipo: 'uno', estatus: estatus({ etaIso: null, etaFuente: null }) } }));
    expect(b.faltantes).toContain('eta');
    expect(b.texto).toContain('Todavía no tengo registrada una hora estimada');
    expect(b.texto).not.toMatch(/\b\d{1,2}:\d{2}\b/);
    expect(b.riesgo).not.toBe('bajo');
  });

  it('con hora registrada la presenta como DATO del ejecutivo, no como promesa', () => {
    const b = redactarBorrador(base({ viaje: { tipo: 'uno', estatus: estatus({ etaIso: '2026-10-01T22:00:00.000Z', etaFuente: 'eta' }) } }));
    expect(b.texto).toContain('Es la que tiene registrada tu ejecutivo, no una medición del GPS');
    expect(b.texto).not.toMatch(PROMESA);
  });

  it('«cuándo llega, me urge» sigue siendo ETA, nunca se autoenvía con un faltante', () => {
    const c = clasificarPorReglas('cuando llega? me urge');
    expect(c?.intencion).toBe('eta');
    expect(decidirEnvio(politica(c!, { borrador: { riesgo: 'medio', faltantes: ['eta'], tareas: [], requiereHumano: false, origen: 'plantilla' } })).accion).toBe('aprobar');
  });
});

describe('el agente NO cotiza falsos, demoras ni tarifas, ni decide capacidad o cancelaciones', () => {
  const textos = [
    'cuanto cuesta el falso de la caja', 'nos cotizan la demora de ayer', 'cual es la tarifa del cruce', 'me pasan el costo de la reparacion',
    'pueden colocar 3 cajas mañana?', 'cancelamos el servicio de mañana', 'autorizan la reparacion?',
  ];
  for (const t of textos) {
    it(`«${t}» no sale con una cifra ni sin una persona`, () => {
      const c = clasificarPorReglas(t);
      // Si ninguna regla lo reconoce queda como «otro» (lo ve una persona); si una lo reconoce no puede ser una intención autoenviable con cifras.
      const intencion = c?.intencion ?? 'otro';
      const b = redactarBorrador(base({ clasificacion: { intencion, secundarias: [], senales: [] }, viaje: { tipo: 'uno', estatus: estatus() } }));
      expect(b.texto).not.toMatch(MONTO);
      expect(b.texto).not.toMatch(PROMESA);
      if (intencion === 'otro') {
        expect(b.requiereHumano).toBe(true);
        expect(b.faltantes).toContain('intencion');
        expect(decidirEnvio(politica({ intencion, confianza: 0, senales: [] }, { borrador: b })).accion).toBe('aprobar');
      }
    });
  }
});

describe('el agente NO toca CCP, POD ni DODA', () => {
  it('pedir la CCP / el timbrado / el DODA / un sello NUNCA se autoenvía (aunque alguna palabra se parezca a «documentos»)', async () => {
    for (const t of ['nos ayudan con la ccp de cruce', 'falta el timbrado', 'necesitamos el DODA sellado', 'me apoyan con la remision sellada', 'favor de corregir la carta porte', 'emitan la remision por favor']) {
      const c = await clasificar(t);
      const d = decidirEnvio(politica(c));
      expect(d.accion, `${t} → ${c.intencion}`).not.toBe('autoenviar');
    }
  });

  it('la señal accion_documental hace que la política pida aprobación aunque la intención sea autoenviable', async () => {
    const c = await clasificar('me apoyan con la remision sellada');
    expect(c.intencion).toBe('documentos');
    expect(c.senales).toContain('accion_documental');
    expect(decidirEnvio(politica(c))).toEqual({ accion: 'aprobar', motivo: 'clasificacion_con_senales' });
  });

  it('preguntar el ESTADO de un documento sigue sin señal (el camino de siempre)', async () => {
    const c = await clasificar('que documentos me faltan?');
    expect(c.intencion).toBe('documentos');
    expect(c.senales).toEqual([]);
    expect(decidirEnvio(politica(c)).accion).toBe('autoenviar');
  });

  it('pedir el POD genera un borrador que solo INFORMA el estado: ningún verbo de emitir, timbrar, corregir o sellar', () => {
    const c = clasificarPorReglas('me pasan el POD del viaje');
    expect(c?.intencion).toBe('factura_pod');
    for (const podRecibido of [true, false, null]) {
      const b = redactarBorrador(base({ clasificacion: { intencion: 'factura_pod', secundarias: [], senales: [] }, viaje: { tipo: 'uno', estatus: estatus({ podRecibido }) } }));
      expect(b.texto).not.toMatch(VERBO_DOCUMENTAL);
      expect(b.texto).not.toMatch(PROMESA);
    }
  });

  it('factura/POD y datos de la unidad NO están entre las intenciones autoenviables', () => {
    expect(INTENCIONES_AUTOENVIABLES).not.toContain('factura_pod');
    expect(INTENCIONES_AUTOENVIABLES).not.toContain('datos_unidad');
    expect(decidirEnvio(politica({ intencion: 'factura_pod', confianza: 0.9, senales: [] })).accion).toBe('aprobar');
    expect(decidirEnvio(politica({ intencion: 'datos_unidad', confianza: 0.9, senales: [] })).accion).toBe('aprobar');
  });
});

describe('las reglas flojas del habla de grupo nunca disparan un autoenvío', () => {
  it('«¿cómo vamos?» es ubicación pero con confianza baja: la política pide aprobación', () => {
    const c = clasificarPorReglas('como vamos con las cargas?');
    expect(c?.intencion).toBe('ubicacion');
    expect(decidirEnvio(politica(c!))).toEqual({ accion: 'aprobar', motivo: 'confianza_baja' });
  });
  it('la ubicación explícita sí conserva su camino (y solo con todo lo demás en regla)', () => {
    const c = clasificarPorReglas('donde va mi camion?');
    expect(decidirEnvio(politica(c!)).accion).toBe('autoenviar');
  });
});

describe('datos de la unidad: nunca licencia ni teléfono del operador; lo que falta se dice, no se rellena', () => {
  it('sin caja, unidad ni operador: dice «lo consulto» y sube a faltante', () => {
    const b = redactarBorrador(base({ clasificacion: { intencion: 'datos_unidad', secundarias: [], senales: [] }, viaje: { tipo: 'uno', estatus: estatus({ caja: null, unidad: null, operador: null, placasCaja: null, placasUnidad: null }) } }));
    expect(b.faltantes).toEqual(expect.arrayContaining(['unidad', 'operador']));
    expect(b.riesgo).not.toBe('bajo');
    expect(b.texto).not.toMatch(/licencia|celular|tel[eé]fono/i);
  });
  it('con datos: salen solo los campos del estatus (sin licencia ni teléfono) y siempre a aprobación', () => {
    const b = redactarBorrador(base({ clasificacion: { intencion: 'datos_unidad', secundarias: [], senales: [] }, viaje: { tipo: 'uno', estatus: estatus({ caja: 'ZZ-100', unidad: 'TC0000', operador: 'Operador Ejemplo', placasCaja: null, placasUnidad: '111BBB' }) } }));
    expect(b.texto).toContain('Unidad: TC0000');
    expect(b.texto).toContain('Placas de la caja: sin registrar');
    expect(b.texto).not.toMatch(/licencia|celular|tel[eé]fono/i);
    expect(b.riesgo).toBe('medio');
  });
});
