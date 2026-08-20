// ═══════════════════════════════════════════════════════════════════════════
// EL ENSAYO DE FACTURACIÓN, A DEMANDA, SOBRE UN TICKET QUE YA ENTRÓ POR WHATSAPP.
//
//   TENANT_ID=... GASTO_ID=... \
//   npx vitest run --config pruebas-manuales/vitest.config.ts \
//     pruebas-manuales/factura-punta-a-punta.prueba.ts
//
// ── POR QUÉ EXISTE ────────────────────────────────────────────────────────
//
// El único disparador de facturación en producción es el cron
// (`/api/cron/facturar`, GET con `Bearer CRON_SECRET`). `processor.ts` NO
// factura al recibir la foto ni al cerrar el viaje —verificado con grep, no hay
// una sola llamada a `facturarAlVuelo` fuera del cron—, así que probar "de punta
// a punta" desde WhatsApp significaba mandar la foto y esperar a que la hora
// cayera. Esto corre el MISMO camino sobre el MISMO gasto, ahora.
//
// No es una copia del cron: llama a `facturarAlVuelo`, que es la única función
// que decide si se emite y la única que escribe el UUID. Una copia verificaría
// la copia.
//
// ── LO QUE NO HACE ────────────────────────────────────────────────────────
//
// No emite. El modo default es `ensayo` —llena todos los campos del portal,
// toma la captura y NO aprieta el botón— y el modo pedido pasa por
// `modoEfectivo()`, que es el candado del mandato de `facturacion/modo.ts`: sin
// `FACTURACION_MANDATO_ACEPTADO=si` un `emitir` se degrada a `ensayo`. Este
// arnés NO lo esquiva a propósito; lo que sí hace es DECIR en el reporte cuál
// fue el modo que de verdad corrió, para que nadie lea "ensayo" creyendo que
// pidió emitir, ni al revés.
//
// Tampoco escribe datos fiscales ni da de alta nada: si a la flota le falta
// algo, lo dice y se detiene. El escritor de los cinco fiscales ya existe y es
// `/dashboard/suscripcion` (`guardarDatosFiscales`); duplicarlo aquí sería la
// trampa que CLAUDE.md ya documenta.
// ═══════════════════════════════════════════════════════════════════════════

