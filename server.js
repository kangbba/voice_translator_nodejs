// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const speech = require('@google-cloud/speech').v1p1beta1;
const app = express();
const port = 3000;

// Google Cloud 서비스 계정 키 파일 경로 설정
process.env.GOOGLE_APPLICATION_CREDENTIALS = '/Users/ensayne/AndroidStudioProjects/VoiceTranslatorProject/voice_translator_nodejs/stt-hardware-test-95b82c5ac6f1.json';

const client = new speech.SpeechClient();

let recognizeStream = null;
let isRecognizing = false;

function startRecognizeStream() {
  recognizeStream = client
    .streamingRecognize({
      config: {
        encoding: 'LINEAR16',
        sampleRateHertz: 16000,
        languageCode: 'en-US',
      },
      interimResults: true,
    })
    .on('error', (err) => console.error('API request error: ', err))
    .on('data', (data) => {
      console.log('Transcription:', data.results[0].alternatives[0].transcript);
    });
}

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('WebSocket connected');

  ws.on('message', (message) => {
    // 수신된 데이터가 Buffer인 경우 로그 출력
    if (Buffer.isBuffer(message)) {
      console.log('Received Buffer data from ESP32:', message);

      // 음성 인식이 활성화된 경우에만 Google API로 데이터를 보냅니다.
      if (isRecognizing && recognizeStream) {
        recognizeStream.write(message); // Google API로 데이터 스트리밍
      }
    } else {
      // 이 부분은 ESP32에서 JSON 형식으로 명령을 보낼 때만 해당
      try {
        const { command } = JSON.parse(message);
        if (command === 'start' && !isRecognizing) {
          isRecognizing = true;
          startRecognizeStream();
          console.log('Recognition started');
        } else if (command === 'stop' && isRecognizing) {
          isRecognizing = false;
          if (recognizeStream) {
            recognizeStream.end();
            recognizeStream = null;
          }
          console.log('Recognition stopped');
        }
      } catch (error) {
        console.error('Error parsing message:', error.message);
      }
    }
  });

  ws.on('close', () => {
    console.log('WebSocket closed');
    if (recognizeStream) {
      recognizeStream.end();
    }
  });
});

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Speech Recognition</title>
    </head>
    <body>
      <h1>Google Speech-to-Text WebSocket Demo</h1>
      <button id="toggleButton">Start Recognition</button>
      <script>
        const ws = new WebSocket('ws://localhost:${port}');
        const toggleButton = document.getElementById('toggleButton');
        let isRecognizing = false;

        toggleButton.addEventListener('click', () => {
          isRecognizing = !isRecognizing;
          toggleButton.innerText = isRecognizing ? 'Stop Recognition' : 'Start Recognition';
          ws.send(JSON.stringify({ command: isRecognizing ? 'start' : 'stop' }));
        });

        ws.onopen = () => {
          console.log('WebSocket connected');
        };

        ws.onmessage = (event) => {
          console.log('Server:', event.data);
        };

        ws.onclose = () => {
          console.log('WebSocket disconnected');
        };
      </script>
    </body>
    </html>
  `);
});

server.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
