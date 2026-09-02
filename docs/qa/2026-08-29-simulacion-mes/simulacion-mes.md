# Simulación de un mes completo — ZZZ QA MES DEMO — 2026-08-29-simulacion-mes

Tenant sintético `ZZZ QA MES DEMO` (`aaaaaaaa-0000-4000-8000-000000009902`), 4 unidades, 20 viajes
en 2026-08. Extiende el ejército de QA existente (mismo guard, mismo Meta falso,
MISMO `processInbound`); NO se limpia al final — el tenant queda como evidencia.

## Viajes (20)

| folio | chofer | cerró | cuadre | anticipo | gastos | ingreso flete | tickets | costo OCR/cuadre |
|---|---|---|---|---|---|---|---|---|
| QAMES-144045 | 5215559920001 | ✅ | fallo | $4884.73 | $6449.71 | $9314.23 | 3 | $0.0133 |
| QAMES-341561 | 5215559920001 | ✅ | ok | $3080.85 | $3510.34 | $9495.62 | 2 | $0.0175 |
| QAMES-412605 | 5215559920001 | ✅ | ok | $3729.43 | $2234.62 | $10593.65 | 3 | $0.0214 |
| QAMES-286103 | 5215559920001 | ✅ | ok | $4462.06 | $5415.83 | $7935.02 | 3 | $0.0204 |
| QAMES-944845 | 5215559920001 | ✅ | ok | $5659.36 | $3318.14 | $7542.57 | 2 | $0.0162 |
| QAMES-967518 | 5215559920002 | ✅ | ok | $3177.19 | $4101.66 | $8546.64 | 2 | $0.0153 |
| QAMES-608732 | 5215559920002 | ✅ | ok | $5621.10 | $4082.70 | $7793.60 | 2 | $0.0183 |
| QAMES-504119 | 5215559920002 | ✅ | ok | $3756.27 | $2678.65 | $9444.58 | 3 | $0.0201 |
| QAMES-285088 | 5215559920002 | ✅ | ok | $4836.95 | $4331.99 | $10536.42 | 2 | $0.0164 |
| QAMES-723272 | 5215559920002 | ✅ | ok | $4197.16 | $5383.46 | $10712.12 | 3 | $0.0207 |
| QAMES-519457 | 5215559920003 | ✅ | ok | $4918.85 | $3018.21 | $11272.48 | 2 | $0.0160 |
| QAMES-961608 | 5215559920003 | ✅ | ok | $3702.96 | $3992.17 | $10690.07 | 3 | $0.0229 |
| QAMES-986475 | 5215559920003 | ✅ | ok | $5616.46 | $3882.93 | $11849.13 | 1 | $0.0119 |
| QAMES-508831 | 5215559920003 | ✅ | ok | $3117.53 | $2092.83 | $8665.35 | 1 | $0.0125 |
| QAMES-187077 | 5215559920003 | ✅ | ok | $4457.84 | $2703.74 | $9806.66 | 1 | $0.0135 |
| QAMES-116221 | 5215559920004 | ✅ | ok | $4034.47 | $3713.98 | $7275.34 | 2 | $0.0166 |
| QAMES-577654 | 5215559920004 | ✅ | ok | $3611.02 | $4762.84 | $10287.89 | 3 | $0.0199 |
| QAMES-110513 | 5215559920004 | ✅ | ok | $4283.63 | $3607.61 | $10088.33 | 1 | $0.0125 |
| QAMES-976742 | 5215559920004 | ✅ | ok | $5536.52 | $4496.97 | $8066.67 | 3 | $0.0203 |
| QAMES-861493 | 5215559920004 | ✅ | ok | $4544.84 | $2660.79 | $11121.12 | 2 | $0.0164 |

## Resumen

- Viajes cerrados con liquidación: 20/20
- Oráculo cuadre_balancea en ✅: 19/20
- Viajes con diesel sobre política (>$4000): 1
- Total anticipos: $87229.22
- Total gastos comprobados (tickets enviados): $76439.17
- Total ingreso de flete capturado: $191037.49

## Facturación y cobranza

Factura y cobranza completadas sobre viajes reales del mes.

- Factura `231cb4b2-6ae5-4abe-b3f9-c6ead6d1bab6` — serie QAMES folio 1, UUID `a3f93a48-44a7-402e-b840-3396484b78c1`
- Ampara 3 viajes, total $34108.06
- Abono 1: $20464.84 · Abono 2: $13643.22
- Estatus final: **pagada**


## Gasto real de la corrida (ledger)

```
Corrida 2026-08-29-simulacion-mes: $0.3736 de $2 tope
    google/gemini-3.1-flash-lite             $0.0750
    anthropic/claude-sonnet-5                $0.2986
```

Total: $0.3736 USD.

## Limpieza

NO se ejecutó — el tenant `ZZZ QA MES DEMO` queda sembrado a propósito, como
demostración de un mes de actividad real sobre el pipeline de producción.
