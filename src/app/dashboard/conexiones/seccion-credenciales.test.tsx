import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CONECTORES_PORTALES_FACTURACION } from '@/lib/likida/conectores/portales_facturacion';
import { CONECTORES_GPS } from '@/lib/likida/conectores/gps';
import {
  SeccionCredenciales, catalogoParaCaptura, pistasConRotulo, estadoDePrueba,
  type CredencialPantalla,
} from './seccion-credenciales';

// ═══════════════════════════════════════════════════════════════════════════
// LA SECCIÓN DEL COFRE, PROBADA SOBRE EL RENDER (C2, auditoría 4).
//
// Lo que se fija: el catálogo de captura se DERIVA (todos los que piden
// credenciales, GPS INCLUIDOS desde agosto-2026); capturar es CONTROL y la
// forma solo se pinta al dueño con el cofre configurado; y los estados dicen
// la verdad — "guardada, sin probar" no se pinta como conectada, una prueba
// fallida no se pinta como "sin probar", y una lectura caída no se pinta como
// lista vacía.
// ═══════════════════════════════════════════════════════════════════════════

const accion = async () => null;
const acciones = { guardar: accion, desactivar: accion, probar: accion };

/** La firma del BOTÓN de probar en el HTML. El texto «Probar conexión»
 *  también aparece en el párrafo de la sección, así que buscarlo no
 *  distinguiría «hay botón» de «se explica el botón». */
const ICONO_PROBAR = 'lucide-plug-zap';

const FILA_SIN_PROBAR: CredencialPantalla = {
  conectorId: 'sap_b1',
  nombre: 'SAP Business One',
  pistas: [
    { rotulo: 'Dirección de tu Service Layer', valor: 'https://sap.cliente.mx:50000' },
    { rotulo: 'Contraseña de ese usuario', valor: '…3t0!' },
  ],
  activo: true,
  probadaEn: null,
  ultimoError: null,
  creadaEn: '2026-08-14T10:00:00Z',
};

function pintar(p: {
  cofreListo: boolean;
  puedeAdministrarCofre: boolean;
  guardadas: CredencialPantalla[] | null;
}) {
  return renderToStaticMarkup(
    <SeccionCredenciales {...p} grupos={catalogoParaCaptura()} acciones={acciones} />,
  );
}

describe('catalogoParaCaptura — derivado del catálogo, nunca una segunda lista', () => {
  it('trae exactamente los que piden credenciales', () => {
    const ids = catalogoParaCaptura().flatMap((g) => g.conectores.map((c) => c.id));
    // Los 4 capturables de siempre + los 5 de GPS (agosto-2026) + los portales
    // de facturación con cuenta (20-ago-2026). Esa última mitad se DERIVA del
    // mismo registro que la pantalla, porque su lista vive en `comercios.ts` y
    // crece con él; los fijos se quedan escritos para que un cambio ahí no
    // pase sin que esta prueba lo vea.
    const esperados = [
      'odoo', 'oracle_fusion', 'powergas', 'sap_b1',
      ...CONECTORES_GPS.map((c) => c.id),
      ...CONECTORES_PORTALES_FACTURACION.map((c) => c.id),
    ].sort();
    expect(ids.sort()).toEqual(esperados);
  });

  it('LOS GPS SÍ VIENEN — el motor lee conector_credencial, que es lo que llena esta pantalla', () => {
    // La regresión que esto fija: el filtro `claveAlmacen === null` los sacaba
    // del ÚNICO formulario de captura, apuntando a `rastreo_credencial`, una
    // tabla sin un solo escritor en `src/`. Con ellos fuera, el cron de
    // posiciones y la asistencia por cámara eran inalcanzables.
    const ids = catalogoParaCaptura().flatMap((g) => g.conectores.map((c) => c.id));
    for (const gps of ['wialon', 'samsara', 'geotab', 'navixy', 'gps_generico']) {
      expect(ids).toContain(gps);
    }
  });

  it('agrupa ERP, Rastreo, Peajes y Portales, y todo conector trae sus campos con forma', () => {
    const grupos = catalogoParaCaptura();
    expect(grupos.map((g) => g.categoria)).toEqual([
      'ERP y contabilidad', 'Rastreo GPS', 'Peaje y monederos', 'Portal de facturación',
    ]);
    for (const c of grupos.flatMap((g) => g.conectores)) {
      expect(c.campos.length).toBeGreaterThan(0);
      for (const campo of c.campos) expect(campo.rotulo).toBeTruthy();
    }
  });
});

