import { headers } from 'next/headers';
import { mxn, fechaMx } from '@/lib/formato';
import { rateLimit } from '@/lib/ratelimit';
import { TEXTO_LIGA_NO_VALIDA, METODOS_PORTAL, identificaFactura, textoDelRep } from '@/lib/likida/portal_pago';
import {
  resolverLiga, vistaDelPortal, anotarAcceso, sellarUltimoAcceso,
  type VistaPortal,
} from '@/lib/likida/portal_pago_lectura';
import { sellarRepEntregado } from '@/lib/likida/portal_pago_escritura';
import { FormaDePago } from './forma';

// ═══════════════════════════════════════════════════════════════════════════
// /pago/<token> — LO QUE VE EL CLIENTE DE LA FLOTA. Sin sesión, sin cuenta.
//
// El alcance de esta página es UNA factura y no hay nada que teclear para
// cambiarlo: no recibe un `factura_id`, recibe un token, y todo lo que pinta
// sale de `vistaDelPortal(liga)`, que ancla cada consulta al `factura_id` y al
// `tenant_id` que el token resolvió. No existe la forma de pedir otra.
//
// ── LOS TRES DESENLACES, Y POR QUÉ SE VEN DISTINTOS ──────────────────────
//
//   · Token que no vale (no existe, caducó, revocado, basura) → UN SOLO
//     texto para los cuatro. Distinguirlos le diría a quien prueba tokens
//     cuál acertó a medias.
//   · No se pudo consultar → texto DISTINTO, porque lleva a una conducta
//     contraria: "vuelve en un rato" en vez de "pide otro enlace". Fallar
//     cerrado y decirlo, no fallar cerrado y fingir que el enlace murió.
//   · Todo bien → la factura, su saldo REAL, el formulario y el REP.
//
// ── EL SALDO PUEDE DECIR «SIN DATO», Y JAMÁS $0.00 ───────────────────────
//
// `factura_saldo` es una vista y su lectura puede fallar. Un `$0.00` ahí se
// lee como "ya no debes nada" — la conclusión OPUESTA a "no pude preguntar".
// Cuando el saldo es `null` la pantalla lo dice con esas palabras y el
// formulario se apaga: no se puede registrar un pago contra una cifra que
// nadie verificó.
//
// ── NOINDEX, Y `referrer: no-referrer` ────────────────────────────────────
//
// El token va en la URL (ver la cabecera de `portal_pago.ts` para por qué es
// aceptable aquí y no en `admin-context.ts`). Dos consecuencias se cierran:
// que un buscador lo indexe, y que el navegador se lo mande de cabecera
// `Referer` a cualquier host externo al que la página enlace.
// ═══════════════════════════════════════════════════════════════════════════

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Tu factura',
  robots: { index: false, follow: false },
  referrer: 'no-referrer' as const,
};

/** El sobre de todas las pantallas de esta ruta: mismo ancho, mismo tono, y
 *  colores del sistema — este documento se abre de noche, desde un teléfono en
 *  modo oscuro, igual que el aviso de privacidad. */
function Sobre({ children }: { children: React.ReactNode }) {
  return (
    <main
      className="mx-auto max-w-2xl px-5 py-10 text-[15px] leading-relaxed"
      style={{ color: 'var(--muted)' }}
    >
      {children}
    </main>
  );
}

function Aviso({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <Sobre>
      <h1 className="text-xl font-semibold" style={{ color: 'var(--ink)' }}>{titulo}</h1>
      <p className="mt-3 break-words">{texto}</p>
    </Sobre>
  );
}

