const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const speech = require('@google-cloud/speech').v1p1beta1;
const dns = require('dns'); // DNS 모듈을 사용해 인터넷 연결 상태 확인
const readline = require('readline'); // 시리얼 모니터 역할을 위한 입력 모듈

const app = express();
const port = 3000;

// 서비스 계정 키 파일 경로를 하드코딩
const serviceAccountPath = '/Users/ensayne/AndroidStudioProjects/VoiceTranslatorProject/voice_translator_nodejs/stt-hardware-test-95b82c5ac6f1.json';

const client = new speech.SpeechClient({
  keyFilename: serviceAccountPath,
});

let recognizeStream = null;
let isRecognizing = false;
let isInternetAvailable = false;

// 시리얼 입력을 받기 위한 인터페이스 설정
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

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

// 10초마다 인터넷 연결 상태 확인
setInterval(checkInternetConnection, 10000);
checkInternetConnection(); // 초기 실행 시 즉시 확인

function startRecognizeStream() {
  if (!isInternetAvailable) {
    console.error('Cannot start recognition: No internet connection.');
    return;
  }

  console.log('Attempting to start Google Speech-to-Text stream...');
  isRecognizing = true;

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

function stopRecognizeStream() {
  if (recognizeStream) {
    recognizeStream.end();
    recognizeStream = null;
    isRecognizing = false;
    console.log('Recognition stopped.');
  }
}

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('WebSocket connected');

  ws.on('message', (message) => {
    if (Buffer.isBuffer(message)) {
      // 클라이언트로 Buffer 데이터를 전송
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(Array.from(message)));
        }
      });

      // 음성 인식이 활성화된 경우에만 Google API로 데이터를 보냅니다.
      if (isRecognizing && recognizeStream && isInternetAvailable) {
        console.log('Sending data to Google Speech-to-Text API.');
        recognizeStream.write(message); // Google API로 데이터 스트리밍
      } else if (!isInternetAvailable) {
        console.log('Cannot send data: No internet connection.');
      }
    }
  });

  ws.on('close', () => {
    console.log('WebSocket closed');
    if (recognizeStream) {
      stopRecognizeStream();
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
        <div id="status">Waiting for command from Serial...</div>
        <div id="log"></div>
        <script>
          const ws = new WebSocket('ws://localhost:3000');
          const logDiv = document.getElementById('log');
          const statusDiv = document.getElementById('status');
          const maxLogItems = 20;

          ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            const logItem = document.createElement('div');
            logItem.textContent = data.join(', ');

            if (logDiv.childNodes.length >= maxLogItems) {
              logDiv.removeChild(logDiv.firstChild);
            }

            logDiv.appendChild(logItem);
            logDiv.scrollTop = logDiv.scrollHeight;
          };

          ws.onopen = () => {
            console.log('WebSocket connected');
            statusDiv.textContent = 'Waiting for command from Serial...';
          };

          ws.onclose = () => {
            console.log('WebSocket disconnected');
            statusDiv.textContent = 'WebSocket disconnected';
          };

          function updateStatus(isRecognizing) {
            statusDiv.textContent = isRecognizing 
              ? 'Recognition active: Sending data to Google API' 
              : 'Recognition stopped: Waiting for command from Serial...';
          }

          // 서버 측에서 인식이 종료되면 상태 업데이트
          setInterval(() => {
            updateStatus(${isRecognizing});
          }, 1000);
        </script>
      </body>
    </html>
  `);
});

// 시리얼 모니터에서 명령을 수신
rl.on('line', (input) => {
  if (input.trim().toLowerCase() === 'start') {
    console.log('Start command received from Serial Monitor');
    startRecognizeStream();
  } else if (input.trim().toLowerCase() === 'stop') {
    console.log('Stop command received from Serial Monitor');
    stopRecognizeStream();
  } else {
    console.log('Unknown command received from Serial Monitor');
  }
});

server.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
