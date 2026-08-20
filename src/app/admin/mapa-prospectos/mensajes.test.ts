// El primer toque del Cerebro — las reglas del mensaje son de la casa y esta
// prueba las FIJA: sin clientes inventados, sin cifras, el gancho es SU
// vacante, y el texto del agente experto (0129) manda sobre la plantilla.
import { describe, expect, it } from 'vitest';
import type { ProspectoMapa } from '@/lib/admin/prospectos-mapa';
import { mensajeWa, correoProspecto, hrefWa, hrefCorreo } from './mensajes';

const base: ProspectoMapa = {
  id: 'x', empresa: 'Transportes Ejemplo', ciudad: 'Mérida', entidad: 'Yucatán',
  lat: 21, lng: -89.6, telefono: '9991234567', correo: 'dg@ejemplo.mx',
  contacto: null, vacante: null, notas: null, estado: 'nuevo', fuente: 'censo',
  giro: 'transportista', urgencia: 50, cierre: 40, tamano: null, completitud: 45, ultimoToque: null,
  mensajeWaIa: null, correoAsuntoIa: null, correoCuerpoIa: null, mensajesGeneradosEn: null,
  numUnidades: null, similitudIcpPct: 0, necesidadPct: 0,
};

describe('la plantilla determinista (el respaldo)', () => {
  it('con vacante, el gancho la CITA; sin vacante, habla del giro', () => {
    expect(mensajeWa({ ...base, vacante: 'Auxiliar de Liquidaciones' })).toContain('"Auxiliar de Liquidaciones"');
    expect(mensajeWa(base)).toContain('a mano');
  });
  it('jamás inventa clientes ni cifras — la regla de la casa dentro del copy', () => {
    for (const texto of [mensajeWa(base), correoProspecto(base).cuerpo]) {
      expect(texto).not.toMatch(/nuestros clientes/i);
      expect(texto).not.toMatch(/\$\d/);
    }
  });
  it('el asunto del correo nunca es genérico: ancla la vacante o la empresa', () => {
    expect(correoProspecto({ ...base, vacante: 'Liquidador' }).asunto).toContain('Liquidador');
    expect(correoProspecto(base).asunto).toContain(base.empresa);
  });
});

describe('los href — el texto del agente experto manda', () => {
  it('sin contacto no hay href (null, no un link roto)', () => {
    expect(hrefWa({ ...base, telefono: null })).toBeNull();
    expect(hrefCorreo({ ...base, correo: null })).toBeNull();
  });
  it('con mensaje IA guardado, el botón abre con ESE texto', () => {
    const p = { ...base, mensajeWaIa: 'TEXTO-DEL-AGENTE', correoAsuntoIa: 'ASUNTO-IA', correoCuerpoIa: 'CUERPO-IA', mensajesGeneradosEn: '2026-08-17T00:00:00Z' };
    expect(hrefWa(p)).toContain(encodeURIComponent('TEXTO-DEL-AGENTE'));
    expect(hrefCorreo(p)).toContain(encodeURIComponent('ASUNTO-IA'));
    expect(hrefCorreo(p)).toContain(encodeURIComponent('CUERPO-IA'));
  });
  it('la lada MX no se duplica: 52… no se vuelve 5252…', () => {
    expect(hrefWa({ ...base, telefono: '529991234567' })).toContain('wa.me/529991234567');
    expect(hrefWa(base)).toContain('wa.me/529991234567');
  });
});