export default async function PaginaPago({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Un techo por IP sobre el RENDER, no solo sobre el envío. Con 256 bits de
  // token la fuerza bruta es imposible por aritmética, así que esto no protege
  // el secreto: protege la base de una ráfaga de tokens inventados que, sin
  // este límite, serían una consulta cada una.
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0].trim() || 'desconocida';
  if (!(await rateLimit(`portal-pago-vista:${ip}`, 60, 10 * 60_000))) {
    return (
      <Aviso
        titulo="Demasiadas peticiones"
        texto="Espera unos minutos y vuelve a abrir tu enlace."
      />
    );
  }

  const resolucion = await resolverLiga(token);
  if (!resolucion.ok) {
    if (resolucion.motivo === 'no_disponible') {
      return (
        <Aviso
          titulo="No pudimos consultar tu factura"
          texto="Hubo una falla al consultar. No es tu enlace: vuelve a intentarlo en unos minutos, y si sigue igual avísale a quien te lo envió."
        />
      );
    }
    return <Aviso titulo="Enlace no disponible" texto={TEXTO_LIGA_NO_VALIDA} />;
  }
  const liga = resolucion.liga;

  const vista = await vistaDelPortal(liga);
  if (!vista.ok) {
    if (vista.motivo === 'no_disponible') {
      return (
        <Aviso
          titulo="No pudimos consultar tu factura"
          texto="Hubo una falla al consultar. No es tu enlace: vuelve a intentarlo en unos minutos, y si sigue igual avísale a quien te lo envió."
        />
      );
    }
    return <Aviso titulo="Enlace no disponible" texto={TEXTO_LIGA_NO_VALIDA} />;
  }

  const v = vista.vista;

  // Los sellos van DESPUÉS del hecho, y ninguno puede tumbar la página: los
  // tres tragan su propio error. El del REP solo escribe la PRIMERA vez.
  await anotarAcceso(liga, 'vista');
  await sellarUltimoAcceso(liga);
  if (v.rep) {
    await anotarAcceso(liga, 'rep_mostrado', { cfdiUuid: v.rep.cfdiUuid });
    await sellarRepEntregado(v.tenantId, v.facturaId);
  }

  return <Contenido v={v} token={token} />;
}

