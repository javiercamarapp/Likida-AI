# Preguntarle a tus datos de Likida desde Claude o ChatGPT

Esta guía es para una persona, no para un programador. Al terminarla vas a
poder abrir Claude o ChatGPT y preguntarle cosas como *«¿cómo va el cuadre
del viaje F-0123?»*, *«¿qué me falta por facturar?»* o *«¿cuál es el estado
fiscal del mes?»* — y la respuesta sale de TUS datos en Likida, no de la
imaginación del modelo.

**Tres cosas antes de empezar:**

1. **Solo lectura.** Claude o ChatGPT pueden LEER tus datos; no pueden
   cerrar una liquidación, timbrar una factura, mandar un WhatsApp ni tocar
   un peso. Todo lo que tiene efecto se sigue firmando en el panel de
   Likida, como siempre.
2. **Cada conexión ve UNA flota, con TU rol.** Si eres contador, la
   conexión ve lo que el contador ve. Si conectas tú y conecta tu jefe de
   tráfico, cada quien ve lo suyo.
3. **Necesitas una cuenta de Likida con acceso al panel** (o una llave de
   API emitida desde el panel, para el caso avanzado del final).

La dirección del servidor, que vas a pegar en varios lugares, es siempre la
misma:

```
https://app.likida.ai/api/mcp
```

---

## Opción A — Claude (la página claude.ai o la app de escritorio)

1. Abre **claude.ai** e inicia sesión.
2. Ve a **Ajustes → Conectores** (Settings → Connectors). En la app de
   escritorio es el mismo menú; el archivo de configuración que algunos
   tutoriales mencionan (`claude_desktop_config.json`) **no** es para esto —
   ese es solo para servidores locales.
3. Baja hasta **«Agregar conector personalizado»** (Add custom connector).
4. Llena el formulario:
   - **Nombre:** `Likida`
   - **URL del servidor MCP:** `https://app.likida.ai/api/mcp`
   - No hay que llenar nada de «OAuth Client ID» ni «Client Secret»: se
     queda vacío. Claude y Likida se presentan solos.
5. Pulsa **Agregar** y luego **Conectar** (Connect).
6. Se abre una pestaña de **app.likida.ai**. Si no tenías sesión, primero
   te pide entrar como siempre (tu correo). Después aparece la pantalla
   **«¿Dejar que Claude lea los datos de tu flota?»**, que te dice
   exactamente qué va a poder leer según tu rol.
7. Pulsa **«Autorizar lectura»**. La pestaña te regresa a Claude.

**Qué debes ver cuando sale bien:** el conector «Likida» aparece como
conectado, y al abrir una conversación nueva puedes activarlo en el menú de
herramientas (icono de deslizadores). Pregunta algo de prueba: *«lista mis
viajes recientes de Likida»*.

**Si algo sale mal:**

| Lo que ves | Qué significa y qué hacer |
|---|---|
| «Tu cuenta aún no tiene flota» | Tu correo entró, pero nadie te ha dado de alta en una flota. Pídele el alta a quien administra tu cuenta de Likida. |
| «El superadmin no conecta por aquí» | Estás entrando con la cuenta de administración de Likida, que cruza todas las flotas. Esa cuenta usa llaves de API por flota (Opción C). |
| «Cliente desconocido» o «Dirección de retorno no registrada» | El intento de conexión llegó incompleto. Cierra la pestaña y vuelve a pulsar Conectar desde Claude. |
| Claude dice que el conector requiere autenticación otra vez | El acceso expira solo (horas). Pulsa reconectar; si tu sesión de Likida sigue viva, es un clic. |

## Opción B — Claude Code (la terminal)

Si usas Claude Code, pega este comando una vez:

```
claude mcp add --transport http likida https://app.likida.ai/api/mcp
```

Luego, dentro de Claude Code, escribe `/mcp`, elige **likida** y pulsa
**Authenticate**. Se abre el navegador con la misma pantalla de
autorización de la Opción A; autoriza y vuelve a la terminal.

**Qué debes ver cuando sale bien:** `/mcp` muestra `likida ✔ connected`, y
las herramientas (listar_viajes, cuadre_viaje, …) aparecen disponibles.

Si prefieres dejarlo configurado en un proyecto (archivo `.mcp.json` en la
raíz del repo):

```json
{
  "mcpServers": {
    "likida": {
      "type": "http",
      "url": "https://app.likida.ai/api/mcp"
    }
  }
}
```

## Opción C — ChatGPT