describe('estadoDePrueba — tres estados, porque los dos campos solos mienten', () => {
  const base = { activo: true, probadaEn: null as string | null, ultimoError: null as string | null };

  it('nunca probada: `null` no es cero y no es un fallo', () => {
    expect(estadoDePrueba(base)).toEqual({ texto: 'guardada — sin probar contra el sistema real', tono: 'warn' });
  });

  it('probada: dice la fecha, que es la evidencia', () => {
    expect(estadoDePrueba({ ...base, probadaEn: '2026-08-27T10:00:00Z' }).tono).toBe('ok');
  });

  it('la última prueba falló: NO se pinta «sin probar» — eso manda a apretar un botón ya apretado', () => {
    const r = estadoDePrueba({ ...base, ultimoError: 'Samsara rechazó la credencial (401).' });
    expect(r).toEqual({ texto: 'la última prueba FALLÓ', tono: 'bad' });
  });

  it('desactivada gana sobre todo lo demás', () => {
    expect(estadoDePrueba({ activo: false, probadaEn: '2026-08-27T10:00:00Z', ultimoError: null }).texto)
      .toBe('desactivada');
  });
});

describe('pistasConRotulo — el rótulo humano sale del catálogo', () => {
  it('resuelve el rótulo del campo, y una clave desconocida se enseña cruda', () => {
    const r = pistasConRotulo('sap_b1', { base_url: 'https://sap.cliente.mx', clave_vieja: 'x' });
    expect(r).toContainEqual({ rotulo: 'Dirección de tu Service Layer', valor: 'https://sap.cliente.mx' });
    expect(r).toContainEqual({ rotulo: 'clave_vieja', valor: 'x' });
  });

  it('un conector fuera del catálogo no rompe: claves crudas', () => {
    expect(pistasConRotulo('retirado', { usuario: 'u' })).toEqual([{ rotulo: 'usuario', valor: 'u' }]);
  });
});

describe('SeccionCredenciales — estados honestos y gateo', () => {
  it('sin cofre: dice QUÉ falta y NO ofrece capturar', () => {
    const html = pintar({ cofreListo: false, puedeAdministrarCofre: true, guardadas: [] });
    expect(html).toContain('LIKIDA_COFRE_LLAVE');
    expect(html).not.toContain('Elige el sistema');
  });

  it('con cofre y siendo dueño: la forma de captura se pinta', () => {
    const html = pintar({ cofreListo: true, puedeAdministrarCofre: true, guardadas: [] });
    expect(html).toContain('Elige el sistema');
    // Y el select agrupa por categoría con los sistemas reales del catálogo.
    expect(html).toContain('SAP Business One');
    expect(html).toContain('PowerGAS');
  });

  it('con cofre sin ser dueño: sin forma, y se dice a quién pedírselo', () => {
    const html = pintar({ cofreListo: true, puedeAdministrarCofre: false, guardadas: [] });
    expect(html).not.toContain('Elige el sistema');
    expect(html).toContain('dueño de la flota');
  });

  it('lectura caída: se dice — no se pinta una lista vacía que invite a recapturar', () => {
    const html = pintar({ cofreListo: true, puedeAdministrarCofre: true, guardadas: null });
    expect(html).toContain('No se pudieron leer las credenciales');
    expect(html).not.toContain('Aún no hay credenciales');
  });

  it('una guardada sin probar lo DICE — y el dueño puede probarla y desactivarla', () => {
    const html = pintar({ cofreListo: true, puedeAdministrarCofre: true, guardadas: [FILA_SIN_PROBAR] });
    expect(html).toContain('sin probar contra el sistema real');
    expect(html).toContain('…3t0!');
    expect(html).toContain('Desactivar');
    // El botón que faltaba: sin él `probar()` era código muerto y esta fila
    // decía «sin probar» para siempre. Se busca el ÍCONO y no el texto: el
    // párrafo de arriba también dice «Probar conexión» y haría pasar la
    // aserción con el botón ausente.
    expect(html).toContain(ICONO_PROBAR);
  });

  it('una prueba fallida enseña el mensaje del proveedor TAL CUAL, no un «falló» genérico', () => {
    const html = pintar({
      cofreListo: true,
      puedeAdministrarCofre: true,
      guardadas: [{ ...FILA_SIN_PROBAR, ultimoError: 'SAP Business One rechazó la credencial (401).' }],
    });
    expect(html).toContain('la última prueba FALLÓ');
    expect(html).toContain('SAP Business One rechazó la credencial (401).');
    expect(html).not.toContain('sin probar contra el sistema real');
  });

  it('una desactivada lo dice y ya no ofrece desactivar; sin ser dueño tampoco', () => {
    const apagada = { ...FILA_SIN_PROBAR, activo: false };
    expect(pintar({ cofreListo: true, puedeAdministrarCofre: true, guardadas: [apagada] }))
      .toContain('desactivada');
    expect(pintar({ cofreListo: true, puedeAdministrarCofre: true, guardadas: [apagada] }))
      .not.toContain('Sí, desactivar');

    const html = pintar({ cofreListo: true, puedeAdministrarCofre: false, guardadas: [FILA_SIN_PROBAR] });
    expect(html).not.toContain('Desactivar');
    // Probar DESCIFRA un secreto y ESCRIBE en la fila: es control, igual que
    // desactivar. Al que solo mira, ni el botón se le pinta.
    expect(html).not.toContain(ICONO_PROBAR);
  });
});
