# Conectar WhatsApp (Meta) — guía para Likida

Son cinco valores y un webhook. La parte que se atora casi siempre es el **token
permanente** y el **número de prueba**: los dos están explicados abajo con su
trampa.

Lo que el código espera está en `src/lib/meta/client.ts` y usa la **Graph API
v21.0**.

---

## Los seis links, en el orden en que se usan

| # | Para qué | Link |
|---|---|---|
| 1 | Crear la app y verla | https://developers.facebook.com/apps/ |
| 2 | Guía oficial de Cloud API | https://developers.facebook.com/docs/whatsapp/cloud-api/get-started |
| 3 | Token permanente (System User) | https://business.facebook.com/settings/system-users |
| 4 | Guía oficial de webhooks | https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks |
| 5 | API Setup de tu app | `https://developers.facebook.com/apps/TU_APP_ID/whatsapp-business/wa-dev-console/` |
| 6 | App secret | `https://developers.facebook.com/apps/TU_APP_ID/settings/basic/` |

Los dos últimos llevan tu `APP_ID`, que sale de la URL en cuanto abras la app en
el link 1. Comprobado el 28-jul-2026: los cuatro fijos responden 200.

---

## 1. La app en Meta

1. Entra a **https://developers.facebook.com/apps/** y pulsa **Create App**.
   Si es tu primera vez te pedirá verificar la cuenta con teléfono.
2. Tipo: **Business**. Nombre: el que quieras (no lo ve nadie más).
3. Ya dentro, mira la URL: `.../apps/`**`1234567890`**`/...` — ese número es tu
   `APP_ID`, y lo vas a necesitar para los links 5 y 6.
4. **Add product → WhatsApp → Set up**.

Al terminar tienes un **número de prueba** de Meta y un **WhatsApp Business
Account** de prueba. Eso alcanza para el demo.

> **Trampa del número de prueba.** Solo puede mandar mensajes a números que
> registres a mano (hasta 5), en *WhatsApp → API Setup → To*. Tu propio celular
> tiene que estar ahí o no recibirás nada. Y solo dura mientras la app esté en
> modo desarrollo.

---

## 2. Los cinco valores

Todos salen de **WhatsApp → API Setup**
(`https://developers.facebook.com/apps/TU_APP_ID/whatsapp-business/wa-dev-console/`)
salvo el `APP_SECRET`, que está en **Settings → Basic**
(`https://developers.facebook.com/apps/TU_APP_ID/settings/basic/`), y el
`VERIFY_TOKEN`, que te lo inventas tú.

| Variable | Dónde | Nota |
|---|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | API Setup → *Phone number ID* | Es el ID largo, **no** el número telefónico |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | API Setup → *WhatsApp Business Account ID* | |
| `WHATSAPP_ACCESS_TOKEN` | API Setup → *Temporary access token* | **Dura 24 h.** Ver §3 |
| `WHATSAPP_APP_SECRET` | App settings → Basic → *App secret* → Show | Con esto se firma cada webhook |
| `WHATSAPP_VERIFY_TOKEN` | **Te lo inventas tú** | Cualquier cadena larga y aleatoria |

El `VERIFY_TOKEN` no lo da Meta: lo eliges tú, lo pones en `.env.local` **y**
lo escribes igual en el panel de Meta al dar de alta el webhook. Sirve para que
Meta demuestre que habla con tu servidor y no con otro.

Van a `.env.local`, sin comillas:

```
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_BUSINESS_ACCOUNT_ID=123456789012345
WHATSAPP_ACCESS_TOKEN=EAAG...
WHATSAPP_APP_SECRET=a1b2c3...
WHATSAPP_VERIFY_TOKEN=lo-que-tu-quieras-largo-y-aleatorio
```

---

## 3. El token permanente — hazlo ANTES del demo

El token de API Setup **caduca en 24 horas**. Si lo pones el 5 de agosto, el
6 no funciona. Para uno que no expira:

1. Abre **https://business.facebook.com/settings/system-users**
   (Business Settings → Users → System Users).
2. *Add* → nombre cualquiera → rol **Admin**.
3. En ese usuario: **Add Assets** → *Apps* → tu app → permiso *Full control*.
4. **Generate new token** → elige tu app → marca `whatsapp_business_messaging`
   y `whatsapp_business_management` → *Never expires*.
5. Ese es el que va en `WHATSAPP_ACCESS_TOKEN`.

---

## 4. La URL pública

El webhook necesita **HTTPS accesible desde internet**: `localhost` no sirve.

- Si el proyecto ya está en Vercel, usa esa URL.
- Para probar desde tu máquina: `npx ngrok http 3000` te da una URL temporal.

Pon esa URL en `NEXT_PUBLIC_APP_URL` (hoy dice `http://localhost:3000`), y
**las cinco variables también en las Environment Variables de Vercel** si vas a
desplegar — `.env.local` no viaja al despliegue.

---

## 5. Dar de alta el webhook

En la app: **WhatsApp → Configuration → Webhook → Edit**. Link directo:
`https://developers.facebook.com/apps/TU_APP_ID/whatsapp-business/wa-settings/`

Guía oficial por si algo no coincide:
https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks

- **Callback URL**: `https://TU-URL/api/webhook/whatsapp`
- **Verify token**: exactamente el mismo `WHATSAPP_VERIFY_TOKEN`

Al pulsar *Verify and save*, Meta hace un `GET` a esa ruta. Si el token no
coincide letra por letra, falla — es el error más común aquí.

Después, en **Webhook fields**, suscribe **`messages`**. Sin eso el webhook
queda dado de alta pero no llega nada.

---

## 6. Que el mensaje llegue a un operador

El sistema solo atiende a números dados de alta. Con tu celular:

```sql
insert into operador (tenant_id, nombre, telefono)
values ('11111111-1111-1111-1111-111111111111', 'Javier', '+52TUNUMERO');

insert into viaje (tenant_id, operador_id, anticipo, estatus)
select '11111111-1111-1111-1111-111111111111', id, 5000, 'abierto'
from operador where telefono = '+52TUNUMERO';
```

El teléfono va **como lo manda Meta**: código de país sin `+`, o con `+` según
llegue. Si el operador no se resuelve, el sistema responde *"no te tengo
registrado"* — y ese mensaje es la señal de que el resto del camino sí funcionó.

---

## 7. La prueba

Manda desde tu celular al número de prueba, en este orden:

1. **"hola"** → debe contestar algo. Si contesta, el tramo Meta → webhook →
   processor → Meta funciona entero, que es lo que nunca se ha probado.
2. **Una foto de un ticket** → debe acusar recibo.
3. **"listo"** → debe cuadrar y mandar el PDF.

---

## Si algo falla

| Síntoma | Casi siempre es |
|---|---|
| *Verify and save* falla | El verify token no coincide, o la URL no es HTTPS pública |
| Webhook verificado pero no llega nada | Falta suscribir el campo `messages` |
| Llega y responde 401 | `WHATSAPP_APP_SECRET` mal puesto: la firma HMAC no cuadra |
| Responde "no te tengo registrado" | El teléfono en `operador` no coincide con el formato que manda Meta |
| No llega la respuesta a tu celular | Tu número no está en la lista *To* del número de prueba |
| Funcionaba y dejó de funcionar | El token temporal caducó (24 h). Ver §3 |

Los logs del servidor dicen cuál es: cada paso deja rastro (`wa.*`,
`processInbound.*`).
