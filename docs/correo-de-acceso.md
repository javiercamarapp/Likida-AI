# El correo de acceso

> **Estado al 18-ago-2026, medido contra el proyecto real:**
> - **Las 13 plantillas ya están puestas** en Supabase (`gngoqsvrxdguxvsizpbw`),
>   releídas y comparadas campo por campo ✓
> - **El remitente se arregló:** era `onboarding@resend.dev` —el sandbox de
>   Resend, que solo entrega al dueño de la cuenta—, o sea que **un contralor
>   de una flota real no habría recibido nunca su enlace**. Hoy es
>   `Likida <acceso@mail.likida.ai>`, dominio verificado ✓
> - `mailer_otp_exp` = 3600 s = los 60 min que el correo promete ✓
> - `SUPABASE_AUTH_HOOK_SECRET` en Vercel y `/api/auth/correo` vivo en
>   `da4f944`: sin firma **401**, con firma válida **200** y el correo llegó
>   (`last_event: delivered`) ✓
> - **Pendiente, opcional:** encender el hook (`--con-hook`). Cambia el logo
>   enlazado por incrustado y el envío de SMTP a la API de Resend.
> - **Sin verificar:** que el SMTP entregue con el remitente nuevo. Se
>   comprueba pidiendo un magic link en `/login`.

## Qué estaba mal

El correo que abre la sesión —el primero que ve un contralor de flota— lo
redactaba Supabase con su plantilla de fábrica:

```
Your sign-in link
Follow the link below to sign in. This link expires shortly and can only be used once.
Sign in
```

En inglés, sin logo, sin pie, con un enlace azul de navegador y un «expires
shortly» que no dice cuándo. Todo el resto del correo transaccional de Likida
(avisos de vigencias, corridas fallidas, invitaciones) ya salía por
`src/lib/correo/plantilla.ts`, con el wordmark incrustado y el pie obligatorio.
El correo más importante del producto era el único que no parecía Likida.

## Los dos caminos, y por qué están los dos

| | Plantillas en el panel | Send Email Hook |
|---|---|---|
| Quién manda | Supabase (su SMTP) | Likida, por Resend |
| Logo | enlazado (`https://app.likida.ai/images/logo.png`) | **incrustado** (`cid:`), no depende de que el cliente autorice imágenes |
| Remitente | `Likida <acceso@mail.likida.ai>` (era el sandbox de Resend) | `Likida <acceso@mail.likida.ai>` |
| Entregabilidad | la de Supabase, con su **cuota diaria** | la de nuestro dominio, medida en `/api/correo/eventos` |
| Se enciende | pegando HTML, sin desplegar | un endpoint + un secreto |

El hook es el destino. Las plantillas del panel son la red: si el hook se
apaga —o antes de encenderlo— el correo sigue siendo de la marca en vez de
volver al de fábrica.

## Incidente del 18-ago y lo que dejó escrito

Al encender el hook, pedir un magic link devolvió **HTTP 500**. El log de
nuestro lado dijo la causa en una línea:

```
auth.correo.accion_desconocida  {"accion":"magiclink"}
```

Supabase manda `email_action_type: "magiclink"`, no `login`. La firma estaba
bien, el transporte estaba bien: era el nombre. Arreglado en `4fea994`, con
las dos acciones aceptadas y una prueba que fija el valor MEDIDO.

Lo que enseñó, y vale más que el arreglo: **una acción desconocida ya no
tumba el login**. Contestar 400 "por fallar cerrado" no es fallar cerrado
cuando Supabase ya no manda por su cuenta — es dejar a todos afuera. Ahora,
con token en mano, se manda el correo de acceso genérico y el error se grita
en el log.

Y al mirar la configuración después, dos cosas más:

- **El límite de correo estaba en 2 por hora** para todo el proyecto. Dos
  personas de la misma flota entrando la misma mañana dejaban a la tercera
  fuera.
- **Encender el hook borró la configuración SMTP.** Con el hook prendido da
  igual, pero convierte el interruptor de pánico en una trampa: apagarlo
  devolvería el envío a Supabase, que sin SMTP propio cae a su servicio
  interno, limitado y solo para el equipo.

Las dos se corrigen con:

```bash
SUPABASE_ACCESS_TOKEN=sbp_xxx npx vite-node scripts/correo/aplicar-auth-supabase.ts --afinar
```

## Lo que falta: un comando

Un token personal de Supabase (`sbp_…`), que se genera en
<https://supabase.com/dashboard/account/tokens>, y:

```bash
# 1. Sube las seis plantillas (reversible, no toca el camino de entrada)
SUPABASE_ACCESS_TOKEN=sbp_xxx npx vite-node scripts/correo/aplicar-auth-supabase.ts

# 2. Y enciende el hook (correo por Resend, logo incrustado)
SUPABASE_ACCESS_TOKEN=sbp_xxx npx vite-node scripts/correo/aplicar-auth-supabase.ts --con-hook
```

