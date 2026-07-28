import { describe, it, expect } from 'vitest';
import { violaIndice, UNIQUE_VIOLATION } from './pg_errores';

// El 23505 no es una categoría: dice "chocó con algo". Qué hacer depende de con
// QUÉ. Tratar todo 23505 como benigno se traga bugs reales; tratarlo todo como
// error tumba el procesamiento y Meta reintenta el webhook en bucle.
const err = (code: string, message: string, details = '') => ({ code, message, details });

describe('violaIndice', () => {
  it('reconoce el índice por nombre en el message', () => {
    expect(violaIndice(err(UNIQUE_VIOLATION,
      'duplicate key value violates unique constraint "uq_gasto_cfdi_uuid"'),
      'uq_gasto_cfdi_uuid')).toBe(true);
  });

  it('lo reconoce también si viene en details', () => {
    expect(violaIndice(err(UNIQUE_VIOLATION, 'duplicate key value', 'Key (tenant_id, cfdi_uuid)=(...) already exists in uq_gasto_cfdi_uuid'),
      'uq_gasto_cfdi_uuid')).toBe(true);
  });

  it('NO confunde un índice con otro', () => {
    // Tragarse el choque equivocado esconde un bug distinto.
    expect(violaIndice(err(UNIQUE_VIOLATION,
      'violates unique constraint "uq_gasto_img_hash"'),
      'uq_gasto_cfdi_uuid')).toBe(false);
  });

  it('exige el código 23505: un mensaje que mencione el índice no basta', () => {
    // Sin esto, un error de permisos cuyo texto nombre la tabla se trataría como
    // duplicado benigno y el gasto se perdería en silencio.
    expect(violaIndice(err('42501', 'permission denied for uq_gasto_cfdi_uuid'),
      'uq_gasto_cfdi_uuid')).toBe(false);
  });

  it('aguanta lo que no es un error de Postgres', () => {
    for (const v of [null, undefined, 'boom', 42, new Error('boom')])
      expect(violaIndice(v, 'uq_gasto_cfdi_uuid')).toBe(false);
  });
});
