import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VistaConfiguracionPeajes, type BuzonVista, type AccionesConfiguracion } from './vista';
import type { EntradasVista } from './entradas';

const nada = async () => {};
const acciones: AccionesConfiguracion = {
  activarBuzon: nada, desactivarBuzon: nada, rotarLlave: nada, reintentarArchivo: nada, altaTag: nada, bajaTag: nada, importarTags: nada,
  importarCasetas: nada, estadoCaseta: nada, guardarGeocerca: nada, estadoGeocerca: nada, guardarMapeo: nada, borrarMapeo: nada,
  activarCorreo: nada, desactivarCorreo: nada, rotarCorreo: nada, guardarRemitentes: nada, guardarPull: nada, apagarPull: nada, borrarCredencialPull: nada,
};
const entradasBase: EntradasVista = { config: null, puedeAdministrar: true, direccionCorreo: null, cofreConfigurado: true };
const LLAVE = 'a'.repeat(64);
const buzonActivo: BuzonVista = { estado: 'activo', rotacion: 2, secretoConfigurado: true, puedeAdministrar: true, llave: LLAVE, url: 'https://app.likida.ai/api/peajes/ingesta', flotaId: 'f-1' };

function pintar(o: Partial<Parameters<typeof VistaConfiguracionPeajes>[0]> = {}) {
  return renderToStaticMarkup(
    <VistaConfiguracionPeajes
      sufijo="" aviso={null} error={null} agenteApagado={null}
      tags={[]} unidades={[{ id: 'u1', numeroEconomico: 'C2-08', placas: 'ABC-123' }]} casetas={[]} geocercas={[]} mapeos={[]} archivos={[]}
      tiposGeocerca={['origen', 'punto_interes']} buzon={buzonActivo} entradas={entradasBase} acciones={acciones}
      {...o}
    />,
  );
}

describe('la llave del buzón es un secreto', () => {
  it('quien administra la ve, con la URL y la flota', () => {
    const html = pintar();
    expect(html).toContain(LLAVE);
    expect(html).toContain('https://app.likida.ai/api/peajes/ingesta');
    expect(html).toContain('x-likida-firma');
  });
  it('quien NO administra no la ve (aunque llegue en props, no se pinta)', () => {
    const html = pintar({ buzon: { ...buzonActivo, puedeAdministrar: false } });
    expect(html).not.toContain(LLAVE);
    expect(html).toContain('solo la ve quien administra');
    expect(html).not.toContain('Rotar llave');
  });
  it('sin llave calculada (buzón inactivo) no hay campo de llave', () => {
    const html = pintar({ buzon: { ...buzonActivo, estado: 'inactivo', llave: null } });
    expect(html).not.toContain('Llave de firma');
    expect(html).toContain('Activar buzón');
  });
  it('sin PEAJES_INGESTA_SECRETO lo dice con todas sus letras', () => {
    expect(pintar({ buzon: { ...buzonActivo, secretoConfigurado: false, llave: null } })).toContain('Falta PEAJES_INGESTA_SECRETO');
  });
  it('estado ilegible: «no se pudo leer», no «desactivado»', () => {
    const html = pintar({ buzon: { ...buzonActivo, estado: 'ilegible', llave: null } });
    expect(html).toContain('No se pudo leer el estado del buzón');
    expect(html).not.toContain('Buzón desactivado');
  });
});

describe('honestidad de los catálogos', () => {
  it('catálogo de casetas vacío: dice que no valida nada y que nunca acusa', () => {
    const html = pintar();
    expect(html).toContain('Nace vacío a propósito');
    expect(html).toContain('nunca una acusación');
  });
  it('lecturas fallidas (null) dicen «no se pudo leer», no «aún no hay»', () => {
    const html = pintar({ tags: null, casetas: null, geocercas: null, mapeos: null, archivos: null });
    for (const que of ['los TAGs', 'las casetas', 'las geocercas', 'los mapeos', 'los archivos recibidos']) expect(html).toContain(`No se pudo leer ${que}`);
    expect(html).not.toContain('Aún no hay TAGs');
  });
  it('el aviso del archivo REAL de PASE sin calibrar está a la vista', () => {
    expect(pintar()).toContain('archivo REAL de PASE todavía no se ha calibrado');
  });
});

describe('archivos recibidos', () => {
  const base = { id: 'a1', nombre: 'corte.xlsx', proveedor: 'PASE', intentos: 1, bytes: 20_480, recibidaEn: '2026-10-01T12:00:00Z', procesadaEn: null, desgloseId: null, ultimoError: null };
  it('un fallido muestra su motivo y el botón de reintentar; un procesado enlaza al desglose', () => {
    const html = pintar({
      archivos: [
        { ...base, estado: 'fallida', reintentable: true, ultimoError: 'No encontré la columna de importe en el archivo.' },
        { ...base, id: 'a2', nombre: 'ok.xlsx', estado: 'procesada', reintentable: false, desgloseId: 'd7' },
      ],
    });
    expect(html).toContain('No encontré la columna de importe');
    expect(html).toContain('Reintentar');
    expect(html).toContain('desglose=d7');
    expect(html).toContain('falló');
  });
  it('el texto del error del proveedor se escapa (no es HTML)', () => {
    const html = pintar({ archivos: [{ ...base, estado: 'fallida', reintentable: true, ultimoError: '<img src=x onerror=alert(1)>' }] });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });
});

