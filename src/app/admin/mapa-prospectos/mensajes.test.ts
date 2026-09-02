// El primer toque del Cerebro — las reglas del mensaje son de la casa y esta
// prueba las FIJA: sin clientes inventados, sin cifras, el gancho es SU
// vacante, y el texto del agente experto (0129) manda sobre la plantilla.
import { describe, expect, it } from 'vitest';
import type { ProspectoMapa, TextosProspecto } from '@/lib/admin/prospectos-mapa';
import { mensajeWa, correoProspecto, hrefWa, hrefCorreo, esperandoTextos } from './mensajes';

const base: ProspectoMapa = {
  id: 'x', empresa: 'Transportes Ejemplo', ciudad: 'Mérida', entidad: 'Yucatán',
  lat: 21, lng: -89.6, telefono: '9991234567', correo: 'dg@ejemplo.mx',
  contacto: null, vacante: null, estado: 'nuevo', fuente: 'censo',
  giro: 'transportista', urgencia: 50, cierre: 40, tamano: null, completitud: 45, ultimoToque: null,
  mensajesGeneradosEn: null,
  numUnidades: null, similitudIcpPct: 0, necesidadPct: 0,
};

const textos = (t: Partial<TextosProspecto>): TextosProspecto =>
  ({ id: 'x', notas: null, mensajeWaIa: null, correoAsuntoIa: null, correoCuerpoIa: null, ...t });

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
    const p = { ...base, mensajesGeneradosEn: '2026-08-17T00:00:00Z' };
    const t = textos({ mensajeWaIa: 'TEXTO-DEL-AGENTE', correoAsuntoIa: 'ASUNTO-IA', correoCuerpoIa: 'CUERPO-IA' });
    expect(hrefWa(p, t)).toContain(encodeURIComponent('TEXTO-DEL-AGENTE'));
    expect(hrefCorreo(p, t)).toContain(encodeURIComponent('ASUNTO-IA'));
    expect(hrefCorreo(p, t)).toContain(encodeURIComponent('CUERPO-IA'));
  });

  // FE-16: los textos largos ya no viajan en el listado. El respaldo de la
  // plantilla es correcto para quien NO tiene mensaje redactado y sería un
  // error para quien sí — mandaría el texto equivocado firmado por Javier.
  it('sin mensaje redactado, la plantilla es la respuesta correcta (no se espera nada)', () => {
    expect(esperandoTextos(base, undefined)).toBe(false);
    expect(hrefWa(base)).toContain(encodeURIComponent(mensajeWa(base)));
  });
  it('CON mensaje redactado y sin los textos todavía, el botón NO se abre con la plantilla', () => {
    const p = { ...base, mensajesGeneradosEn: '2026-08-17T00:00:00Z' };
    expect(esperandoTextos(p, undefined)).toBe(true);
    expect(esperandoTextos(p, textos({ mensajeWaIa: 'YA-LLEGÓ' }))).toBe(false);
  });
  it('la lada MX no se duplica: 52… no se vuelve 5252…', () => {
    expect(hrefWa({ ...base, telefono: '529991234567' })).toContain('wa.me/529991234567');
    expect(hrefWa(base)).toContain('wa.me/529991234567');
  });

  // ADM-15 (auditoría 24, MEDIO): DENUE entrega teléfonos con espacios y el
  // `+` de país — `replace(/^52/, '')` no los tocaba y el link salía roto
  // (`wa.me/52+52 55 1234 5678`). Se normaliza a solo dígitos primero.
  it('un teléfono con formato DENUE (+52, espacios) normaliza a solo dígitos', () => {
    expect(hrefWa({ ...base, telefono: '+52 55 1234 5678' })).toContain('wa.me/525512345678');
  });
  it('un teléfono con guiones y paréntesis también normaliza', () => {
    expect(hrefWa({ ...base, telefono: '(55) 1234-5678' })).toContain('wa.me/525512345678');
  });
  it('un teléfono que ya trae 52 pero con espacios no lo duplica', () => {
    expect(hrefWa({ ...base, telefono: '52 999 123 4567' })).toContain('wa.me/529991234567');
  });
});
