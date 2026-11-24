import { describe, it, expect } from 'vitest';
import { evaluarEta, cambiosDeEta, CONFIG_ETA_POR_OMISION, type EtaPublicado } from './politica_eta';

const BASE = Date.parse('2026-11-23T00:00:00.000Z');
const t = (h: string): string => new Date(BASE + (Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5))) * 60_000).toISOString();
const ahora = (h: string): number => Date.parse(t(h));
const e = (eta: string, act: string, extra: Partial<EtaPublicado> = {}): EtaPublicado => ({ etaIso: t(eta), actualizadoIso: t(act), punto: 'planta', fuente: 'persona', causa: null, ...extra });
const cfg = { zonaHoraria: 'Centro' };

describe('evaluarEta: solo el ETA vigente, con hora de actualización', () => {
  it('sin ETA no inventa: pide eta_vigente y dice que no puede decir', () => {
    const r = evaluarEta({ ahoraMs: ahora('08:00'), citaIso: t('10:00'), historial: [], config: cfg });
    expect(r.puedeDecir).toBe(false);
    expect(r.eta).toBeNull();
    expect(r.faltan).toContain('eta_vigente');
  });
  it('con un ETA vigente completo, lo retransmite con punto, hora de actualización y zona', () => {
    const r = evaluarEta({ ahoraMs: ahora('09:00'), citaIso: t('10:00'), historial: [e('09:50', '08:50')], config: cfg });
    expect(r.puedeDecir).toBe(true);
    expect(r.eta).toMatchObject({ punto: 'planta', zona: 'Centro', actualizadoIso: t('08:50') });
    expect(r.nivel).toBe('ninguno');
    expect(r.avisarRetraso).toBe(false);
  });
  it('sin zona horaria configurada no afirma ninguna hora', () => {
    const r = evaluarEta({ ahoraMs: ahora('09:00'), citaIso: t('10:00'), historial: [e('09:50', '08:50')] });
    expect(r.puedeDecir).toBe(false);
    expect(r.faltan).toContain('zona_horaria');
  });
  it('sin punto (planta o patio) no se dice: la confusión patio/planta es documentada', () => {
    const r = evaluarEta({ ahoraMs: ahora('09:00'), citaIso: null, historial: [e('09:50', '08:50', { punto: null })], config: cfg });
    expect(r.puedeDecir).toBe(false);
    expect(r.faltan).toContain('punto');
  });
  it('un ETA con más de 60 min de antigüedad ya no es vigente', () => {
    const r = evaluarEta({ ahoraMs: ahora('10:00'), citaIso: null, historial: [e('11:00', '08:50')], config: cfg });
    expect(r.puedeDecir).toBe(false);
    expect(r.motivos).toContain('eta_desactualizado');
    expect(evaluarEta({ ahoraMs: ahora('10:00'), citaIso: null, historial: [e('11:00', '08:50')], config: { ...cfg, maxAntiguedadMin: 120 } }).puedeDecir).toBe(true);
  });
  it('un ETA ya vencido (anterior a ahora) no se presenta', () => {
    const r = evaluarEta({ ahoraMs: ahora('10:30'), citaIso: t('10:00'), historial: [e('10:00', '10:20')], config: cfg });
    expect(r.puedeDecir).toBe(false);
    expect(r.faltan).toContain('eta_vencido');
    expect(r.nivel).toBe('N2');
  });
  it('un ETA calculado por el sistema no cuenta salvo que la flota lo autorice', () => {
    const h = [e('09:50', '08:50', { fuente: 'sistema_gps' })];
    expect(evaluarEta({ ahoraMs: ahora('09:00'), citaIso: null, historial: h, config: cfg }).puedeDecir).toBe(false);
    expect(evaluarEta({ ahoraMs: ahora('09:00'), citaIso: null, historial: h, config: { ...cfg, autorizaEtaDeSistema: true } }).puedeDecir).toBe(true);
  });
  it('datos ilegibles se tratan como ausentes (no lanza)', () => {
    const r = evaluarEta({ ahoraMs: ahora('09:00'), citaIso: 'basura', historial: [{ etaIso: 'x', actualizadoIso: 'y', punto: 'planta', fuente: 'persona', causa: null }], config: cfg });
    expect(r.puedeDecir).toBe(false);
    expect(r.retrasoVsCitaMin).toBeNull();
  });
});

