// ═══════════════════════════════════════════════════════════════════════════
// /mcp/autorizar — la pantalla de consentimiento OAuth del servidor MCP.
//
// Aquí es donde la identidad del panel se convierte en un acceso para Claude
// o ChatGPT. El flujo es el del RFC 6749 §4.1 con las reglas de OAuth 2.1:
//
//   · SIN sesión del panel no hay pantalla: se rebota a /login y se vuelve.
//   · Un client_id desconocido o una redirect_uri NO registrada se contestan
//     con una PÁGINA de error, jamás con un redirect (§4.1.2.1: redirigir a
//     una URI no verificada es regalar el open redirect).
//   · Todo lo demás que falte (challenge, response_type…) SÍ se redirige con
//     su código de error, porque la redirect_uri ya está verificada.
//   · El botón «Autorizar» es un server action que RE-VALIDA todo contra la
//     base — los hidden inputs son mensajería, no autoridad— y emite el
//     código atado a (tenant, usuario, rol) de LA SESIÓN, no de ningún input.
//
// SUPERADMIN NO CONSIENTE AQUÍ a propósito: su tenant es ambiguo por diseño
// (elige flota por cookie), y un token MCP que cruzara flotas violaría la
// regla número uno del servidor. Para el panel de Javier están las llaves de
// API por flota.
// ═══════════════════════════════════════════════════════════════════════════

import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getSessionTenant, SIN_ROL } from '@/lib/auth/session';
import { areasDe } from '@/lib/auth/visibilidad';
import { leerCliente, emitirCodigo, redirectUriRegistrada, recursoCanonico, SCOPE_LECTURA } from '@/lib/mcp/oauth';
import { perfilDeDestino, requiereConfirmacionReforzada, evaluarConsentimiento } from '@/lib/mcp/consentimiento';
import { appUrl } from '@/lib/env';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { MarcoPublico } from '../../ui-v2/componentes/marco-publico';
import { Boton } from '../../ui-v2/componentes/boton';
import { perfilRestringido } from '@/lib/auth/perfil_tenant';
import { getT } from '@/lib/i18n/servidor';
import { rico } from '@/lib/i18n/rico';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  return { title: (await getT('publico')).t('mcp.meta.titulo') };
}

interface ParamsAutorizar {
  client_id: string;
  redirect_uri: string;
  state: string | null;
  code_challenge: string;
  resource: string | null;
}

function uno(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/** Arma la URL de vuelta al cliente preservando su query original. */
function volverA(redirectUri: string, extras: Record<string, string | null>): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(extras)) {
    if (v !== null) u.searchParams.set(k, v);
  }
  return u.toString();
}

function Marco({ titulo, rotulo, children }: { titulo: string; rotulo: string; children: ReactNode }) {
  return (
    <MarcoPublico rotulo={rotulo} titulo={titulo} ancho="lectura">
      <div className="rv-pub__prosa">{children}</div>
    </MarcoPublico>
  );
}

function PaginaError({ titulo, detalle, rotulo }: { titulo: string; detalle: string; rotulo: string }) {
  return (
    <Marco titulo={titulo} rotulo={rotulo}>
      <p>{detalle}</p>
    </Marco>
  );
}