El script tiene tres candados: no enciende el hook si el endpoint no contesta
401 (o sea, si el deployment no trae el secreto), relee la configuración y
compara lo que quedó contra lo que mandó, y coteja `mailer_otp_exp` contra los
minutos que el correo promete.

## A mano (si se prefiere el panel)

```bash
npx vite-node scripts/correo/plantillas-auth.ts
```

Deja seis archivos en `docs/correo-auth/`. En **Supabase → Authentication →
Emails**, pegar cada uno en su plantilla:

| Archivo | Plantilla del panel |
|---|---|
| `magic-link.html` | Magic Link |
| `confirmar-alta.html` | Confirm signup |
| `invitacion.html` | Invite user |
| `recuperar-acceso.html` | Reset password |
| `cambio-de-correo.html` | Change email address |
| `reautenticacion.html` | Reauthentication |
| `aviso-correo-cambiado.html` | Email changed (notification) |
| `aviso-contrasena.html` | Password changed (notification) |
| `aviso-telefono-cambiado.html` | Phone changed (notification) |
| `aviso-segundo-factor-agregado.html` | MFA factor enrolled |
| `aviso-segundo-factor-quitado.html` | MFA factor unenrolled |
| `aviso-identidad-ligada.html` | Identity linked |
| `aviso-identidad-quitada.html` | Identity unlinked |

Las siete últimas son las de NOTIFICACIÓN, y no aparecen donde uno las busca:
se encontraron leyendo la configuración por API. Las que sí pueden dispararse
hoy en Likida son el cambio de correo, el alta y baja de segundo factor
(`lib/auth/mfa.ts`) y el ligado de una identidad de Google.

Traen las variables de Supabase (`{{ .ConfirmationURL }}`, `{{ .Token }}`) ya
puestas. **No editar el HTML a mano**: se regenera y se pierde el cambio.

## El hook a mano (si se prefiere el panel)

1. **Supabase → Authentication → Hooks → Send Email Hook** → *Add hook* →
   tipo **HTTPS**.
2. URL: `https://app.likida.ai/api/auth/correo`.
3. Secreto: el MISMO que ya está en Vercel como `SUPABASE_AUTH_HOOK_SECRET`
   (está también en `.env.local`). Si se genera uno nuevo allá, hay que
   cambiarlo en Vercel **y redesplegar** — Vercel congela las variables en el
   build, así que sin deploy nuevo el endpoint sigue con el viejo y contesta
   401 a todo: nadie entra.
4. Con el hook activo, Supabase **deja de mandar por su cuenta**. Probar de
   inmediato: pedir un magic link en `/login` y confirmar que llega desde
   `acceso@mail.likida.ai` con el logo.

**El interruptor de pánico** es el mismo switch: apagar el hook en el panel
devuelve el envío a Supabase, que usa las plantillas del paso 1. No requiere
desplegar nada.

## La caducidad tiene que cuadrar

El correo dice *«caduca en 1 hora»*. Ese número sale de
`minutosDeCaducidad()` (`src/lib/correo/auth.ts`), cuyo default —60 min— es el
de fábrica de Supabase (`mailer_otp_exp` = 3600 s).

**Si se cambia el OTP Expiration en Supabase (Authentication → Emails), hay que
cambiar `AUTH_CORREO_CADUCIDAD_MIN` en Vercel al mismo valor** y regenerar las
plantillas del paso 1. Un correo que promete una hora y caduca a los quince
minutos es peor que uno que no promete nada.

## Lo que el endpoint garantiza

`src/app/api/auth/correo/route.ts`, con su prueba al lado:

- **Firma Standard Webhooks verificada siempre** (el mismo verificador del
  correo entrante). Sin ella, ese endpoint sería una máquina pública de mandar
  correos con nuestro remitente y nuestro logo: phishing firmado por nosotros.
  Sin secreto → 500; firma mala o de hace media hora → 401. Cero envíos.
- **Nunca 200 en falso.** Si el correo no salió, Supabase se entera y se lo
  dice a la persona, en vez de dejarla mirando una bandeja vacía.
- **El `redirect_to` pasa por lista de permitidos** antes de entrar a la liga:
  solo el origen de `NEXT_PUBLIC_APP_URL`. Un destino ajeno cae a
  `/auth/callback` en vez de viajar en el correo.
- **Ni la dirección ni el token acaban en el log.** Este endpoint ve el correo
  de todo el que intenta entrar (LFPDPPP).

## Cómo se mira el render

```bash
npx vite-node scripts/correo/plantillas-auth.ts
open node_modules/.cache/correo-vista-previa/magic-link.html
```

La vista previa trae el logo como data-URI: es lo que ve quien autoriza la
imagen incrustada. Mirar sirve — así se encontró que las plantillas salían con
el logo apuntando a `localhost:3000`.
