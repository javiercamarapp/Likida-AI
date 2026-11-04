import { describe, it, expect } from 'vitest';
import { urlCsvEstadias } from './csv_url';

describe('MX-016 · el CSV de estadías respeta el ver-como del superadmin', () => {
  const base = { desde: '2026-09-26', hasta: '2026-10-02' };
  it('propaga ?tenant= cuando la pantalla lo trae', () => {
    expect(urlCsvEstadias(base, 't-9')).toContain('tenant=t-9');
  });
  it('sin ?tenant= (dueño de flota) no lo agrega', () => {
    expect(urlCsvEstadias(base)).not.toContain('tenant=');
  });
  it('conserva periodo y filtros', () => {
    const u = urlCsvEstadias({ ...base, terminalId: 'T1', clienteId: 'C1', operadorId: 'O1' }, 't-9');
    expect(u).toMatch(/^\/api\/v1\/estadias\?desde=2026-09-26&hasta=2026-10-02&formato=csv&terminalId=T1&clienteId=C1&operadorId=O1&tenant=t-9$/);
  });
});
