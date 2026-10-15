import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// El repo importa supabaseAdmin: aquí solo se necesita el defecto, no la base.
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('la vista no toca la base'); } }));

const { VistaConfiguracionLiquidacion, leerFormularioConfig, MAX_RH } = await import('./vista');
const { CONFIG_CORREO_POR_DEFECTO } = await import('@/lib/likida/liquidacion_externa/repo_correo');
const { puedeVerRuta, puedeVerArea } = await import('@/lib/auth/visibilidad');
import type { ConfigCorreo } from '@/lib/likida/liquidacion_externa/repo_correo';

const nada = async () => {};
const acciones = { guardar: nada };
const pintar = (o: Partial<Parameters<typeof VistaConfiguracionLiquidacion>[0]> = {}) => renderToStaticMarkup(
  <VistaConfiguracionLiquidacion
    sufijo="?tenant=f-1" aviso={null} error={null} config={{ ...CONFIG_CORREO_POR_DEFECTO }}
    hayFila={false} disponible puedeAdministrar acciones={acciones} {...o}
  />,
);

/** Un formulario válido y sintético; cada caso cambia solo lo que prueba. */
function formulario(cambios: Record<string, string | string[] | null> = {}): FormData {
  const base: Record<string, string | string[] | null> = {
    canal: 'correo', activa: null, remitenteNombre: 'Desgloses de la flota', responderA: 'contacto@ejemplo.test',
    rhCorreos: 'rh1@ejemplo.test\nrh2@ejemplo.test', archivoCorreo: 'archivo@ejemplo.test', enviaCoordinador: 'on',
    agruparViaje: 'on', etiquetaViaje: 'Pago de viaje', conceptosViaje: 'Sueldo\nViáticos',
    renombres: 'Descuento A → Otros', conceptosProhibidos: 'Concepto interno', tiposQueReciben: ['foraneo', 'local'],
    netoNegativo: 'retener', enviarDesdeHora: '8',
  };
  const fd = new FormData();
  for (const [k, v] of Object.entries({ ...base, ...cambios })) {
    if (v === null) continue;
    if (Array.isArray(v)) v.forEach((x) => fd.append(k, x)); else fd.set(k, v);
  }
  return fd;
}
const ok = (fd: FormData): ConfigCorreo => {
  const r = leerFormularioConfig(fd);
  if (!r.ok) throw new Error(`se esperaba válido: ${r.error}`);
  return r.config;
};
const error = (fd: FormData): string => {
  const r = leerFormularioConfig(fd);
  if (r.ok) throw new Error('se esperaba un error');
  return r.error;
};

describe('guardado válido', () => {
  it('traduce el formulario a la configuración', () => {
    const c = ok(formulario({ activa: 'on' }));
    expect(c).toMatchObject({
      canal: 'correo', activa: true, remitenteNombre: 'Desgloses de la flota', responderA: 'contacto@ejemplo.test',
      rhCorreos: ['rh1@ejemplo.test', 'rh2@ejemplo.test'], archivoCorreo: 'archivo@ejemplo.test', enviaCoordinador: true,
      agruparViaje: true, etiquetaViaje: 'Pago de viaje', conceptosViaje: ['Sueldo', 'Viáticos'],
      conceptosProhibidos: ['Concepto interno'], tiposQueReciben: ['foraneo', 'local'], netoNegativo: 'retener', enviarDesdeHora: 8,
    });
  });

  it('nunca activa el envío por omisión: sin la casilla, activa es false', () => {
    expect(ok(formulario()).activa).toBe(false);
    expect(ok(formulario({ activa: null, canal: 'ambos' })).activa).toBe(false);
  });

  it('normaliza correos (minúsculas, sin espacios) y acepta RH separado por comas o punto y coma, sin repetir', () => {
    const c = ok(formulario({ rhCorreos: ' RH1@Ejemplo.test, rh2@ejemplo.test; rh1@ejemplo.test ', responderA: ' Contacto@Ejemplo.test ' }));
    expect(c.rhCorreos).toEqual(['rh1@ejemplo.test', 'rh2@ejemplo.test']);
    expect(c.responderA).toBe('contacto@ejemplo.test');
  });

  it('campos opcionales vacíos quedan en null / lista vacía, y el tipo permisionario se acepta', () => {
    const c = ok(formulario({ remitenteNombre: '', responderA: '', rhCorreos: '', archivoCorreo: '', enviarDesdeHora: '', tiposQueReciben: ['permisionario'], enviaCoordinador: null }));
    expect(c).toMatchObject({ remitenteNombre: null, responderA: null, rhCorreos: [], archivoCorreo: null, enviarDesdeHora: null, tiposQueReciben: ['permisionario'], enviaCoordinador: false, enviaRh: false });
  });

  it('ignora tipos que no existen y hora 0 es válida', () => {
    const c = ok(formulario({ tiposQueReciben: ['foraneo', 'inventado'], enviarDesdeHora: '0' }));
    expect(c.tiposQueReciben).toEqual(['foraneo']);
    expect(c.enviarDesdeHora).toBe(0);
  });

  it('los renombres se guardan como texto literal escapado: nada de regex libre del usuario', () => {
    const c = ok(formulario({ renombres: 'Concepto (A+) → Otros\nB.* -> Varios' }));
    expect(c.renombres).toEqual([
      { texto: 'Concepto (A+)', patron: 'Concepto \\(A\\+\\)', flags: 'i', a: 'Otros', fusionar: false },
      { texto: 'B.*', patron: 'B\\.\\*', flags: 'i', a: 'Varios', fusionar: false },
    ]);
    for (const r of c.renombres as Array<{ patron: string; flags: string }>) expect(() => new RegExp(r.patron, r.flags)).not.toThrow();
  });
});

