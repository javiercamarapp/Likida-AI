import { describe, it, expect } from 'vitest';
import { armarHtmlCorporativo, aTextoPlanoCorporativo, type Correo } from './plantilla';

const correo: Correo = {
  asunto: 'Desglose de pago — bitácora 1228',
  avance: 'Desglose de pago adjunto.',
  titulo: 'Desglose de pago',
  rotulo: 'Desglose de pago',
  parrafos: ['Va adjunto el desglose de pago de la bitácora 1228.', 'El detalle está en el archivo de Excel.'],
  datos: [['Bitácora', '1228'], ['Periodo', '9 al 14 oct']],
  archivo: { nombre: 'desglose-1228.xlsx', detalle: 'Excel · percepciones y deducciones' },
  nota: 'Si algo no coincide, responde a este correo.',
  porQueLoRecibes: 'Recibes este correo como destinatario del desglose de pago.',
};

describe('plantilla corporativa del correo operativo', () => {
  it('con logo de la flota: Likida a la izquierda y la flota a la derecha, ambos incrustados (cid)', () => {
    const h = armarHtmlCorporativo(correo, { logoCliente: true, nombreCliente: 'Flota Prueba SA' });
    const izq = h.indexOf('cid:likida-logo');
    const der = h.indexOf('cid:cliente-logo');
    expect(izq).toBeGreaterThan(-1);
    expect(der).toBeGreaterThan(izq);
    expect(h).toMatch(/<td align="left"[^>]*>\s*<img src="cid:likida-logo"/);
    expect(h).toMatch(/<td align="right"[^>]*>\s*<img src="cid:cliente-logo"/);
    expect(h).toContain('alt="Flota Prueba SA"');
  });

  it('sin logo de la flota: solo el de Likida, sin imagen rota ni hueco con cid', () => {
    const h = armarHtmlCorporativo(correo, { logoCliente: false });
    expect(h).toContain('cid:likida-logo');
    expect(h).not.toContain('cid:cliente-logo');
  });

  it('es operativo: sin liga de baja, sin botón de campaña, sin imágenes externas ni enlaces', () => {
    const h = armarHtmlCorporativo(correo, { logoCliente: true });
    expect(h).not.toMatch(/unsubscribe|baja/i);
    expect(h).not.toMatch(/src="https?:/i);
    expect(h).not.toMatch(/<a\s/i);
  });

  it('fija el esquema claro (modo oscuro no invierte el logo)', () => {
    const h = armarHtmlCorporativo(correo, { logoCliente: true });
    expect(h).toContain('<meta name="color-scheme" content="light">');
  });

  it('muestra los datos, el adjunto y la nota; el preheader es el aviso', () => {
    const h = armarHtmlCorporativo(correo, { logoCliente: true });
    expect(h).toContain('9 al 14 oct');
    expect(h).toContain('desglose-1228.xlsx');
    expect(h).toContain('XLSX');
    expect(h).toContain('Si algo no coincide, responde a este correo.');
    expect(h).toContain('>Desglose de pago adjunto.</div>');
  });

  it('todo dato se escapa: un nombre de archivo o razón social hostil no inyecta marcado', () => {
    const h = armarHtmlCorporativo(
      { ...correo, archivo: { nombre: '<img src=x onerror=alert(1)>.xlsx' }, datos: [['Bitácora', '<b>1</b>']] },
      { logoCliente: true, nombreCliente: '"><script>alert(1)</script>' },
    );
    expect(h).not.toContain('<script');
    expect(h).not.toContain('<img src=x');
    expect(h).not.toContain('<b>1</b>');
  });

  it('texto plano: cliente, título, datos, adjunto y pie; sin HTML', () => {
    const t = aTextoPlanoCorporativo(correo, { logoCliente: true, nombreCliente: 'Flota Prueba SA' });
    expect(t).toContain('LIKIDA  ·  Flota Prueba SA');
    expect(t).toContain('Bitácora: 1228');
    expect(t).toContain('Adjunto: desglose-1228.xlsx');
    expect(t).toContain(correo.porQueLoRecibes);
    expect(t).not.toMatch(/<[a-z]/i);
  });
});
