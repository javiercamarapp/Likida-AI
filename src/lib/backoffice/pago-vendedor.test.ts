import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba es pura'); } }));
vi.mock('@/lib/saas/transferencia', () => ({ listarFacturasSaas: vi.fn(), TECHO_FACTURAS_SAAS: 2000 }));

import { admin_backoffice } from '@/lib/i18n/es/admin_backoffice';
import { CLAVE_FALTA } from './pago-vendedor';
import type { FaltaParaAutorizar } from './comisiones';

describe('pago a vendedores: cada razón de bloqueo tiene su mensaje', () => {
  it('toda «falta» de listoParaAutorizar mapea a una clave del diccionario', () => {
    const faltas: FaltaParaAutorizar[] = ['cfdi_honorarios', 'saldo_no_positivo', 'monto_invalido', 'monto_excede_saldo'];
    for (const f of faltas) expect(Object.keys(admin_backoffice)).toContain(CLAVE_FALTA[f]);
  });
  it('sin CFDI el mensaje lo dice con todas las letras', () => {
    expect(admin_backoffice[CLAVE_FALTA.cfdi_honorarios as keyof typeof admin_backoffice]).toContain('CFDI de honorarios');
  });
});