describe('guardado inválido: lenguaje llano, nada se guarda', () => {
  it('correo mal formado en cada campo de correo', () => {
    expect(error(formulario({ rhCorreos: 'rh1@ejemplo.test\nsin-arroba' }))).toContain('no tiene forma de correo');
    expect(error(formulario({ responderA: 'no es correo' }))).toContain('Responder a');
    expect(error(formulario({ archivoCorreo: 'a@b' }))).toContain('Buzón de archivo');
  });

  it(`más de ${MAX_RH} correos de RH`, () => {
    const e = error(formulario({ rhCorreos: 'a@ejemplo.test\nb@ejemplo.test\nc@ejemplo.test\nd@ejemplo.test' }));
    expect(e).toContain('hasta 3');
    expect(e).toContain('pusiste 4');
  });

  it('etiqueta vacía con el viaje activo', () => {
    expect(error(formulario({ etiquetaViaje: '   ' }))).toContain('ponle una etiqueta');
  });

  it('con el viaje apagado una etiqueta vacía no estorba (queda el texto por defecto)', () => {
    const c = ok(formulario({ agruparViaje: null, etiquetaViaje: '' }));
    expect(c.agruparViaje).toBe(false);
    expect(c.etiquetaViaje).toBe('Pago de viaje');
  });

  it('viaje activo sin conceptos que fundir', () => {
    expect(error(formulario({ conceptosViaje: '' }))).toContain('qué conceptos');
  });

  it('canal desconocido o ausente', () => {
    expect(error(formulario({ canal: 'sms' }))).toContain('Elige cómo se entrega');
    expect(error(formulario({ canal: null }))).toContain('Elige cómo se entrega');
  });

  it('hora fuera de rango o no entera', () => {
    for (const h of ['24', '-1', '7.5', 'abc']) expect(error(formulario({ enviarDesdeHora: h }))).toContain('de 0 a 23');
  });

  it('renombre sin flecha, sin etiqueta o con dos flechas', () => {
    expect(error(formulario({ renombres: 'solo texto' }))).toContain('Renombre 1');
    expect(error(formulario({ renombres: 'a → ' }))).toContain('Renombre 1');
    expect(error(formulario({ renombres: 'bien → Otros\na → b → c' }))).toContain('Renombre 2');
  });

  it('topes de la migración: remitente, conceptos, renombres, retenidos', () => {
    expect(error(formulario({ remitenteNombre: 'x'.repeat(81) }))).toContain('remitente');
    expect(error(formulario({ conceptosViaje: Array.from({ length: 21 }, (_, i) => `c${i}`).join('\n') }))).toContain('máximo 20');
    expect(error(formulario({ renombres: Array.from({ length: 51 }, (_, i) => `a${i} → b`).join('\n') }))).toContain('máximo 50');
    expect(error(formulario({ conceptosProhibidos: Array.from({ length: 51 }, (_, i) => `c${i}`).join('\n') }))).toContain('máximo 50');
  });
});