function Contenido({ v, token }: { v: VistaPortal; token: string }) {
  const f = v.factura;
  const saldado = f.saldo !== null && f.saldo <= 0.01;
  const pendientes = v.propuestas.filter((p) => p.estado === 'pendiente');

  return (
    <Sobre>
      <header className="pb-6" style={{ borderBottom: '1px solid var(--line)' }}>
        <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
          Factura de {v.flota}
        </p>
        <h1 className="mt-2 text-2xl font-semibold break-words" style={{ color: 'var(--ink)' }}>
          {identificaFactura(f)}
        </h1>
        <p className="mt-1 break-words">A nombre de {v.cliente}</p>
      </header>

      {/* ── EL SALDO ─────────────────────────────────────────────────────── */}
      <section className="py-6" style={{ borderBottom: '1px solid var(--line)' }}>
        <Renglon etiqueta="Total de la factura" valor={mxn(f.total)} />
        <Renglon
          etiqueta="Pagado"
          valor={f.pagado === null ? 'sin dato' : mxn(f.pagado)}
        />
        <Renglon
          etiqueta="Saldo pendiente"
          valor={f.saldo === null ? 'sin dato' : mxn(f.saldo)}
          fuerte
        />
        <Renglon etiqueta="Fecha de la factura" valor={fechaMx(f.fecha)} />
        <Renglon etiqueta="Vence" valor={f.venceEn ? fechaMx(f.venceEn) : 'sin plazo pactado'} />
        {f.cfdiUuid && <Renglon etiqueta="Folio fiscal (UUID)" valor={f.cfdiUuid} />}

        {f.saldo === null && (
          <p className="mt-4 text-[13px]" style={{ color: 'var(--warn, var(--muted))' }}>
            Ahora mismo no podemos calcular tu saldo. No quiere decir que esté en
            cero: quiere decir que no pudimos consultarlo. Vuelve en unos minutos.
          </p>
        )}
      </section>

      {/* ── LO QUE YA REGISTRASTE ────────────────────────────────────────── */}
      {v.propuestas.length > 0 && (
        <section className="py-6" style={{ borderBottom: '1px solid var(--line)' }}>
          <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
            Pagos que has registrado aquí
          </h2>
          <ul className="mt-3 space-y-2">
            {v.propuestas.map((p, i) => (
              <li key={i} className="text-[14px] break-words">
                <span style={{ color: 'var(--ink)' }}>{mxn(p.monto)}</span>
                {' · '}{fechaMx(p.fecha)}{' · ref. '}{p.referencia}
                {' — '}
                <span style={{ color: 'var(--muted)' }}>{rotuloEstado(p.estado)}</span>
              </li>
            ))}
          </ul>
          {pendientes.length > 0 && (
            <p className="mt-3 text-[13px]">
              «Por confirmar» significa que ya lo recibimos y que {v.flota} todavía
              tiene que cruzarlo contra su estado de cuenta. Hasta entonces el saldo
              de arriba no se mueve — es el saldo real, no una promesa.
            </p>
          )}
        </section>
      )}

      {/* ── EL FORMULARIO ────────────────────────────────────────────────── */}
      <section className="py-6" style={{ borderBottom: '1px solid var(--line)' }}>
        <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
          Registrar un pago
        </h2>
        {saldado ? (
          <p className="mt-2 text-[14px]">
            Esta factura ya no tiene saldo pendiente. Si hiciste otro depósito,
            escríbele directamente a {v.flota}.
          </p>
        ) : f.saldo === null ? (
          <p className="mt-2 text-[14px]">
            No podemos registrar un pago mientras no podamos mostrarte el saldo.
            Vuelve a abrir esta página en unos minutos.
          </p>
        ) : (
          <>
            <p className="mt-2 text-[14px]">
              Aquí NO se cobra nada: no hay tarjeta y no se hace ningún cargo. Es
              para que nos digas el pago que ya hiciste por tu banco, con su
              referencia, y {v.flota} lo pueda encontrar y confirmar.
            </p>
            <FormaDePago token={token} saldo={f.saldo} metodos={METODOS_PORTAL} />
          </>
        )}
      </section>

      {/* ── EL COMPLEMENTO DE PAGO ───────────────────────────────────────── */}
      <section className="py-6">
        <h2 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
          Tu complemento de pago (REP)
        </h2>
        <p className="mt-2 text-[14px] break-words">{textoDelRep(
          v.rep ? { cfdi_uuid: v.rep.cfdiUuid, xml: v.rep.tieneXml ? 'sí' : null } : null,
        )}</p>
        {v.rep && (
          <div className="mt-3 text-[14px]">
            <Renglon etiqueta="Folio fiscal del REP" valor={v.rep.cfdiUuid} />
            <Renglon etiqueta="Fecha del pago" valor={fechaMx(v.rep.fechaPago)} />
            <Renglon etiqueta="Importe pagado" valor={mxn(v.rep.impPagado)} />
            {v.rep.tieneXml && (
              <a
                className="mt-3 inline-block underline"
                style={{ color: 'var(--ink)' }}
                href={`/pago/${encodeURIComponent(token)}/complemento`}
              >
                Descargar el XML
              </a>
            )}
          </div>
        )}
      </section>

      <footer className="pt-6 text-[12px]" style={{ borderTop: '1px solid var(--line)', color: 'var(--muted)' }}>
        <p>
          Esta página la genera Likida por cuenta de {v.flota}. No pide contraseñas
          ni datos de tarjeta: si algo te los pide, no es esto.
        </p>
      </footer>
    </Sobre>
  );
}

function rotuloEstado(e: 'pendiente' | 'conciliada' | 'descartada'): string {
  if (e === 'conciliada') return 'confirmado y aplicado a la factura';
  if (e === 'descartada') return 'no se pudo confirmar — pregúntale a quien te emitió la factura';
  return 'por confirmar';
}

function Renglon({ etiqueta, valor, fuerte }: { etiqueta: string; valor: string; fuerte?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 py-1">
      <span className="text-[14px]">{etiqueta}</span>
      <span
        className={fuerte ? 'text-lg font-semibold' : 'text-[14px]'}
        style={{ color: 'var(--ink)', wordBreak: 'break-word' }}
      >
        {valor}
      </span>
    </div>
  );
}
