# Dominio de envío dedicado para los desgloses de liquidación

Los correos de desglose (flujo transaccional: un archivo adjunto para quien opera la flota) pueden salir de un dominio
propio, para que su reputación no dependa de los correos de acceso, los avisos ni las campañas en frío, que comparten
`RESEND_EMAIL_DOMAIN`.

## Comportamiento

- Variable opcional: `RESEND_EMAIL_DOMAIN_LIQUIDACIONES` (por ejemplo `pagos.ejemplo.com`).
- Definida: los desgloses (y solo ellos, vía `dominioEnvio: 'liquidaciones'` en `entrega_correo.ts`) salen de
  `<nombre> <desgloses@pagos.ejemplo.com>`. Un `remitenteLocal` explícito manda sobre `desgloses`.
- No definida o vacía: nada cambia; sale de `RESEND_EMAIL_DOMAIN` con la parte local `avisos`, como siempre.
- El resto de los flujos (acceso, avisos, campañas) ignora la variable.
- El desglose es operativo: usa la plantilla corporativa, sin `List-Unsubscribe` ni pie de campaña, y conserva `Reply-To`.

## Registros DNS (en el dominio o subdominio elegido)

Se recomienda un subdominio exclusivo (`pagos.<dominio-raíz>`), distinto del que usan las campañas. Resend entrega los
valores exactos al añadir el dominio; en general:

| Tipo | Nombre | Propósito |
|------|--------|-----------|
| TXT | `resend._domainkey.<subdominio>` | DKIM: clave pública con la que se firma cada correo |
| MX | `send.<subdominio>` | Retorno de rebotes (Return-Path) |
| TXT | `send.<subdominio>` | SPF: `v=spf1 include:amazonses.com ~all` (o el valor que indique Resend) |
| TXT | `_dmarc.<subdominio>` | DMARC: empezar con `v=DMARC1; p=none; rua=mailto:<buzón-de-reportes>` y endurecer a `quarantine` cuando los reportes salgan limpios |

## Activación

1. En Resend, añadir el dominio de desgloses y copiar los registros al DNS.
2. Esperar a que Resend marque el dominio como verificado (SPF y DKIM en verde).
3. En Vercel (proyecto de la app), definir `RESEND_EMAIL_DOMAIN_LIQUIDACIONES` con ese dominio.
4. Redeploy (las variables se leen al arrancar). Provoca un build: agrupar con otros cambios pendientes.
5. Mandar un desglose de prueba a un buzón propio y comprobar el remitente y la autenticación (SPF/DKIM/DMARC en "pass").

Para volver atrás basta quitar la variable y redesplegar. Con el dominio sin verificar Resend rechaza el envío
(`rechazado`) y la entrega se reintenta o falla según su política habitual: verificar antes de definir la variable.
