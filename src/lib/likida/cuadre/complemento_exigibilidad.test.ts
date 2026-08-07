import { describe, it, expect } from 'vitest';
import { cuadrarViaje } from './engine';
import { NORMAS } from '../normas/indice';
import type { Gasto } from '@/types/likida';

// ═══════════════════════════════════════════════════════════════════════════
// UNA FECHA QUE NINGUNA FICHA RESPALDA NO PUEDE TIRAR UNA DEDUCCIÓN.
//
// `config.ts` traía `hidrocarburos.vigenteDesde = '2026-04-24'`, fundada en un
// comentario que cita la RMF 2.7.1.8 — una de las citas que el código usa SIN
// ficha. Con ella, el MISMO CFDI de diésel de $5,800 movido un día pasaba de
//
//    2026-04-23 → deducible $5,800 · IVA acreditable $689.66 · 200 L elegibles
//    2026-05-10 → deducible     $0 · IVA acreditable     $0 ·   0 L elegibles
//
// y el papel imprimía "obligatorio desde 24-abr-2026, regla 2.7.1.48 RMF … no
// deducible (CFF 29-A)". La ficha `normas/rmf-2026-2.7.1.48.yaml` dice lo
// contrario con todas sus letras: `fecha_vigencia_desde: null`, la regla sigue
// redactada en futuro ("el complemento que al efecto publique el SAT en su
// Portal") y "la obligación puede estar latente y no vigente… ESA FECHA NO ESTÁ
// RESPALDADA".
//
// La fecha que decide dinero sale ahora de la FICHA. Mientras sea `null`, el
// motor avisa y manda a revisión; nunca declara no deducible.
// ═══════════════════════════════════════════════════════════════════════════

const HC = { claves: ['15101505', '15101514', '15101515'], unidad: 'LTR', vigenteDesde: '2026-04-24' };
const politica = [{ concepto: 'diesel' }];

/** El CFDI de diésel del hallazgo, con la fecha como única variable. */
const cfdiDiesel = (fecha: string): Gasto => ({
  id: 'g1', concepto: 'diesel', monto: 5800, fecha, cfdiUuid: 'uuid-1',
  // AUDITORÍA 8: CFDI ya verificado — receptor presente a propósito, para no
  // ejercitar el hallazgo (ese caso vive en rfc_receptor_faltante.test.ts).
  rfcReceptor: 'REC010101AA1',
  xmlVerificado: true, claveProdServ: '15101505', claveUnidad: 'LTR',
  tipoComprobante: 'I', complementoHidrocarburos: false,
  formaPago: '03', ivaTraslado: 689.66, iepsTraslado: 400,
  ocrExtra: { litros: 200 },
});

const cuadre = (fecha: string, exigibleDesde?: string | null) =>
  cuadrarViaje({
    viajeId: 'v-hc', anticipo: 5800, politica,
    hidrocarburos: exigibleDesde === undefined ? HC : { ...HC, exigibleDesde },
    estimulos: { peajeFactor: 0.5, viaticosTopeFiscalDiarioMxn: 750, efectivoTopeMxn: 2000, clavesDieselIeps: ['15101505'] },
    gastos: [cfdiDiesel(fecha)],
  });

describe('complemento de hidrocarburos — la exigibilidad la manda la ficha', () => {
  it('la ficha sigue SIN fecha de exigibilidad confirmada', () => {
    // Si alguien la confirma contra el Portal del SAT y la llena, este test
    // avisa que hay que revisar los dos de abajo — que dejan de ser el caso real.
    expect(NORMAS['rmf-2026-2.7.1.48'].exigibleDesde).toBe(null);
  });

  it('un día de diferencia YA NO vale $5,800 de deducción ni $689.66 de IVA', () => {
    const antes = cuadre('2026-04-23');
    const despues = cuadre('2026-05-10');

    expect(antes.totalDeducible).toBe(5800);
    expect(despues.totalDeducible).toBe(5800);
    expect(antes.totalNoDeducible).toBe(0);
    expect(despues.totalNoDeducible).toBe(0);
    expect(antes.ivaAcreditable).toBe(689.66);
    expect(despues.ivaAcreditable).toBe(689.66);
    expect(antes.litrosDieselAcreditables).toBe(200);
    expect(despues.litrosDieselAcreditables).toBe(200);
  });

  it('el CFDI posterior sí se avisa, pero a revisión y sin declararlo no deducible', () => {
    const r = cuadre('2026-05-10');
    expect(r.diferencias.some((d) => d.tipo === 'complemento_hidrocarburos')).toBe(false);
    const aviso = r.diferencias.find((d) => d.tipo === 'complemento_no_verificable');
    expect(aviso).toBeDefined();
    expect(r.estatus).toBe('revisar');
  });

  it('el papel deja de AFIRMAR una vigencia que ninguna ficha respalda', () => {
    const r = cuadre('2026-05-10');
    const notas = r.diferencias.map((d) => d.nota).join(' | ');
    expect(notas).not.toContain('obligatorio desde');
    expect(notas).not.toContain('24-abr-2026');
    // Lo único que puede decir sobre "no deducible" es que NO lo declara.
    expect(notas).toContain('NO se declara no deducible');
    expect(notas.replace('NO se declara no deducible', '')).not.toContain('no deducible');
    // Y dice POR QUÉ no se afirma, que es lo que el contralor necesita para
    // decidir con su contador.
    expect(notas).toContain('no está confirmada');
    // La regla se sigue citando: el hecho (falta el complemento) sí es verificable.
    expect(notas).toContain('2.7.1.48');
  });

  it('el día que la ficha traiga la fecha, el veredicto duro se enciende solo', () => {
    // Misma entrada, con la exigibilidad ya confirmada: vuelve a ser no deducible
    // y sin acreditamiento. Es la rama que hoy NO puede correr porque nadie ha
    // verificado la fecha, y está probada para que encenderla sea cambiar la ficha.
    const r = cuadre('2026-05-10', '2026-04-24');
    expect(r.diferencias.some((d) => d.tipo === 'complemento_hidrocarburos')).toBe(true);
    expect(r.totalNoDeducible).toBe(5800);
    expect(r.totalDeducible).toBe(0);
    expect(r.ivaAcreditable).toBe(0);
    expect(r.litrosDieselAcreditables).toBe(0);
    expect(r.diferencias.find((d) => d.tipo === 'complemento_hidrocarburos')!.nota).toContain('obligatorio desde 2026-04-24');
  });

  it('con la fecha confirmada, un CFDI anterior a ella sigue limpio', () => {
    const r = cuadre('2026-04-23', '2026-04-24');
    expect(r.diferencias.some((d) => d.tipo.startsWith('complemento'))).toBe(false);
    expect(r.totalDeducible).toBe(5800);
  });
});