ChatGPT acepta servidores MCP en los planes de pago (Plus/Pro; en
Business/Enterprise lo tiene que permitir el administrador del workspace).

1. Abre **chatgpt.com** → tu foto → **Ajustes → Conectores** (Settings →
   Connectors).
2. En **Ajustes avanzados** activa el **Modo desarrollador** (Developer
   mode) si aparece apagado. Sin él, ChatGPT solo acepta conectores de
   búsqueda; con él acepta todas las herramientas de Likida.
3. Pulsa **Crear** (Create) y llena:
   - **Nombre:** `Likida`
   - **URL del servidor MCP:** `https://app.likida.ai/api/mcp`
   - **Autenticación:** **OAuth**. Igual que con Claude: no hay que
     teclear ningún Client ID ni secreto.
4. Guarda. ChatGPT te manda a **app.likida.ai**: inicia sesión si hace
   falta y pulsa **«Autorizar lectura»** en la pantalla de consentimiento.
5. En una conversación, agrega el conector Likida desde el menú **+ →
   herramientas/conectores** y pregunta.

**Qué debes ver cuando sale bien:** el conector aparece en la lista con sus
herramientas enumeradas, y una pregunta de prueba (*«¿qué viajes tengo
abiertos en Likida?»*) contesta con tus datos o con «no hay viajes», nunca
con datos inventados.

**Nota sobre investigación profunda (Deep Research):** ese modo solo usa
dos herramientas, `search` y `fetch`. Likida las trae, así que también
funciona ahí: busca viajes y lee su detalle.

**Si algo sale mal:** los mismos mensajes de la tabla de la Opción A
aplican aquí — la pantalla de autorización es la misma.

## Opción D (avanzada) — con llave de API, sin OAuth

Para un uso sin persona enfrente (un tablero, una prueba, la cuenta de
administración): en el panel de Likida, **Dashboard → Llaves de API**,
emite una llave. La llave se enseña UNA vez; empieza con `lk_live_` y trae
un área (operación, dinero o administración) — la conexión solo alcanza esa
área.

En Claude Code:

```
claude mcp add --transport http likida https://app.likida.ai/api/mcp \
  --header "Authorization: Bearer lk_live_AQUI_TU_LLAVE"
```

**Ojo:** la llave queda escrita en la configuración de esa máquina. Es el
camino para una máquina tuya y de confianza, no para repartir. Si una llave
se filtra, revócala en el panel y emite otra; la revocación surte efecto en
la siguiente petición. Claude.ai y ChatGPT no ocupan esto: su camino es el
OAuth de las opciones A y C.

---

## Qué puede leer la conexión (y qué no)

| Herramienta | Qué contesta | Quién la alcanza |
|---|---|---|
| Viajes de la flota | folio, ruta, fecha y estatus de tus viajes | operación |
| Unidades y sus papeles | qué unidad puede salir a carretera y a cuál se le vence un papel | operación |
| Buscar / detalle de viaje | encontrar un viaje y leer su ficha | operación (las cifras de dinero solo si tu rol las ve) |
| Cuadre de un viaje | ingreso, comprobado, contribución, observaciones fiscales, cobro | dinero |
| Pendiente de facturar | comprobantes sin factura y cuáles vencen ya | dinero |
| Estado fiscal del periodo | IVA acreditable documentado, IEPS de diésel, validación SAT | dinero |
| Métricas de la flota | liquidaciones, montos, tasa de cuadre | dinero |

El rol manda: **jefe de tráfico (encargado)** alcanza operación;
**contador** alcanza dinero; **dueño (flota_admin)** alcanza todo. Cuando
una pregunta pide algo que tu rol no ve, la respuesta lo dice tal cual — no
se inventa nada.

**Y lo que nunca va a hacer, se conecte quien se conecte:** crear o cerrar
viajes o liquidaciones, timbrar, pagar, mandar mensajes, cambiar
configuración. Ese botón no existe en esta puerta.

## Para cortar un acceso

- **Desde el cliente:** borra el conector en Claude/ChatGPT. Con eso el
  cliente olvida sus credenciales; el acceso que ya tenía muere solo (los
  tokens de acceso duran horas y el de renovación expira si no se usa).
- **Una llave de API** se revoca en Dashboard → Llaves de API y muere en la
  siguiente petición.
- **Emergencia** (un acceso OAuth que quieres muerto YA): pídeselo al
  administrador de Likida — puede revocar la familia completa de tokens en
  la base.

Cada consulta que un cliente hace queda registrada en la bitácora de
auditoría de tu flota: qué herramienta, con qué acceso y cuándo.