describe('retraso: se avisa ANTES de la cita', () => {
  it('ETA posterior a la cita sin aviso previo → hay que avisar, con tiempo si quedan ≥ 60 min', () => {
    const r = evaluarEta({ ahoraMs: ahora('07:15'), citaIso: t('10:00'), historial: [e('11:30', '07:05')], config: cfg });
    expect(r.retrasoVsCitaMin).toBe(90);
    expect(r.avisarRetraso).toBe(true);
    expect(r.avisoTarde).toBe(false);
    expect(r.nivel).toBe('N2'); // más de 60 min después de la cita
  });
  it('avisar a 5 minutos de la cita se marca como tarde', () => {
    const r = evaluarEta({ ahoraMs: ahora('09:55'), citaIso: t('10:00'), historial: [e('10:20', '09:50')], config: cfg });
    expect(r.avisarRetraso).toBe(true);
    expect(r.avisoTarde).toBe(true);
    expect(r.motivos).toContain('aviso_de_retraso_con_poca_antelacion');
  });
  it('si ya se avisó el retraso no se vuelve a pedir', () => {
    const r = evaluarEta({ ahoraMs: ahora('07:15'), citaIso: t('10:00'), retrasoAvisadoIso: t('07:10'), historial: [e('10:20', '07:05')], config: cfg });
    expect(r.avisarRetraso).toBe(false);
  });
  it('cita vencida sin ETA vigente → gerencia', () => {
    const r = evaluarEta({ ahoraMs: ahora('10:30'), citaIso: t('10:00'), historial: [], config: cfg });
    expect(r.nivel).toBe('N2');
    expect(r.motivos).toContain('cita_vencida_sin_eta_vigente');
  });
});

describe('cambios de ETA: nunca sin explicación, alerta si son frecuentes', () => {
  const h2 = [e('13:00', '11:10'), e('13:30', '11:25', { causa: null })];
  it('un cambio sin causa se retiene hasta que una persona confirme', () => {
    const r = evaluarEta({ ahoraMs: ahora('11:30'), citaIso: t('14:00'), historial: h2, config: cfg });
    expect(r.retenerEnvio).toBe(true);
    expect(r.puedeDecir).toBe(false);
    expect(r.faltan).toContain('causa_del_cambio');
    expect(r.nivel).toBe('N1');
  });
  it('con causa confirmada se puede decir, anotando el ETA anterior', () => {
    const h = [e('13:00', '11:10'), e('13:30', '11:25', { causa: 'diésel' })];
    const r = evaluarEta({ ahoraMs: ahora('11:30'), citaIso: t('14:00'), historial: h, config: { ...cfg, cambiosParaAvisar: 3 } });
    expect(r.retenerEnvio).toBe(true); // ETA posterior al anterior: se avisa al encargado antes de enviar
    const adelantado = [e('13:30', '11:10'), e('13:00', '11:25', { causa: 'se agilizó la carga' })];
    const r2 = evaluarEta({ ahoraMs: ahora('11:30'), citaIso: t('14:00'), historial: adelantado, config: { ...cfg, cambiosParaAvisar: 3 } });
    expect(r2.puedeDecir).toBe(true);
    expect(r2.eta).toMatchObject({ causaCambio: 'se agilizó la carga', etaAnteriorIso: t('13:30') });
  });
  it('dos cambios en 60 min avisan al encargado; tres en 2 h alertan a gerencia', () => {
    const dos = [e('13:00', '10:20'), e('13:10', '10:40', { causa: 'a' }), e('13:20', '11:00', { causa: 'b' })];
    const r2 = evaluarEta({ ahoraMs: ahora('11:10'), citaIso: t('14:00'), historial: dos, config: cfg });
    expect(r2.cambiosEnVentanaAviso).toBe(2);
    expect(r2.retenerEnvio).toBe(true);
    expect(r2.alertaCambioFrecuente).toBe(false);
    const tres = [...dos, e('13:25', '11:05', { causa: 'c' })];
    const r3 = evaluarEta({ ahoraMs: ahora('11:10'), citaIso: t('14:00'), historial: tres, config: cfg });
    expect(r3.cambiosEnVentanaFrecuente).toBe(3);
    expect(r3.alertaCambioFrecuente).toBe(true);
    expect(r3.nivel).toBe('N2');
  });
  it('cambios antiguos (fuera de la ventana) no cuentan', () => {
    const h = [e('13:00', '06:00'), e('13:10', '06:30', { causa: 'a' }), e('13:20', '07:00', { causa: 'b' }), e('13:30', '07:30', { causa: 'c' })];
    expect(cambiosDeEta(h, ahora('11:10'), 120)).toBe(0);
  });
  it('los umbrales son configuración y la omisión coincide con lo recomendado', () => {
    expect(CONFIG_ETA_POR_OMISION).toMatchObject({ cambiosParaEscalar: 3, ventanaCambioFrecuenteMin: 120, cambiosParaAvisar: 2, ventanaCambiosAvisoMin: 60, maxAntiguedadMin: 60, autorizaEtaDeSistema: false });
    const tres = [e('13:00', '10:20'), e('13:10', '10:40', { causa: 'a' }), e('13:20', '11:00', { causa: 'b' }), e('13:25', '11:05', { causa: 'c' })];
    expect(evaluarEta({ ahoraMs: ahora('11:10'), citaIso: t('14:00'), historial: tres, config: { ...cfg, cambiosParaEscalar: 5 } }).alertaCambioFrecuente).toBe(false);
  });
  it('siempre trae la lista de lo que nunca se dice', () => {
    expect(evaluarEta({ ahoraMs: ahora('09:00'), citaIso: null, historial: [], config: cfg }).nuncaDecir.join(' ')).toMatch(/en breve/);
  });
});
