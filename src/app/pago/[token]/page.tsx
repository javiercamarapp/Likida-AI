import { ipDeCabeceras } from '@/lib/http/ip_cliente';
import { headers } from 'next/headers';
import { mxn, fechaMx } from '@/lib/formato';
import { rateLimit } from '@/lib/ratelimit';
import { METODOS_PORTAL, identificaFactura, textoDelRep } from '@/lib/likida/portal_pago';
import {
  resolverLiga, vistaDelPortal, anotarAcceso, sellarUltimoAcceso,
  type VistaPortal,
} from '@/lib/likida/portal_pago_lectura';
import { FormaDePago } from './forma';
import { MarcoPublico } from '../../ui-v2/componentes/marco-publico';
import { getT } from '@/lib/i18n/servidor';
import type { TrPublico } from '@/lib/i18n/publico_tr';
import '../../legal/publico-r2.css';

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

export async function generateMetadata() {
  const { t } = await getT('publico');
  return {
    title: t('pg.meta.titulo'),
    robots: { index: false, follow: false },
    referrer: 'no-referrer' as const,
  };
}

/** El sobre de todas las pantallas de esta ruta: mismo ancho, mismo tono, y
 *  colores del sistema — este documento se abre de noche, desde un teléfono en
 *  modo oscuro, igual que el aviso de privacidad. */
function Aviso({ titulo, texto, rotulo }: { titulo: string; texto: string; rotulo: string }) {
  return (
    <MarcoPublico rotulo={rotulo} titulo={titulo} apoyo={texto} ancho="estrecho" centrado>
      <div className="rv-flujo" aria-hidden="true" />
    </MarcoPublico>
  );
}

