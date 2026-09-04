import { describe, it, expect } from 'vitest';
import { avisoIntegral, type DatosIntegral } from './privacidad';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 25, ALTO (línea 158, reincidente de la 24): `chat-tools.ts:172`
// devuelve `anticipo` y `operador` dentro de `viajes_flota`, una tool del
// asistente del panel (`/dashboard`) que SÍ manda su resultado al modelo de
// lenguaje externo — y la cláusula de "Transferencias a terceros" del aviso
// integral no lo enumeraba: solo hablaba de la conversación del operador.
// ═══════════════════════════════════════════════════════════════════════════

const FLOTA: DatosIntegral = {
  razonSocial: 'TRANSPORTES DEL SURESTE SA DE CV',
  domicilio: 'Av. Itzáes 500, Mérida, Yucatán',
  urlAvisoIntegral: 'https://transportesdelsureste.mx/privacidad',
  contactoPrivacidad: null,
  gps: 'sin_conector',
};

describe('LEG-3 aud25 · el aviso integral cubre el chat del panel', () => {
  it('la sección "Transferencias a terceros" dice que el asistente del panel manda nombre y montos al modelo', () => {
    const seccion = avisoIntegral(FLOTA).find((s) => s.titulo === 'Transferencias a terceros');
    expect(seccion).toBeDefined();
    const t = seccion!.parrafos.join(' ');
    expect(t).toMatch(/asistente del panel/i);
    expect(t).toMatch(/anticipo|montos de tus viajes/i);
  });
});