describe('mensajes', () => {
  it('aviso y error se pintan con su rol accesible, escapados', () => {
    const html = pintar({ aviso: 'Listo <b>x</b>', error: 'Falló' });
    expect(html).toContain('role="status"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Listo &lt;b&gt;x&lt;/b&gt;');
  });
  it('el agente apagado se avisa', () => {
    expect(pintar({ agenteApagado: 'El agente de Peajes está apagado' })).toContain('apagado');
  });
  it('tags y mapeos existentes se listan con su botón de borrar accesible', () => {
    const html = pintar({
      tags: [{ id: 't1', tag: 'IMDM10000001', tagOriginal: 'IMDM 10000001', unidadId: 'u1', unidadEconomico: 'C2-08', proveedor: 'PASE', activo: true }],
      mapeos: [{ id: 'm1', proveedor: 'PASE', activo: true, columnas: { fecha: 'Fecha de cobro', caseta: 'Plaza', monto: 'Importe', hora: 'Hora' } }],
    });
    expect(html).toContain('IMDM 10000001');
    expect(html).toContain('→ C2-08');
    expect(html).toContain('Eliminar el TAG IMDM10000001');
    expect(html).toContain('Eliminar el mapeo de PASE');
    expect(html).toContain('hora=«Hora»');
  });
});

describe('recepción por correo y pull (0563)', () => {
  const cfg = { correoActivo: true, correoToken: 'abcdefghjkmnpqrstvwxyz23', remitentes: ['pase.example'], pullUrl: 'https://tms.flota.example/cortes', pullActivo: true, pullIntervaloMin: 60, pullUltimoEn: '2026-10-01T12:00:00Z', pullUltimoError: null, pullConCredencial: true };
  const E = (o: Partial<EntradasVista> = {}): EntradasVista => ({ config: cfg, puedeAdministrar: true, direccionCorreo: 'pj-abcdefghjkmnpqrstvwxyz23@mail.likida.ai', cofreConfigurado: true, ...o });

  it('muestra la dirección del buzón de correo, los remitentes permitidos y los botones de quien administra', () => {
    const html = pintar({ entradas: E() });
    expect(html).toContain('pj-abcdefghjkmnpqrstvwxyz23@mail.likida.ai');
    expect(html).toContain('pase.example');
    expect(html).toContain('Cambiar dirección');
    expect(html).toContain('Guardar remitentes');
  });

  it('quien NO administra ve el estado pero ningún botón que cambie algo, y el token no se imprime nunca', () => {
    const html = pintar({ entradas: E({ puedeAdministrar: false }) });
    expect(html).toContain('Solo quien administra la flota cambia esto');
    for (const b of ['Cambiar dirección', 'Guardar remitentes', 'Guardar y encender', 'Borrar el token guardado']) expect(html).not.toContain(b);
    expect(html).not.toContain('type="password"');
  });

  it('correo apagado ofrece «Activar correo» y no enseña la dirección', () => {
    const html = pintar({ entradas: E({ config: { ...cfg, correoActivo: false } }) });
    expect(html).toContain('Activar correo');
    expect(html).not.toContain('pj-abcdefghjkmnpqrstvwxyz23@');
  });

  it('sin dominio de correo en el servidor lo dice (no inventa una dirección)', () => {
    expect(pintar({ entradas: E({ direccionCorreo: null }) })).toContain('Falta RESEND_EMAIL_DOMAIN');
  });

  it('pull: URL, intervalo, última consulta buena y el último error del endpoint, escapado', () => {
    const html = pintar({ entradas: E({ config: { ...cfg, pullUltimoError: '<script>x</script> HTTP 500' } }) });
    expect(html).toContain('https://tms.flota.example/cortes');
    expect(html).toContain('cada 1 h');
    expect(html).toContain('2026-10-01 12:00 UTC');
    expect(html).toContain('Última consulta con problema');
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('el token guardado no vuelve a la pantalla (solo se sabe que existe) y sin cofre el campo se deshabilita con el motivo', () => {
    const html = pintar({ entradas: E({ cofreConfigurado: false }) });
    expect(html).toContain('ya hay uno guardado');
    expect(html).toContain('Falta LIKIDA_COFRE_LLAVE');
    expect(html).toMatch(/name="token"[^>]*disabled/);
    expect(html).not.toMatch(/name="token"[^>]*value=/);
  });

  it('lectura fallida de la configuración dice «no se pudo leer», no «apagado»', () => {
    const html = pintar({ entradas: E({ config: null }) });
    expect(html).toContain('No se pudo leer esta configuración');
  });
});