describe('la pantalla', () => {
  it('sin fila nace en modo WhatsApp, apagada, y lo dice', () => {
    const html = pintar();
    expect(html).toContain('Todavía no hay configuración guardada');
    expect(html).toContain('sigue entregando por WhatsApp');
    expect(html).toMatch(/<option value="whatsapp" selected/);
    expect(html).not.toMatch(/name="activa"[^>]*checked/);
    expect(html).toContain('Guardar configuración');
    expect(CONFIG_CORREO_POR_DEFECTO).toMatchObject({ canal: 'whatsapp', activa: false, rhCorreos: [], archivoCorreo: null, remitenteNombre: null });
  });

  it('con configuración muestra lo guardado, incluidos los renombres', () => {
    const config: ConfigCorreo = {
      ...CONFIG_CORREO_POR_DEFECTO, canal: 'ambos', activa: true, rhCorreos: ['rh1@ejemplo.test'], archivoCorreo: 'archivo@ejemplo.test',
      agruparViaje: true, etiquetaViaje: 'Viaje', enviarDesdeHora: 9,
      renombres: [{ texto: 'Descuento A', patron: 'Descuento A', flags: 'i', a: 'Otros', fusionar: false }],
    };
    const html = pintar({ config, hayFila: true });
    expect(html).not.toContain('Todavía no hay configuración guardada');
    expect(html).toMatch(/<option value="ambos" selected/);
    expect(html).toMatch(/name="activa"[^>]*checked/);
    expect(html).toContain('rh1@ejemplo.test');
    expect(html).toContain('archivo@ejemplo.test');
    expect(html).toContain('Descuento A → Otros');
    expect(html).toContain('value="9"');
  });

  it('quien no administra lo ve pero no puede guardar: campos deshabilitados y sin botón', () => {
    const html = pintar({ puedeAdministrar: false });
    expect(html).toContain('Solo el dueño de la flota');
    expect(html).not.toContain('Guardar configuración');
    expect(html).toMatch(/<select name="canal"[^>]*disabled/);
  });

  it('si la base no tiene las migraciones lo dice y no ofrece guardar', () => {
    const html = pintar({ disponible: false });
    expect(html).toContain('todavía no está disponible en esta base');
    expect(html).not.toContain('Guardar configuración');
    expect(html).not.toContain('Todavía no hay configuración guardada');
  });

  it('muestra el aviso y el error (con rol de alerta) y escapa lo que traigan', () => {
    const html = pintar({ aviso: 'Listo <b>x</b>', error: 'Falló <script>' });
    expect(html).toContain('role="status"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Falló &lt;script&gt;');
    expect(html).not.toContain('<b>x</b>');
  });

  it('escapa los valores guardados', () => {
    const html = pintar({ config: { ...CONFIG_CORREO_POR_DEFECTO, remitenteNombre: '"><script>x</script>' }, hayFila: true });
    expect(html).not.toContain('<script>x</script>');
  });

  it('vuelve al agente conservando el contexto de la flota', () => {
    expect(pintar()).toContain('/dashboard/agentes/liquidacion?tenant=f-1');
  });

  it('no menciona razones sociales ni marcas del cliente', () => {
    expect(pintar()).not.toMatch(/innovativ|lore/i);
  });
});

describe('solo administradores', () => {
  const RUTA = '/dashboard/agentes/liquidacion/configuracion';
  it('la ruta existe para el dueño y el contador (dinero) pero no para el jefe de tráfico', () => {
    expect(puedeVerRuta('flota_admin', RUTA)).toBe(true);
    expect(puedeVerRuta('contador', RUTA)).toBe(true);
    expect(puedeVerRuta('encargado', RUTA)).toBe(false);
  });
  it('guardar exige el área de administración: el contador la ve pero no guarda', () => {
    expect(puedeVerArea('flota_admin', 'administracion')).toBe(true);
    expect(puedeVerArea('contador', 'administracion')).toBe(false);
    expect(puedeVerArea('encargado', 'administracion')).toBe(false);
  });
});
