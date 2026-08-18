# El correo de acceso

> **Estado al 18-ago-2026, medido:**
> - `SUPABASE_AUTH_HOOK_SECRET` en Vercel (producción) ✓
> - `/api/auth/correo` **vivo** en `da4f944`: sin firma contesta **401**, con
>   firma válida contesta **200** y el correo sale por Resend ✓
> - **Falta lo único que necesita un token `sbp_`:** subir las plantillas y
>   encender el hook. Un comando, abajo.

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
| Remitente | el de Supabase | `Likida <acceso@mail.likida.ai>` |
| Entregabilidad | la de Supabase, con su **cuota diaria** | la de nuestro dominio, medida en `/api/correo/eventos` |
| Se enciende | pegando HTML, sin desplegar | un endpoint + un secreto |

El hook es el destino. Las plantillas del panel son la red: si el hook se
apaga —o antes de encenderlo— el correo sigue siendo de la marca en vez de
volver al de fábrica.

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
