# Agente de asistencia en carretera — diseño conversacional (23-ago-2026)

## El principio
**No es un conversador: es un despachador.** Su métrica es el tiempo hasta que un humano
competente esté hablando con el chofer. Un mensaje que no acorta ese reloj sobra.

Tres reglas: (1) falla hacia ARRIBA — ante duda, silencio o modelo caído, sube de severidad;
bajar de nivel es acto humano firmado. (2) Avisar al jefe es PARALELO, nunca secuencial: en N2+
el jefe se entera antes de que el agente termine su primer turno. (3) El agente prepara y marca,
nunca autoriza, diagnostica ni promete. En severidad alta, sin emojis.

## Detección en tres capas (el modelo NUNCA es el único que detecta)
- **Capa 0, señal de canal (0 ms)**: pin fuera de ruta o de madrugada; ≥3 mensajes en <60 s;
  audio (hoy cae en el `else` de capacidades); incidencia abierta → todo entra al carril.
- **Capa 1, léxico cerrado tipo PALABRAS_TALACHA**: ROJO (herido, volcó, incendio, derrame,
  asalto, arma, auxilio…) → N3 sin preguntar. NARANJA (choque, me pegaron, bloqueo, retén,
  detenido, sin frenos…) → N2.
- **Capa 2, el modelo**: solo refina y redacta.

## Triage: cinco banderas, no categorías
A vida · B vía obstruida · C terceros/delito · D contacto (¿contesta?) · E carga peligrosa.
A=true → N3 sin excepción. Dos o más banderas → sube un nivel. Chofer callado → sube siempre.

| | N3 | N2 | N1 | N0 |
|---|---|---|---|---|
| Mensajes antes de humano | **1** | 4 | sin tope | sin tope |
| Aviso | jefe + dueño, inmediato | jefe inmediato | solicitud al jefe | no |
| LLM en el camino | **no** | acotado | sí | sí |
| Modo mudo | forzoso | si aparece rojo | no | no |
| Reloj muerto | 90 s | 3 min | 10 min | — |
| La cierra | humano firmado | humano firmado | jefe o agente | agente |

## EL RELOJ MUERTO (lo que no existe en ningún competidor)
Un chofer que reporta y se calla es PEOR que uno que nunca reportó: alguien ya sabe que pasó algo
y nadie actúa. t+3min un reintento binario ("¿Estás bien? Contéstame aunque sea SÍ"); t+5min
ESCALADA al jefe con última ubicación y su número ("márcale"); t+10min dueño + tablero en rojo.
Sello atómico por paso (patrón `reclamarEscalacion`), latido por QStash con `notBefore`.
**El silencio nunca cierra nada.** En N3 por violencia el reloj escala solo hacia arriba: nunca
se le reintenta al chofer (un teléfono que vibra durante un asalto es un riesgo).

## Los teléfonos NO viven en el prompt
Tabla `directorio_emergencia` (tenant null = nacional) con `verificado_en` y `verificado_por`.
Guardia de salida: se rechaza cualquier respuesta con 10 dígitos que no coincida con una fila
consultada en ese turno. Si falta el dato: "No tengo cargada tu póliza — ya le avisé a tu jefe".
El protocolo son bloques fijos versionados en `normas/`; el modelo ELIGE el bloque, no lo redacta.

## Prohibiciones con su MECANISMO (un prompt no es un control)
- Consejo médico → léxico rojo corta antes del modelo + guardia de salida.
- "Mueve la unidad" → no existe en ningún bloque + guardia sobre /mueve|orilla|arranca/.
- "El seguro paga" → guardia sobre /cubre|paga|no te preocupes/.
- Teléfono inventado → guardia de dígitos contra el directorio.
- Preguntas de trámite en emergencia → **las tools de dinero NO están cableadas en este agente**.
- Cerrar o bajar severidad solo → CHECK: n2/n3 resuelta exige `cerrada_por`.

## Modo degradado (en carretera de noche es el caso NORMAL)
- Modelo caído: el triage es regex, salen los bloques fijos, el jefe se entera igual.
- El aviso al jefe se dispara en los primeros 300 ms, ANTES del trabajo caro.
- Audio: se transcribe; si falla, N2 mínimo y **se le reenvía el audio al jefe**. Nunca
  "no entiendo audios".
- Foto sola: clasificador de visión decide ticket vs daño ANTES del OCR. Daño → N2 con la foto
  al jefe. Duda → se pregunta y se avisa igual.
- Pin viejo: se manda con su antigüedad explícita ("hace 34 min"), jamás como actual.
- El reloj se mide contra el timestamp de Meta, no el del servidor (DAT-38).
- El kill switch NO aplica al aviso N2/N3, y se declara que se lo saltó.

## Métrica estrella
**TPCH — tiempo hasta el primer contacto humano.** p95 < 3 min en N3, < 8 min en N2.
Falsos negativos de triage (abrió ≤N1 y terminó en N3): **cero, cada uno es post-mortem**.
Falsos positivos 10-20% es SANO — hay que decírselo al jefe para que no pida "no me despiertes".
"Resueltos sin jefe" solo se mide en N1: un N2 resuelto sin jefe es un defecto.
El 100% de N2/N3 se revisa a mano leyendo la conversación completa.
