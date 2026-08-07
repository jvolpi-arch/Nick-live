# NICK LIVE

Aplicación local para conversar en directo con Nick, narrador de *La República*, usando la voz existente de ElevenLabs.

## Lo que hace

- Abre una pantalla negra minimalista en Chrome.
- Nick se presenta con la frase fijada por Jorge.
- Escucha automáticamente por el micrófono.
- Detecta cuándo terminas de hablar.
- Transcribe tu intervención con OpenAI.
- Recupera fragmentos pertinentes de la novela.
- Genera una respuesta de Nick de un máximo de 50 palabras.
- La reproduce con la Voice ID de ElevenLabs.
- Vuelve a escuchar automáticamente.

## Primera instalación en Mac

1. Descomprime esta carpeta.
2. Ábrela en Visual Studio Code.
3. En VS Code, abre **Terminal > New Terminal**.
4. Escribe:

```bash
cp .env.example .env
```

5. Abre el archivo `.env` y sustituye únicamente estas tres líneas:

```text
OPENAI_API_KEY=...
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...
```

No envíes esas claves a nadie y no subas `.env` a GitHub.

6. En la terminal, escribe:

```bash
npm install
npm start
```

7. Abre Chrome y entra en:

```text
http://localhost:3000
```

8. Pulsa **INICIAR** y permite el acceso al micrófono.

## Uso normal

Después de pulsar **INICIAR**, no hay que tocar nada. Nick habla, escucha, responde y vuelve a escuchar automáticamente.

### Teclas discretas

- `F`: entrar o salir de pantalla completa.
- `E`: mostrar u ocultar el estado técnico de ensayo.
- `R`: reiniciar la memoria de la conversación.

## Antes de Fundación Telefónica

- Utiliza Chrome actualizado.
- Conecta el Mac a corriente.
- Desactiva notificaciones y suspensión automática.
- Prueba el micrófono y la salida de audio del auditorio.
- Usa auriculares durante ensayos para evitar realimentación.
- En escenario, coloca los altavoces por delante del micrófono y reduce su captación.
- Conserva una red alternativa mediante el teléfono.

## Ajustes de voz

La voz se configura en `src/server.js` dentro de `voice_settings`. Los valores iniciales buscan estabilidad y baja latencia sin volverla excesivamente expresiva.

## Privacidad

La aplicación se ejecuta localmente, pero envía audio a OpenAI para transcripción, texto a OpenAI para generar respuestas y texto a ElevenLabs para sintetizar la voz.
pwd
