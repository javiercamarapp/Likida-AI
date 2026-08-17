# SSO / SCIM — el runbook (fase 7, decidido 17-ago-2026)

## La decisión

**No se construye hasta que un cliente lo pida por escrito.** Es la única
pieza de la lista enterprise que la auditoría 5 marca explícitamente como
"NO lo construiría hasta tener un cliente que te lo pida" (§19), y la razón
es de costo real: SAML/SCIM en Supabase exige plan Pro + add-on de SSO, y
el mantenimiento (metadata de IdP por cliente, rotación de certificados,
mapeo de atributos) solo se paga con un contrato enfrente.

## Lo que YA existe y cubre el 90% de la conversación enterprise

- **Magic link** (sin contraseñas que rotar) + **HIBP opcional** (plan Pro).
- **MFA TOTP con step-up** (0131 + lib/auth/mfa.ts): el segundo factor
  existe HOY, server-side, con política incremental.
- **Roles por matriz** (superadmin/flota_admin/contador/encargado/operador)
  con visibilidad y permisos gateados en servidor.
- **API keys por flota** con scopes (tenant_api_key, /dashboard/llaves-api).
- **Auditoría**: audit_evento + evento_seguridad (0133).

## El día que un cliente lo pida — los pasos exactos

1. Subir el proyecto Supabase a Pro y contratar el add-on de SSO (SAML 2.0).
2. `supabase sso add --type saml --metadata-url <IdP>` (o dashboard →
   Authentication → SSO) — un IdP por dominio de correo del cliente.
3. Mapear atributos: email (NameID), nombre → app_user.nombre. El ALTA del
   app_user sigue siendo NUESTRA (rol + tenant_id los pone el dueño de la
   flota en /dashboard/usuarios): SSO autentica, jamás autoriza.
4. SCIM (aprovisionamiento automático) NO está en Supabase hoy: si el
   contrato lo exige, el camino es un endpoint SCIM 2.0 propio delante de
   app_user (crear/desactivar), con la misma matriz de roles. Estimación:
   1-2 semanas. No empezar sin el contrato firmado.
5. Vender mientras tanto: "SSO disponible bajo contrato enterprise" — es
   verdad (los pasos de arriba tardan días, no meses) y no compromete
   mantenimiento sin ingreso.

## Qué NO decir en un pitch

- "Tenemos SSO" (no está encendido).
- "SCIM completo" (no existe; existe el plan de arriba).
