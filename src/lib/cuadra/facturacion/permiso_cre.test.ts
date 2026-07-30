import { describe, it, expect } from 'vitest';
import {
  permisoDelTicket, permisosDelTicket, identificarPorPermiso,
  normalizarPermiso, coberturaTablaCre,
} from './permiso_cre';

// ═══════════════════════════════════════════════════════════════════════════
// Los dos permisos de abajo son de TICKETS REALES que se facturaron el
// 29-jul-2026, no inventados:
//
//   G500 Megasur   PERMISO CRE : PL/22384/EXP/ES/2019   → ticket 1000724
//   La Gas Boliche PERMISO: PL/7814/EXP/ES/2015         → ticket 1670001331723
// ═══════════════════════════════════════════════════════════════════════════

const TICKET_G500 = `G500 MEGASUR
GASOLINERA DE MERIDA
RFC: GME980817IX5
ESTACION :    Calle 10
PERMISO CRE :   PL/22384/EXP/ES/2019
FORMA DE PAGO :  TARJETA CREDITO
FOLIO :   1000724
WEBID :   5480061000724`;

const TICKET_LAGAS = `ADMINISTRACION DE ESTACIONES DEL SURESTE
RFC: AES0706049E2
LA GAS BOLICHE
MERIDA CP:97101
PERMISO: PL/7814/EXP/ES/2015
FOLIO: 1670001331723`;

describe('leer el permiso CRE del ticket', () => {
  it('lo saca del ticket real de G500', () => {
    expect(permisoDelTicket(TICKET_G500)).toBe('PL/22384/EXP/ES/2019');
  });

  it('y del de La Gas, que lo escribe distinto', () => {
    // Uno dice "PERMISO CRE :" y el otro "PERMISO:". La etiqueta cambia; el
    // permiso no.
    expect(permisoDelTicket(TICKET_LAGAS)).toBe('PL/7814/EXP/ES/2015');
  });

  it('aguanta los espacios que mete el OCR', () => {
    // `PL/ 22384 /EXP/ES/2019` es el mismo permiso. Sin normalizar, la búsqueda
    // falla por un espacio y el producto dice que no conoce una estación que sí
    // tiene mapeada.
    expect(permisoDelTicket('PERMISO PL/ 22384 / EXP / ES / 2019')).toBe('PL/22384/EXP/ES/2019');
    expect(normalizarPermiso('pl/ 7814 /exp/es/2015')).toBe('PL/7814/EXP/ES/2015');
  });

  it('acepta PT además de PL', () => {
    // PL es expendio al público, PT transporte. Una flota puede recibir los dos.
    expect(permisoDelTicket('PERMISO PT/1234/EXP/ES/2018')).toBe('PT/1234/EXP/ES/2018');
  });

  it('NO confunde un folio con un permiso', () => {
    // El año de cuatro dígitos al final es lo que lo distingue. Sin esa
    // exigencia, `PL/22384` de un folio pasaría por permiso.
    expect(permisoDelTicket('FOLIO 1000724 WEBID 5480061000724')).toBeNull();
    expect(permisoDelTicket('PL/22384')).toBeNull();
    expect(permisoDelTicket('TRANSACCION 22384100072409095524')).toBeNull();
  });

  it('un ticket con varios permisos devuelve todos, sin repetir', () => {
    const t = 'PL/1/EXP/ES/2015 y otra vez PL/1/EXP/ES/2015 y PT/2/EXP/ES/2020';
    expect(permisosDelTicket(t)).toEqual(['PL/1/EXP/ES/2015', 'PT/2/EXP/ES/2020']);
  });

  it('sin texto no truena', () => {
    expect(permisoDelTicket(null)).toBeNull();
    expect(permisoDelTicket(undefined)).toBeNull();
    expect(permisosDelTicket('')).toEqual([]);
  });
});

describe('los TRES estados, que es lo que impide el bug caro', () => {
  // LA LECCIÓN DE LA AUDITORÍA 6, APLICADA ANTES DE COMETERLA. Cinco veces
  // apareció en producción un valor que significaba "no pude saber" leído como
  // "no hay". Aquí la tabla cubre ~5,200 de ~14,300 estaciones, así que
  // "no está en mi tabla" es el caso NORMAL y no puede confundirse con
  // "esa estación no existe".

  it('sin permiso en el ticket → sin_permiso', () => {
    expect(identificarPorPermiso('FOLIO 123 TOTAL $500').estado).toBe('sin_permiso');
    expect(identificarPorPermiso(null).estado).toBe('sin_permiso');
  });

  it('con permiso que NO está en la tabla → desconocido, y devuelve el permiso', () => {
    const r = identificarPorPermiso('PERMISO PL/999999/EXP/ES/2099');
    expect(r.estado).toBe('desconocido');
    // El permiso viaja de vuelta: sirve para pedírselo al humano o para
    // cosecharlo después. Perderlo aquí sería tirar el único identificador
    // estable que trae el papel.
    if (r.estado === 'desconocido') expect(r.permiso).toBe('PL/999999/EXP/ES/2099');
  });

  it('NUNCA devuelve null ni lanza: los tres estados cubren todo', () => {
    for (const t of [null, undefined, '', 'basura', TICKET_G500, 'PL/1/EXP/ES/1999']) {
      const r = identificarPorPermiso(t);
      expect(['reconocido', 'desconocido', 'sin_permiso']).toContain(r.estado);
    }
  });

  it('"desconocido" NO es una afirmación sobre el mundo', () => {
    // Esta prueba fija una promesa de diseño, no un valor: el tipo no tiene un
    // estado que diga "no existe", porque el producto no puede saberlo con una
    // tabla al 36%.
    const r = identificarPorPermiso('PL/999999/EXP/ES/2099');
    expect(Object.keys(r)).not.toContain('existe');
    expect(Object.keys(r)).not.toContain('noExiste');
  });
});

describe('la tabla', () => {
  it('tiene miles de permisos y cientos de marcas', () => {
    const { permisos, marcas } = coberturaTablaCre();
    expect(permisos).toBeGreaterThan(4000);
    expect(marcas).toBeGreaterThan(500);
  });

  it('cubre menos de la mitad del país, y por eso "desconocido" es lo normal', () => {
    // ~14,300 estaciones en el padrón. Si algún día esto falla porque la tabla
    // creció, es una buena noticia: hay que subir el número, no relajar la
    // semántica de los tres estados.
    expect(coberturaTablaCre().permisos).toBeLessThan(14_301);
  });
});
