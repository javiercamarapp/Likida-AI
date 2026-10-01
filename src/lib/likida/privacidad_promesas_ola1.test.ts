import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { avisoIntegral, versionAviso, type DatosIntegral } from './privacidad';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA OLA 1, #45 — EL AVISO PROMETÍA «LA IMAGEN QUE NO RESPALDA NINGÚN
// GASTO SE ELIMINA SOLA». El código no lo hace: `limpiar_storage_huerfano`
// (0165) NUNCA toca un objeto nombrado por `comprobante_huerfano.ruta_imagen`,
// `resolverHuerfanos(..., 'descartado')` solo sella la fila, y la 0104/0178
// decidieron tratar al huérfano como evidencia fiscal conservadora (CFF art. 30).
//
// Se corrigió el TEXTO (conservar es lo legalmente prudente). Esta prueba ata
// la promesa al código: si algún día se implementa el borrado, hay que cambiar
// el aviso Y esta prueba juntos; si el aviso vuelve a prometer una eliminación
// automática de huérfanos mientras la base los excluye, falla.
// ═══════════════════════════════════════════════════════════════════════════

const FLOTA: DatosIntegral = {
  razonSocial: 'TRANSPORTES DEL SURESTE SA DE CV',
  domicilio: 'Av. Itzáes 500, Mérida, Yucatán',
  urlAvisoIntegral: 'https://transportesdelsureste.mx/privacidad',
  contactoPrivacidad: null,
  gps: 'sin_conector',
};
const textoAviso = () => avisoIntegral(FLOTA).flatMap((s) => s.parrafos).join('\n');

describe('el aviso integral no promete un borrado que el código no hace', () => {
  it('ya no dice que la imagen sin gasto «se elimina sola»', () => {
    const t = textoAviso();
    expect(t).not.toMatch(/se elimina sola/i);
    expect(t).not.toMatch(/imagen que no respalda ning[uú]n gasto se elimina/i);
  });

  it('dice la verdad: la imagen que aún no respalda un gasto NO se borra sola y por qué', () => {
    const t = textoAviso();
    expect(t).toMatch(/NO se borra sola/);
    expect(t).toMatch(/CFF art\. 30/);
    expect(t).toMatch(/no entra a ninguna liquidaci[oó]n/);
  });

  it('cambiar el texto cambia la versión del aviso (el operador lo vuelve a ver)', () => {
    const nuevo = textoAviso();
    const viejo = nuevo.replace(/\*\*La imagen de un comprobante que todavía no respalda[^]*?\(CFF art\. 30\)\./, 'La imagen que no respalda ningún gasto se elimina sola del almacenamiento.');
    expect(viejo).not.toBe(nuevo);
    expect(versionAviso(nuevo)).not.toBe(versionAviso(viejo));
  });
});

describe('la premisa del aviso sigue siendo verdad en la base', () => {
  const MIGS = 'supabase/migrations';
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- ruta armada con constantes de esta prueba (directorio de migraciones + prefijo fijo); sin entrada de usuario.
  const sql = (n: string) => readFileSync(`${MIGS}/${readdirSync(MIGS).find((f) => f.startsWith(n))!}`, 'utf8');

  it('el barrido de huérfanos de Storage excluye lo nombrado por comprobante_huerfano.ruta_imagen (0165)', () => {
    expect(sql('0165_')).toMatch(/not exists \(\s*select 1 from public\.comprobante_huerfano h where h\.ruta_imagen = j\.name/);
  });

  it('el clasificador trata esas rutas como fiscal_cff_30: el ejecutor HTTP nunca las borra (0178)', () => {
    expect(sql('0178_')).toMatch(/comprobante_huerfano h\s+where h\.ruta_imagen = new\.nombre/);
    expect(sql('0178_')).toMatch(/new\.clase_retencion := 'fiscal_cff_30'/);
  });
});
