# Entur

Las próximas salidas de sus paradas de transporte público en Noruega en Gladys: trenes, metro,
tranvías, autobuses, autocares y ferris, con retrasos, cancelaciones y mensajes de tráfico, en tiempo
real.

Los datos proceden de [Entur](https://entur.no), el registro nacional de todos los operadores de
transporte público noruegos (Vy, Ruter, Skyss, AtB, Kolumbus…), mediante sus API abiertas: **sin
cuenta ni clave**. Esta integración no está afiliada a Entur.

## Lo que obtiene

- **Un dispositivo por parada seguida** (filtrada si lo desea por líneas, dirección o modo de
  transporte): próxima salida y salida siguiente (minutos), retraso de la próxima salida (minutos), su
  línea y su destino (texto), y si un mensaje de tráfico afecta a sus salidas (sí/no).
- **Un widget del panel** con las próximas salidas de una parada: hora, minutos, retraso, salidas
  canceladas en rojo, mensajes de tráfico arriba.
- **Cuatro disparadores de escena**: hora de salir, salida con retraso, salida cancelada, nueva
  incidencia.
- **Una acción de escena** que lee las próximas salidas de una parada, con una frase lista para enviar
  por mensaje o por un altavoz.

## Requisitos

- Gladys Assistant 5.1.0 o posterior.
- Acceso a Internet desde el equipo de Gladys (la integración llama a `api.entur.io`).
- Una parada en Noruega. Entur cubre todo el país, no los demás países nórdicos.

## Instalación

1. En Gladys, abra **Integraciones → Instalar desde GitHub**.
2. Pegue `https://github.com/guim31/gladys-entur` e instale.
3. Abra la pestaña **Configuración** de la integración.

## Configuración

### Ajustes

- **Idioma de los textos**: idioma de los nombres de funciones (fijados al crear el dispositivo), de
  las frases de las escenas y de los mensajes de tráfico cuando Entur los publica en ese idioma. Entur
  escribe sus mensajes en noruego y a menudo en inglés: un mensaje sin el idioma elegido se muestra en
  inglés, si no en noruego. El noruego no se ofrece como idioma de la interfaz.
- **Intervalo de actualización**: 30 segundos, 1 minuto (por defecto) o 2 minutos. Todos los
  dispositivos creados se leen en una sola petición.

### Añadir una parada

1. **Buscar una parada**: escriba un nombre (`Jernbanetorget`, `Bergen busstasjon`…). La respuesta
   muestra las paradas encontradas con su identificador, por ejemplo `NSR:StopPlace:58366`.
2. **Añadir una parada**: pegue el identificador (o solo el número, o el nombre exacto si es único).
   Filtros opcionales:
   - **Líneas**: `L1, R13` solo conserva estas líneas (tal como figuran en el vehículo).
   - **Dirección**: `Ski` solo conserva las salidas cuyo destino contiene este texto (sin importar
     acentos ni mayúsculas, `lillestrom` encuentra `Lillestrøm`).
   - **Modo**: tren, metro, tranvía, autobús, autocar o ferry, para los grandes nudos.
3. Abra la pestaña **Descubrir** y añada el dispositivo a Gladys.

La misma parada con otros filtros da otro dispositivo: añada Oslo S dirección Ski y Oslo S dirección
Drammen para seguir ambos sentidos. Se pueden seguir hasta 20 paradas.

### Quitar una parada, comprobar el estado

- **Quitar una parada**: escriba su nombre tal como lo muestra el estado (`Oslo S (L1)`) o su
  identificador. Su dispositivo permanece en Gladys hasta que lo elimine.
- **Ver lo que se sigue**: las paradas, si su dispositivo existe, la última lectura de Entur y el
  último error.

## Dispositivos

| Función          | Tipo            | Contenido                                                    |
| ---------------- | --------------- | ------------------------------------------------------------ |
| Próxima salida   | duración (min)  | minutos hasta la próxima salida que circula (0 = sale ahora) |
| Salida siguiente | duración (min)  | minutos hasta la siguiente                                   |
| Retraso          | duración (min)  | retraso de la próxima salida (0 si es puntual o adelantada)  |
| Línea y destino  | texto           | `L1 → Spikkestad`                                            |
| Incidencia       | binario (sí/no) | un mensaje de tráfico afecta a las salidas del dispositivo   |

Las salidas canceladas se omiten en las cuentas atrás. Sin salidas en las próximas 24 horas, las
cuentas atrás muestran 1440 minutos. Solo cuentan las salidas que conservan los filtros.

## Widget del panel

**Próximas salidas**: elija una parada. El widget muestra sus ocho próximas salidas (línea, destino,
hora estimada, minutos, retraso): en verde cuando el vehículo se sigue en tiempo real, en naranja a
partir de dos minutos de retraso, en rojo si se cancela, en gris para un horario teórico. El pie
muestra los mensajes de tráfico de la parada.

## Disparadores de escena

Cada disparador puede limitarse a una parada y a una línea (tal como figura en el vehículo, en
mayúsculas).

- **Hora de salir**: una salida sale en el número de minutos elegido (1 a 20). Una vez por salida,
  cuando su cuenta atrás llega a ese número. Una salida vista por primera vez ya dentro de la ventana
  no dispara.
- **Salida con retraso**: una salida lleva al menos el retraso elegido (1 a 60 minutos). Una vez por
  salida y umbral.
- **Salida cancelada**: una salida se cancela. Una vez por salida.
- **Nueva incidencia**: un nuevo mensaje de tráfico afecta a las salidas de una parada. Una vez por
  mensaje.

Variables transmitidas a la escena: parada, línea, modo, destino, andén, horas prevista y estimada,
minutos, retraso; para una incidencia, su resumen y sus detalles. Lo que ya existe al arrancar la
integración no se anuncia; las cancelaciones y los mensajes ya anunciados no se anuncian de nuevo tras
un reinicio.

## Acciones de escena

**Leer las próximas salidas de Entur**: elija una parada y, si lo desea, una línea. Salidas: una frase
(`Tren L1 hacia Spikkestad en Oslo S: en 3 y 18 min`), la parada, la línea, el destino, los minutos de
espera, los minutos hasta la siguiente, el retraso, la hora estimada, el andén, tiempo real (1/0),
incidencia (1/0). La frase sigue el idioma de la configuración.

## Ejemplos de escenas

- **Salir hacia el tren**: disparador «Hora de salir», parada Oslo S (L1), 7 min → enviar «Su L1 sale
  en {{minutes}} min del andén {{platform}}» y hacer parpadear la luz de la entrada.
- **Resumen de la mañana**: a las 7:00 los días laborables, acción «Leer las próximas salidas de
  Entur» → enviar su frase al altavoz de la cocina.
- **Avisar de un autobús cancelado**: disparador «Salida cancelada», parada Jernbanetorget (31) →
  enviar un mensaje con el destino y la hora prevista.

## Datos, actualización y cuotas

Las API de Entur son gratuitas y abiertas (licencia NLOD). Entur pide a cada cliente que se
identifique: la integración envía la cabecera `ET-Client-Name: guim31-gladys` y lee todas sus paradas
en una sola petición, como mucho cada 30 segundos, y solo para los dispositivos creados en Gladys. Los
datos son el tiempo real de los operadores cuando lo publican; si no, su horario.

## Solución de problemas

- **Ningún dispositivo en Descubrir**: añada primero la parada con «Añadir una parada».
- **«No se puede contactar con Entur»**: el equipo de Gladys no tiene acceso a Internet, o Entur no
  funciona. La integración lo reintenta en cada actualización y avisa cuando vuelve.
- **Se rechaza un filtro de línea**: la respuesta muestra las líneas de la parada; escriba la línea tal
  como figura allí.
- **Un disparador no se activa**: compruebe la línea (exacta, en mayúsculas) y que el dispositivo
  existe en Gladys: solo se leen los dispositivos creados.

## Limitaciones

- Desarrollada sin vivir en Noruega, contra la API real de Entur: sus comentarios son bienvenidos.
- Los nombres de las funciones se fijan al crear el dispositivo.
- Los mensajes de tráfico están en noruego y a menudo en inglés, nunca traducidos.
- Las salidas se leen para las próximas 24 horas: las 40 próximas de las líneas y el modo elegidos (filtradas por Entur), 100 con un filtro de dirección. En un gran nudo sin filtro, 40 salidas pueden cubrir solo media hora.

## Créditos

Datos: [Entur](https://developer.entur.org), licencia NLOD. Inspirada en la integración de Home
Assistant `entur_public_transport` (Apache 2.0) y en las integraciones `gladys-tisseo` y
`gladys-gtfs`.