import { test } from 'vitest';
import { mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { facturarAlVuelo, CONFIANZA_MINIMA_AUTOFACTURA } from '@/lib/likida/facturacion/al_vuelo';
import { armar } from '@/lib/likida/facturacion/pendientes';
import { getFiscalDeFlota } from '@/lib/likida/facturacion/flota_fiscal';
import { conPortales, PORTALES_CONOCIDOS } from '@/lib/likida/facturacion/adaptadores/registro';
import { conNavegador } from '@/lib/likida/facturacion/adaptadores/pagina_playwright';
import { modoEfectivo, mandatoFiscalAceptado } from '@/lib/likida/facturacion/modo';

const TENANT_ID = process.env.TENANT_ID ?? '';
const GASTO_ID = process.env.GASTO_ID ?? '';
/** Lo que se PIDE. Lo que corre lo decide `modoEfectivo`, y se reporta. */
const MODO_PEDIDO = process.env.MODO === 'emitir' ? 'emitir' : 'ensayo';

const HOY = new Date().toISOString().slice(0, 10);
const DIR = join('pruebas-manuales', 'ensayo', HOY);

const renglones: string[] = [];
const decir = (s = '') => {
  renglones.push(s);
  console.log(s);
};

/** Las columnas que `armar()` necesita para reconocer el comercio y el plazo. */
const COLUMNAS = 'id, tenant_id, viaje_id, concepto, monto, fecha, folio, rfc_emisor, cfdi_uuid, ocr_confianza, ocr_extra, created_at';

test('ensayo de facturación sobre un ticket real', async () => {
  mkdirSync(DIR, { recursive: true });

  decir(`# Ensayo de facturación — ${new Date().toISOString()}`);
  decir();

  if (!TENANT_ID || !GASTO_ID) {
    decir('FALTA: hay que pasar `TENANT_ID` y `GASTO_ID`.');
    decir();
    decir('El `GASTO_ID` es el del ticket que ya entró por WhatsApp. Para encontrarlo:');
    decir('  select id, concepto, monto, fecha, rfc_emisor, ocr_confianza, cfdi_uuid');
    decir('  from gasto where tenant_id = \'…\' order by created_at desc limit 10;');
    escribirReporte();
    return;
  }

  // ── 1. EL TICKET. Antes que nada, porque es lo que puede matar la prueba ──
  //
  // `armar()` es la MISMA función con la que el cron reconoce el comercio. Si
  // aquí sale `null`, no hay portal a donde ir y ningún dato fiscal lo arregla.
  const { data: g, error } = await supabaseAdmin()
    .from('gasto').select(COLUMNAS)
    .eq('id', GASTO_ID).eq('tenant_id', TENANT_ID).maybeSingle();

  if (error) { decir(`ERROR al leer el gasto: ${error.message}`); escribirReporte(); return; }
  if (!g) { decir(`No existe el gasto ${GASTO_ID} en la flota ${TENANT_ID}.`); escribirReporte(); return; }

  const t = armar(g as Parameters<typeof armar>[0], HOY);
  const confianza = g.ocr_confianza === null ? null : Number(g.ocr_confianza);

  decir('## El ticket');
  decir(`- concepto: ${g.concepto} · monto: ${g.monto} · fecha: ${g.fecha ?? '—'}`);
  decir(`- RFC emisor: ${g.rfc_emisor ?? '—'} · folio: ${g.folio ?? '—'}`);
  decir(`- comercio reconocido: **${t.comercio?.clave ?? 'NINGUNO'}**`);
  decir(`- confianza OCR: ${confianza === null ? 'sin registrar' : confianza.toFixed(3)} (mínimo para autofacturar: ${CONFIANZA_MINIMA_AUTOFACTURA})`);
  decir(`- ya facturado: ${g.cfdi_uuid ? `sí (${g.cfdi_uuid})` : 'no'}`);
  decir();

  if (!t.comercio || !PORTALES_CONOCIDOS.includes(t.comercio.clave)) {
    decir(`ALTO: este ticket no va a ningún portal automatizado.`);
    decir(`Portales con adaptador escrito: ${PORTALES_CONOCIDOS.join(', ') || '(ninguno)'}.`);
    decir('Sin adaptador el cron lo manda a `sinPortal` y lo factura una persona. No es un fallo de configuración.');
    escribirReporte();
    return;
  }

  // ── 2. LOS DATOS FISCALES DE LA FLOTA ───────────────────────────────────
  const { flota, falta } = await getFiscalDeFlota(TENANT_ID);
  decir('## La flota');
  if (!flota) {
    decir('ALTO: la flota no puede facturar todavía. Falta:');
    for (const f of falta) decir(`  - ${f}`);
    decir();
    decir('Los cinco fiscales se capturan en `/dashboard/suscripcion`; el correo sale de una cuenta `contador` o `flota_admin`.');
    escribirReporte();
    return;
  }
  // El RFC se enseña; los demás datos también, porque el punto del ensayo es
  // poder MIRAR con qué se habría llenado el portal.
  decir(`- RFC: ${flota.rfc} · ${flota.nombre}`);
  decir(`- régimen: ${flota.regimenFiscal} · CP: ${flota.codigoPostal} · uso: ${flota.usoCfdi}`);
  decir(`- el CFDI se manda a: ${flota.correo}`);
  decir();

  // ── 3. EL MODO QUE DE VERDAD VA A CORRER ────────────────────────────────
  const modo = modoEfectivo(MODO_PEDIDO);
  decir('## El modo');
  decir(`- pedido: **${MODO_PEDIDO}** · efectivo: **${modo}**`);
  if (MODO_PEDIDO === 'emitir' && modo === 'ensayo') {
    decir(`- se degradó: falta \`FACTURACION_MANDATO_ACEPTADO=si\` (mandato aceptado: ${mandatoFiscalAceptado()}).`);
    decir('  Ver `src/lib/likida/facturacion/modo.ts`: sin la cláusula de mandato no se aprieta el botón.');
  }
  if (modo === 'emitir') {
    decir('- **ESTO VA A EMITIR UN CFDI REAL ANTE EL SAT. Es irreversible.**');
  }
  decir();

  // ── 4. EL CAMINO REAL ───────────────────────────────────────────────────
  decir('## El intento');
  const r = await conNavegador(
    (abrirPagina) => conPortales(
      { flota, abrirPagina },
      async (registro) => {
        decir(`- portales registrados: ${registro.registrados.join(', ') || '(ninguno)'}`);
        for (const p of registro.problemas) decir(`- problema: ${p}`);
        return facturarAlVuelo({ gastoId: GASTO_ID, tenantId: TENANT_ID, modo, hoy: HOY });
      },
    ),
    { pagina: { directorioCapturas: DIR } },
  );

  decir(`- intentado: ${r.intentado} · facturado: ${r.facturado}`);
  if (r.motivo) decir(`- motivo: ${r.motivo}`);
  if (r.detalle) decir(`- detalle: ${r.detalle}`);
  if (r.bloqueado) decir(`- BLOQUEADO (sale de la cola automática): ${r.bloqueado}`);
  if (r.cfdiUuid) decir(`- UUID: ${r.cfdiUuid}`);
  decir();

  // LO QUE SE HABRÍA ESCRITO. Es lo único que hace que el ensayo sirva: un
  // "ok" sin esto solo dice que ningún selector reventó, no que el RFC haya
  // caído en el campo del RFC.
  decir('## Qué se escribió en el portal');
  const campos = r.capturado ?? {};
  if (!Object.keys(campos).length) decir('- (nada: no se llegó a llenar el formulario)');
  for (const [k, v] of Object.entries(campos)) decir(`- ${k}: ${v}`);
  decir();

  if (r.captura) {
    // `directorioCapturas` hace que `captura()` devuelva una RUTA. Si aun así
    // vino un data-uri, se dice en vez de fingir que hay archivo que mirar.
    if (r.captura.startsWith('data:')) {
      decir('## La pantalla');
      decir('- vino como data-uri, no como archivo. (¿`directorioCapturas` no llegó al adaptador?)');
    } else {
      const destino = join(DIR, basename(r.captura));
      if (existsSync(r.captura) && r.captura !== destino) copyFileSync(r.captura, destino);
      decir('## La pantalla');
      decir(`- ${destino}`);
    }
    decir();
  }

  escribirReporte();
}, 600_000);

function escribirReporte(): void {
  const ruta = join(DIR, 'FACTURA-PUNTA-A-PUNTA.md');
  writeFileSync(ruta, renglones.join('\n') + '\n', 'utf8');
  console.log(`\n→ reporte: ${ruta}`);
}
