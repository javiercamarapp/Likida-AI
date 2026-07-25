# Guion del demo — 6 de agosto, Cliente demo

> Borrador (se afina en FASE 5). Demo por **WhatsApp REAL** proyectado desde la
> laptop de Javier. Público: director de operaciones (ex-Daimler) + admin/fiscal.
> La joya es el **acreditamiento fiscal** (IEPS diésel + IVA + peaje) — lo que
> hace que el contralor se enderece.

## Antes de entrar a la sala (checklist — ver GUIA_BUILD.md §8)
1. **Base despierta**: abrir el dashboard 1 vez (si Supabase pausó, se reactiva). Confirmar que carga con datos.
2. **Migraciones aplicadas** (12) + seed cargado + `/api/demo` GET → `envHealth` verde.
3. **WhatsApp**: número de prueba de Meta activo, webhook verificado, el teléfono del "operador" (Javier) dado de alta como operador en el tenant demo.
4. **Plan B listo**: `/demo` (simulador) abierto en otra pestaña por si WhatsApp cae.
5. Probar con **el WiFi del lugar**, no solo el de la oficina.

## Arco narrativo (≈6-8 min)
**1. El problema (30s, sin pantalla).** "Hoy un operador termina su viaje y alguien captura sus tickets a mano, los coteja contra la política, calcula diferencias, y arma la liquidación. Horas por viaje, errores, y dinero fiscal que se queda en la mesa."

**2. El flujo, en vivo por WhatsApp (3 min).**
- Javier (como operador) manda **fotos de tickets reales** al número de Likida (diésel, caseta, una factura).
- El sistema responde UNA vez: *"Voy recibiendo tus comprobantes…"* (acuse consolidado, no por foto).
- Javier escribe **"listo"**.
- Likida responde con el **cuadre**: comprobado vs anticipo, la diferencia, y las **observaciones en lenguaje humano** (p. ej. "diésel $200 sobre política").
- Llega el **PDF de la liquidación**.
- _Punto clave a decir:_ "El número lo calcula un motor determinístico, no la IA. La IA solo conversa y lee; **nunca inventa un monto** — hay una guardia que lo garantiza en código."

**3. El dashboard — la joya fiscal (2 min).** Proyectar `/dashboard` (passcode).
- Arriba, en grande: **IEPS de diésel acreditable, IVA acreditable, peaje 50%** del periodo, con su fundamento legal (LIF 2026 Art. 20).
- _Punto para el contralor:_ "Esto es dinero que ya pagaron y pueden recuperar contra el ISR. Hoy muchas flotas lo dejan pasar porque el ticket no se factura a tiempo o el CFDI no trae el complemento de hidrocarburos."
- Abrir el **detalle** de una liquidación: diferencias explicadas, comprobantes, acreditables.

**4. Lo que protege el dinero (1 min).** "Validamos cada CFDI contra el SAT en ~100ms (vigente / cancelado / lista negra EFOS), exigimos el XML para el complemento de hidrocarburos, y si el SAT no responde, la liquidación no se cae: queda 'pendiente' y sigue. Nada tumba la operación."

**5. Cierre.** "Configurable por flota, sin datos hardcodeados. Lo que vieron corre contra base real."

## Si algo falla en vivo (contingencia)
- **WhatsApp no entrega / Meta cae** → cambiar a la pestaña del **simulador `/demo`**: mismo motor determinístico, mismos números, sin depender de la red de Meta. Se narra igual. (El simulador NO usa el agente ni WhatsApp.)
- **El SAT no responde** → es el comportamiento esperado: el CFDI queda "pendiente de validación" y la liquidación continúa. Se puede mostrar como feature, no como falla.
- **El LLM tarda/cae** → hay fallback cross-provider; si todo cae, el agente pide reenviar sin inventar números (la guardia de cifras protege).
- **La base pausó** → una consulta la despierta (~10s); por eso el PASO 1 del checklist es abrirla antes.

## Datos del demo (todos DEMO, no de cliente_demo)
- Tenant "Cliente demo" con RFC/operadores/política **inventados** (marcados en el seed).
- Un viaje abierto Silao→Nuevo Laredo, anticipo $10,600, con UNA diferencia visible (diésel $200 sobre tope) y acreditables reales del XML de demo.
- Historial de 3 liquidaciones para que el dashboard no salga vacío.
- ⚠️ Decir explícitamente que son datos de demostración; el dashboard lo marca con una etiqueta discreta.