export default async function Autorizar({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { t } = await getT('publico');
  const rotulo = t('mcp.rotulo');
  const clientId = uno(sp.client_id);
  const redirectUri = uno(sp.redirect_uri);
  const state = uno(sp.state);
  const responseType = uno(sp.response_type);
  const codeChallenge = uno(sp.code_challenge);
  const challengeMethod = uno(sp.code_challenge_method);
  const resource = uno(sp.resource);

  // ── 1. El cliente y su redirect, ANTES que nada (sin redirect de error) ──
  if (!clientId || !redirectUri) {
    return <PaginaError rotulo={rotulo} titulo={t('mcp.falta.titulo')} detalle={t('mcp.falta.detalle')} />;
  }
  const rc = await leerCliente(clientId);
  if (!rc.ok) {
    return rc.error === 'no_disponible'
      ? <PaginaError rotulo={rotulo} titulo={t('mcp.verificar.titulo')} detalle={t('mcp.verificar.detalle')} />
      : <PaginaError rotulo={rotulo} titulo={t('mcp.desconocido.titulo')} detalle={t('mcp.desconocido.detalle')} />;
  }
  if (!redirectUriRegistrada(redirectUri, rc.cliente.redirectUris)) {
    return <PaginaError rotulo={rotulo} titulo={t('mcp.retorno.titulo')} detalle={t('mcp.retorno.detalle')} />;
  }

  // 0440: un cliente que Likida no ha aprobado NO llega a la pantalla de
  // consentimiento. Se muestra a dónde apuntaba, para que quien recibió el enlace
  // vea que no era Claude ni ChatGPT.
  const destino = perfilDeDestino(redirectUri);
  if (rc.cliente.estado !== 'aprobado' || !destino) {
    return (
      <PaginaError
        rotulo={rotulo}
        titulo={rc.cliente.estado === 'rechazado' ? t('mcp.rechazado.titulo') : t('mcp.pendiente.titulo')}
        detalle={t('mcp.noaprobado.detalle', {
          destino: destino ? t('mcp.noaprobado.destino', { host: destino.host }) : t('mcp.noaprobado.destino_invalido'),
        })}
      />

    );
  }

  // ── 2. La forma de la petición (la redirect ya está verificada) ──────────
  if (responseType !== 'code') {
    redirect(volverA(redirectUri, { error: 'unsupported_response_type', state }));
  }
  if (!codeChallenge || challengeMethod !== 'S256' || codeChallenge.length < 43 || codeChallenge.length > 128) {
    redirect(volverA(redirectUri, { error: 'invalid_request', error_description: 'PKCE S256 es obligatorio.', state }));
  }
  if (resource !== null && resource !== recursoCanonico()) {
    redirect(volverA(redirectUri, { error: 'invalid_target', state }));
  }

  // ── 3. La identidad: la sesión del panel, y nada más ─────────────────────
  const s = await getSessionTenant();
  if (!s) {
    const propia = new URL(`${'/mcp/autorizar'}`, 'https://x.invalid');
    for (const [k, v] of Object.entries(sp)) {
      const val = uno(v);
      if (val !== null) propia.searchParams.set(k, val);
    }
    redirect(`/login?next=${encodeURIComponent(`/mcp/autorizar${propia.search}`)}`);
  }
  if (s.rol === 'superadmin') {
    return <PaginaError rotulo={rotulo} titulo={t('mcp.superadmin.titulo')} detalle={t('mcp.superadmin.detalle')} />;
  }
  if (!s.tenantId || s.rol === SIN_ROL || areasDe(s.rol).length === 0) {
    return <PaginaError rotulo={rotulo} titulo={t('mcp.sinflota.titulo')} detalle={t('mcp.sinflota.detalle')} />;
  }

  // El perfil de la flota (0770) no ofrece MCP: no se autoriza un acceso que el endpoint negaría.
  if (await perfilRestringido(s.tenantId)) {
    return <PaginaError rotulo={rotulo} titulo={t('mcp.sinplan.titulo')} detalle={t('mcp.sinplan.detalle')} />;
  }

  const areas = areasDe(s.rol);
  const reforzada = requiereConfirmacionReforzada(areas);
  const nombreCliente = rc.cliente.nombre ?? t('mcp.cliente_por_omision');
  const params: ParamsAutorizar = { client_id: clientId, redirect_uri: redirectUri, state, code_challenge: codeChallenge, resource };

  // ── El server action: re-valida TODO y emite el código ───────────────────
  async function autorizar(formData: FormData) {
    'use server';
    const decision = String(formData.get('decision') ?? '');
    const p: ParamsAutorizar = {
      client_id: String(formData.get('client_id') ?? ''),
      redirect_uri: String(formData.get('redirect_uri') ?? ''),
      state: (formData.get('state') as string | null) || null,
      code_challenge: String(formData.get('code_challenge') ?? ''),
      resource: (formData.get('resource') as string | null) || null,
    };
    const confirmacion = String(formData.get('confirmacion') ?? '');

    // La identidad SIEMPRE se relee de la sesión en el momento de firmar.
    const sesion = await getSessionTenant();
    if (!sesion || !sesion.tenantId || sesion.rol === SIN_ROL || sesion.rol === 'superadmin' || areasDe(sesion.rol).length === 0) {
      redirect('/login');
    }

    // Mismo veredicto que arriba, releído al firmar: un POST a mano no se lo salta.
    if (await perfilRestringido(sesion.tenantId)) redirect('/mcp/autorizar');

    const cliente = await leerCliente(p.client_id);
    if (!cliente.ok || !redirectUriRegistrada(p.redirect_uri, cliente.cliente.redirectUris)) {
      redirect('/mcp/autorizar');
    }
    if (decision !== 'autorizar') {
      redirect(volverA(p.redirect_uri, { error: 'access_denied', state: p.state }));
    }
    // 0440: se RE-evalúa aquí (cliente aprobado + confirmación reforzada si hay
    // dinero en el alcance). Quien salta el formulario con un POST a mano no se
    // salta esto.
    const veredicto = evaluarConsentimiento({
      estadoCliente: cliente.cliente.estado,
      areas: areasDe(sesion.rol),
      redirectUri: p.redirect_uri,
      confirmacion,
    });
    if (!veredicto.ok) {
      // Sin redirect de vuelta al cliente: no se le regala nada a quien lo intenta.
      const propia = new URLSearchParams({
        client_id: p.client_id, redirect_uri: p.redirect_uri, response_type: 'code',
        code_challenge: p.code_challenge, code_challenge_method: 'S256', error: veredicto.motivo,
      });
      if (p.state !== null) propia.set('state', p.state);
      if (p.resource !== null) propia.set('resource', p.resource);
      redirect(`/mcp/autorizar?${propia.toString()}`);
    }
    if (p.code_challenge.length < 43 || p.code_challenge.length > 128) {
      redirect(volverA(p.redirect_uri, { error: 'invalid_request', state: p.state }));
    }
    if (p.resource !== null && p.resource !== recursoCanonico()) {
      redirect(volverA(p.redirect_uri, { error: 'invalid_target', state: p.state }));
    }

    const codigo = await emitirCodigo({
      clientId: p.client_id,
      userId: sesion.userId,
      // La sesión del panel no trae el correo y el token no lo necesita para
      // autorizar: la bitácora firma con `actor_id`, que sí viaja.
      userEmail: null,
      tenantId: sesion.tenantId,
      rol: sesion.rol,
      redirectUri: p.redirect_uri,
      codeChallenge: p.code_challenge,
      resource: p.resource,
    });
    if (!codigo.ok) {
      redirect(volverA(p.redirect_uri, { error: 'server_error', state: p.state }));
    }

    // El consentimiento es un acto: queda en la bitácora con quién y cuándo.
    await anotarBitacora(
      {
        tenantId: sesion.tenantId,
        actor: { id: sesion.userId },
        accion: 'mcp.consentimiento',
        entidad: 'tenant',
        entidadId: sesion.tenantId,
        detalle: { cliente: cliente.cliente.nombre ?? p.client_id, rol: sesion.rol, destino: perfilDeDestino(p.redirect_uri)?.host ?? null, confirmacion_reforzada: requiereConfirmacionReforzada(areasDe(sesion.rol)) },
      },
      { evento: 'mcp.bitacora' },
    );

    // `iss` (RFC 9207): el cliente MCP 2026-07-28 valida que quien contesta
    // sea el issuer que descubrió — cierra el mix-up de servidores.
    redirect(volverA(p.redirect_uri, { code: codigo.codigo, state: p.state, iss: appUrl() }));
  }

  return (
    <Marco rotulo={rotulo} titulo={t('mcp.consent.titulo', { cliente: nombreCliente })}>
      <p>
        {rico(t('mcp.consent.conectado', { nombre: s.nombre ?? t('mcp.consent.usuario_por_omision'), rol: s.rol.replace('_', ' ') }), { strong: (c) => <strong>{c}</strong> })}
      </p>
      <ul className="rv-pub__vinetas">
        {areas.map((a) => (
          <li key={a}>{['operacion', 'dinero', 'administracion'].includes(a) ? t(`mcp.area.${a as 'operacion' | 'dinero' | 'administracion'}`) : a}</li>
        ))}
      </ul>
      {uno(sp.error) === 'falta_confirmacion' ? (
        <p role="alert"><strong>
          {t('mcp.consent.dominio_no_coincide')}
        </strong></p>
      ) : null}
      <div className="rv-pub__tarjeta" role="note">
        <p>
          {rico(t('mcp.consent.entrega', { host: destino.host, propia: destino.loopback ? t('mcp.consent.propia_maquina') : '' }), { strong: (c) => <strong>{c}</strong> })}
        </p>
        <p className="rv-pub__nota">
          {destino.conocido ? t('mcp.consent.conocido') : t('mcp.consent.no_verificado')}
        </p>
      </div>
      <p className="rv-pub__nota">
        {t('mcp.consent.nota', { cliente: nombreCliente, alcance: SCOPE_LECTURA })}
      </p>
      <form action={autorizar} className="rv-pub__acciones">
        <input type="hidden" name="client_id" value={params.client_id} />
        <input type="hidden" name="redirect_uri" value={params.redirect_uri} />
        {params.state !== null ? <input type="hidden" name="state" value={params.state} /> : null}
        <input type="hidden" name="code_challenge" value={params.code_challenge} />
        {params.resource !== null ? <input type="hidden" name="resource" value={params.resource} /> : null}
        {reforzada ? (
          <label className="rv-pub__etiqueta">
            <span>
              {rico(t('mcp.consent.reforzada', { dominio: destino.hostname }), { strong: (c) => <strong>{c}</strong> })}
            </span>
            <input
              name="confirmacion" type="text" autoComplete="off" spellCheck={false}
              className="rv-pub__campo"
            />
          </label>
        ) : null}
        <Boton type="submit" name="decision" value="autorizar" variante="primary">
          {t('mcp.consent.autorizar')}
        </Boton>
        <Boton type="submit" name="decision" value="denegar">
          {t('mcp.consent.denegar')}
        </Boton>
      </form>
    </Marco>
  );
}
