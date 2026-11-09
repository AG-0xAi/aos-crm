# Ejemplo: "Programar serie" -- fechas de envío con huso horario

Betty no tiene un paso nativo de aritmética de fechas. "Programar serie" necesita 10 fechas de
envío por persona, cada una la fecha de alta más N días a las 09:00 hora de Madrid, cruzando
correctamente los cambios de hora de verano/invierno. `registration-schedule.ts` es ese cálculo,
listo para pegar en un paso **CODE** de un workflow.

Sin red, sin dependencias de npm, sin secretos: solo `Intl.DateTimeFormat` y aritmética de fechas.

## Cómo pegarlo en un paso CODE

1. Crea (o edita) un paso **CODE** en el workflow.
2. Twenty espera un módulo que exporte una función `main` (el nombre de handler por defecto,
   `DEFAULT_HANDLER_NAME` en `packages/twenty-server/src/engine/metadata-modules/logic-function/constants/handler.contant.ts`)
   con la firma `async (params) => { ... }`. Copia el contenido de `registration-schedule.ts` tal
   cual -- ya exporta `main` con esa firma.
3. Al llamar al workflow, el paso recibe como `params` el objeto de entrada (ver abajo) y devuelve
   el objeto de salida; el resto del workflow puede usar `sendAt` para programar las acciones de
   la serie.

## Entrada y salida

Entrada (`params`):

```json
{
  "registeredAt": "2026-03-20T10:00:00.000Z",
  "offsetsDays": [0, 2, 4, 6, 8, 10, 12, 14, 16, 18]
}
```

- `registeredAt`: fecha de alta, ISO 8601 (cualquier instante UTC; el día de alta se calcula en
  hora de Madrid, no en UTC).
- `offsetsDays`: lista de desplazamientos en días desde el día de alta.

Salida:

```json
{
  "sendAt": [
    "2026-03-20T08:00:00.000Z",
    "2026-03-22T08:00:00.000Z",
    "2026-03-24T08:00:00.000Z",
    "2026-03-26T08:00:00.000Z",
    "2026-03-28T08:00:00.000Z",
    "2026-03-30T07:00:00.000Z",
    "2026-04-01T07:00:00.000Z",
    "2026-04-03T07:00:00.000Z",
    "2026-04-05T07:00:00.000Z",
    "2026-04-07T07:00:00.000Z"
  ]
}
```

Cada `sendAt[i]` es 09:00 hora de Madrid del día `alta + offsetsDays[i]`, expresado en UTC. Nótese
el salto de `08:00:00.000Z` a `07:00:00.000Z` entre el quinto y sexto valor: el último domingo de
marzo de 2026 cae en medio de la serie (día 29), y a partir de ahí Madrid pasa de CET (UTC+1) a
CEST (UTC+2), así que las 09:00 locales equivalen a una hora UTC menos.

## Tests

```
$ node --test registration-schedule.test.ts
```

Cubre: el cruce del cambio de marzo, el cruce del cambio de octubre, el desplazamiento 0 (el
propio día de alta) y la lista completa 0,2,4...18 a través del cambio de marzo.