export default async function PaginaPago({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const tr = await getT('publico');
  const { t } = tr;

  // Un techo por IP sobre el RENDER, no solo sobre el envío. Con 256 bits de
  // token la fuerza bruta es imposible por aritmética, así que esto no protege
  // el secreto: protege la base de una ráfaga de tokens inventados que, sin
  // este límite, serían una consulta cada una.
  const ip = ipDeCabeceras(await headers());
  if (!(await rateLimit(`portal-pago-vista:${ip}`, 60, 10 * 60_000))) {
    return (
      <Aviso
        rotulo={t('pg.rotulo')}
        titulo={t('pg.limite.titulo')}
        texto={t('pg.limite.texto')}
      />
    );
  }

  const resolucion = await resolverLiga(token);
  if (!resolucion.ok) {
    if (resolucion.motivo === 'no_disponible') {
      return (
        <Aviso
          rotulo={t('pg.rotulo')}
          titulo={t('pg.falla.titulo')}
          texto={t('pg.falla.texto')}
        />
      );
    }
    return <Aviso rotulo={t('pg.rotulo')} titulo={t('pg.enlace.titulo')} texto={t('pg.enlace.texto')} />;
  }
  const liga = resolucion.liga;

  const vista = await vistaDelPortal(liga);
  if (!vista.ok) {
    if (vista.motivo === 'no_disponible') {
      return (
        <Aviso
          rotulo={t('pg.rotulo')}
          titulo={t('pg.falla.titulo')}
          texto={t('pg.falla.texto')}
        />
      );
    }
    if (vista.motivo === 'no_cobrable') {
      // NO se colapsa en el texto único de los tokens muertos, y no es un
      // descuido: quien llega aquí trae un token BUENO —no está probando
      // enlaces, es el cliente— y lo que necesita saber es que ese papel ya no
      // se paga, no que "pida otro enlace". Tampoco se pinta el saldo: sobre un
      // CFDI cancelado no hay cifra que cobrar, y enseñarla invitaría a pagarla
      // por fuera. Se dice lo que pasó y a quién preguntarle.
      await anotarAcceso(liga, 'vista', { motivo: 'no_cobrable', estatus: vista.estatus });
      return (
        <Aviso
          rotulo={t('pg.rotulo')}
          titulo={t('pg.nocobrable.titulo')}
          texto={
            vista.estatus === 'cancelada'
              ? t('pg.nocobrable.cancelada')
              : t('pg.nocobrable.sinemitir')
          }
        />
      );
    }
    return <Aviso rotulo={t('pg.rotulo')} titulo={t('pg.enlace.titulo')} texto={t('pg.enlace.texto')} />;
  }

  const v = vista.vista;

  // A37-S21-03: un GET NO es una entrega. Lo hace también un servidor de vista
  // previa (WhatsApp, correo) o un antivirus, y sellar `entregado_en` aquí le
  // mostraba al contralor «Tu cliente lo abrió» sobre un REP que nadie vio ni
  // descargó (y aun sin XML). La constancia de entrega se sella SOLO en la ruta
  // de descarga del XML (complemento/[uuid]/route.ts), que ya exige que exista.
  // La vista se anota una vez por ventana, no una fila por GET.
  await anotarAcceso(liga, 'vista', undefined, { unaVezCadaMs: 10 * 60_000 });
  await sellarUltimoAcceso(liga);

  return <Contenido v={v} token={token} tr={tr} />;
}

function Contenido({ v, token, tr }: { v: VistaPortal; token: string; tr: TrPublico }) {
  const { t, idioma } = tr;
  const fecha = (iso: string) => fechaMx(iso, idioma);
  const f = v.factura;
  const saldado = f.saldo !== null && f.saldo <= 0.01;
  const pendientes = v.propuestas.filter((p) => p.estado === 'pendiente');

  return (
    <MarcoPublico
      rotulo={t('pg.factura.rotulo', { flota: v.flota })}
      titulo={identificaFactura(f, t('pg.sin_folio'))}
      apoyo={t('pg.factura.apoyo', { cliente: v.cliente })}
      pie={<p>{t('pg.factura.pie', { flota: v.flota })}</p>}
    >
      {/* ── EL SALDO ─────────────────────────────────────────────────────── */}
      <section className="border-b border-[var(--line)] py-6">
        <Renglon etiqueta={t('pg.r.total')} valor={mxn(f.total, idioma)} />
        <Renglon
          etiqueta={t('pg.r.pagado')}
          valor={f.pagado === null ? t('pg.sin_dato') : mxn(f.pagado, idioma)}
        />
        <Renglon
          etiqueta={t('pg.r.saldo')}
          valor={f.saldo === null ? t('pg.sin_dato') : mxn(f.saldo, idioma)}
          fuerte
        />
        <Renglon etiqueta={t('pg.r.fecha')} valor={fecha(f.fecha)} />
        <Renglon etiqueta={t('pg.r.vence')} valor={f.venceEn ? fecha(f.venceEn) : t('pg.sin_plazo')} />
        {f.cfdiUuid && <Renglon etiqueta={t('pg.r.uuid')} valor={f.cfdiUuid} />}

        {f.saldo === null && (
          <p className="mt-4 text-[13px]">
            {t('pg.saldo.no_calculable')}
          </p>
        )}
      </section>

      {/* ── LO QUE YA REGISTRASTE ────────────────────────────────────────── */}
      {v.propuestas.length > 0 && (
        <section className="border-b border-[var(--line)] py-6">
          <h2 className="text-base font-semibold">
            {t('pg.reg.titulo')}
          </h2>
          <ul className="mt-3 space-y-2">
            {v.propuestas.map((p, i) => (
              <li key={i} className="text-[14px] break-words">
                <span>{t('pg.reg.linea', { monto: mxn(p.monto, idioma), fecha: fecha(p.fecha), referencia: p.referencia })}</span>
                {' — '}
                <span>{t(`pg.estado.${p.estado}`)}</span>
              </li>
            ))}
          </ul>
          {pendientes.length > 0 && (
            <p className="mt-3 text-[13px]">
              {t('pg.reg.pendiente_nota', { flota: v.flota })}
            </p>
          )}
        </section>
      )}

      {/* ── EL FORMULARIO ────────────────────────────────────────────────── */}
      <section className="border-b border-[var(--line)] py-6">
        <h2 className="text-base font-semibold">
          {t('pg.forma.titulo')}
        </h2>
        {saldado ? (
          <p className="mt-2 text-[14px]">
            {t('pg.forma.saldado', { flota: v.flota })}
          </p>
        ) : f.saldo === null ? (
          <p className="mt-2 text-[14px]">
            {t('pg.forma.sin_saldo')}
          </p>
        ) : (
          <>
            <p className="mt-2 text-[14px]">
              {t('pg.forma.aclaracion', { flota: v.flota })}
            </p>
            <FormaDePago token={token} saldo={f.saldo} metodos={METODOS_PORTAL.map((m) => ({ id: m.id, rotulo: t(`pg.metodo.${m.id}`) }))} />
          </>
        )}
      </section>

      {/* ── EL COMPLEMENTO DE PAGO ───────────────────────────────────────── */}
      <section className="py-6">
        <h2 className="text-base font-semibold">
          {t('pg.rep.titulo')}
        </h2>
        <p className="mt-2 text-[14px] break-words">{textoDelRep(
          v.reps.map((r) => ({ cfdi_uuid: r.cfdiUuid, tieneXml: r.tieneXml })), tr,
        )}</p>
        {/* TODOS los complementos, uno por bloque, cada uno con su descarga.
            Con parcialidades son varios y el contador del cliente necesita
            todos: cada uno acredita el IVA de su mes (`c7-16`). */}
        {v.reps.map((rep) => (
          <div key={rep.cfdiUuid} className="mt-4 text-[14px]">
            <Renglon etiqueta={t('pg.rep.folio')} valor={rep.cfdiUuid} />
            <Renglon etiqueta={t('pg.rep.fecha')} valor={fecha(rep.fechaPago)} />
            <Renglon etiqueta={t('pg.rep.importe')} valor={mxn(rep.impPagado, idioma)} />
            {rep.tieneXml ? (
              <a
                className="mt-2 inline-block underline"
               
                href={`/pago/${encodeURIComponent(token)}/complemento/${encodeURIComponent(rep.cfdiUuid)}`}
              >
                {t('pg.rep.descargar')}
              </a>
            ) : (
              <p className="mt-2 text-[13px]">
                {t('pg.rep.sin_archivo', { flota: v.flota })}
              </p>
            )}
          </div>
        ))}
      </section>

    </MarcoPublico>
  );
}

function Renglon({ etiqueta, valor, fuerte }: { etiqueta: string; valor: string; fuerte?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 py-1">
      <span className="text-[14px]">{etiqueta}</span>
      <span
        className={`break-words ${fuerte ? 'text-lg font-semibold' : 'text-[14px]'}`}
      >
        {valor}
      </span>
    </div>
  );
}
