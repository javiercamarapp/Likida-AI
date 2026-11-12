import { describe, expect, it } from 'vitest';
import { avisoVigencias, avisoCorridaFallida, avisoHuerfanos, avisoInvitacion, avisoDePrueba } from './avisos';
import { correoDeAuth, correoDeAvisoAuth } from './auth';
import { armarHtml, aTextoPlano } from './plantilla';
import { correo as es } from '@/lib/i18n/es/correo';

const ACENTOS = /[áéíóúñ¿¡]/i;
const texto = (c: { asunto: string; avance: string; titulo: string; parrafos: string[]; porQueLoRecibes: string; boton?: { texto: string } }) =>
  [c.asunto, c.avance, c.titulo, ...c.parrafos, c.porQueLoRecibes, c.boton?.texto ?? ''].join(' ');

describe('idioma del destinatario en los correos', () => {
  it('sin idioma (o con uno ajeno) dice lo de siempre, en español, y no marca idioma', () => {
    const c = avisoHuerfanos({ flota: 'Norte', cuantos: 3, diasDelMasViejo: 9 });
    expect(c.asunto).toBe('3 comprobantes sin viaje');
    expect(c.idioma).toBeUndefined();
    expect(avisoHuerfanos({ flota: 'Norte', cuantos: 3, diasDelMasViejo: 9 }, 'fr')).toEqual(c);
    expect(armarHtml(c)).toContain('<html lang="es">');
  });

  it('el español viene del diccionario (un solo texto fuente)', () => {
    const c = avisoHuerfanos({ flota: null, cuantos: 1, diasDelMasViejo: null });
    expect(c.asunto).toBe(es['hu.asunto.uno'].replace('{n}', '1'));
    expect(c.porQueLoRecibes).toContain('tu flota');
  });

  it('en inglés: sin acentos, con plurales y con el marco en inglés', () => {
    const casos = [
      avisoVigencias({ flota: 'Norte', vencidos: 2, porVencer: 1, enRegla: 5, total: 8, detalle: [{ unidad: 'T-1', estado: 'expired' }] }, 'en'),
      avisoCorridaFallida({ flota: null, agente: 'Peajes', href: '/x', cuando: 'today', motivo: 'timeout', seguidas: 3 }, 'en'),
      avisoCorridaFallida({ flota: null, agente: 'Peajes', href: '/x', cuando: 'today', motivo: 'timeout', seguidas: 1, plataforma: true }, 'en'),
      avisoHuerfanos({ flota: 'Norte', cuantos: 1, diasDelMasViejo: 9 }, 'en'),
      avisoInvitacion({ flota: null, invitaNombre: 'Ana', rol: 'accountant' }, 'en'),
      avisoDePrueba({ flota: 'Norte', agente: 'Fuel agent' }, 'en'),
      correoDeAuth({ accion: 'login', liga: 'https://x/y', codigo: '', minutos: 90, idioma: 'en' }),
      correoDeAvisoAuth('email_changed', 'en'),
    ];
    for (const c of casos) {
      expect(texto(c)).not.toMatch(ACENTOS);
      expect(c.idioma).toBe('en');
      expect(armarHtml(c)).toContain('<html lang="en">');
    }
    expect(casos[3].asunto).toBe('1 receipt without a trip');
    expect(casos[0].titulo).toBe('2 units have expired documents');
    const html = armarHtml({ ...casos[0], tono: 'urgente' });
    expect(html).toContain('Urgent');
    expect(html).toContain('Trip settlement over WhatsApp');
    expect(aTextoPlano({ ...casos[0], codigo: '123456' })).toContain('Code: 123456');
  });

  it('la caducidad se dice en el idioma del destinatario', () => {
    expect(correoDeAuth({ accion: 'login', liga: 'https://x/y', codigo: '', minutos: 120, idioma: 'en' }).avance).toContain('2 hours');
    expect(correoDeAuth({ accion: 'login', liga: 'https://x/y', codigo: '', minutos: 120 }).avance).toContain('2 horas');
  });
});
