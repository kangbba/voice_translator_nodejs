const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const speech = require('@google-cloud/speech').v1p1beta1;
const dns = require('dns'); // DNS 모듈을 사용해 인터넷 연결 상태 확인

const app = express();
const port = 3000;

// 서비스 계정 키 파일 경로를 하드코딩
const serviceAccountPath = '/Users/ensayne/AndroidStudioProjects/VoiceTranslatorProject/voice_translator_nodejs/stt-hardware-test-95b82c5ac6f1.json';

const client = new speech.SpeechClient({
  keyFilename: serviceAccountPath, // 서비스 계정 키 파일을 직접 지정
});

let recognizeStream = null;
let isRecognizing = false;
let isInternetAvailable = false; // 인터넷 연결 상태 추적

// 인터넷 연결 여부 확인 함수
function checkInternetConnection() {
  dns.lookup('google.com', (err) => {
    if (err && err.code === 'ENOTFOUND') {
      console.log('No internet connection available.');
      isInternetAvailable = false;
    } else {
      console.log('Internet connection is available.');
      isInternetAvailable = true;
    }
  });
}

// 10초마다 인터넷 연결 상태 확인 (필요에 따라 조정 가능)
setInterval(checkInternetConnection, 10000);
checkInternetConnection(); // 초기 실행 시 즉시 확인

function startRecognizeStream() {
  if (!isInternetAvailable) {
    console.error('Cannot start recognition: No internet connection.');
    return; // 인터넷이 없으면 스트리밍 시작하지 않음
  }

  console.log('Attempting to start Google Speech-to-Text stream...');

  recognizeStream = client
    .streamingRecognize({
      config: {
        encoding: 'LINEAR16',
        sampleRateHertz: 16000,
        languageCode: 'en-US',
      },
      interimResults: true,
    })
    .on('error', (err) => {
      console.error('API request error: ', err);
    })
    .on('data', (data) => {
      if (data.results[0] && data.results[0].alternatives[0]) {
        console.log('Transcription:', data.results[0].alternatives[0].transcript);
      } else {
        console.log('No transcription received from API.');
      }
    })
    .on('end', () => {
      console.log('Google Speech-to-Text streaming ended.');
    });

  console.log('Recognition stream successfully started.');
}

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('WebSocket connected');

  ws.on('message', (message) => {
    // 수신된 데이터가 Buffer인 경우 로그 출력
    if (Buffer.isBuffer(message)) {
      // 클라이언트로 Buffer 데이터를 전송
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(Array.from(message)));
        }
      });

      // 음성 인식이 활성화된 경우에만 Google API로 데이터를 보냅니다.
      if (isRecognizing && recognizeStream) {
        if (isInternetAvailable) {
          console.log('Sending data to Google Speech-to-Text API.');
          recognizeStream.write(message); // Google API로 데이터 스트리밍
        } else {
          console.log('Cannot send data: No internet connection.');
        }
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
        <style>
          #log {
            font-family: monospace;
            font-size: 14px;
            height: 200px;
            overflow-y: scroll;
            border: 1px solid #ccc;
            padding: 10px;
            margin-bottom: 20px;
          }
          #log div {
            white-space: pre-wrap;
          }
        </style>
      </head>
      <body>
        <h1>Google Speech-to-Text WebSocket Demo</h1>
        <div id="log"></div>
        <button id="toggleButton">Send to Google API</button>
        <script>
          const ws = new WebSocket('ws://localhost:3000');
          const logDiv = document.getElementById('log');
          const toggleButton = document.getElementById('toggleButton');
          let isRecognizing = false;
          const maxLogItems = 20;

          toggleButton.addEventListener('click', () => {
            isRecognizing = !isRecognizing;
            toggleButton.innerText = isRecognizing ? 'Stop Sending to Google API' : 'Send to Google API';
            ws.send(JSON.stringify({ command: isRecognizing ? 'start' : 'stop' }));
          });

          ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            const logItem = document.createElement('div');
            logItem.textContent = data.join(', ');

            if (logDiv.childNodes.length >= maxLogItems) {
              logDiv.removeChild(logDiv.firstChild);
            }

            logDiv.appendChild(logItem);
            logDiv.scrollTop = logDiv.scrollHeight; // 스크롤을 아래로 유지
          };

          ws.onopen = () => {
            console.log('WebSocket connected');
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
