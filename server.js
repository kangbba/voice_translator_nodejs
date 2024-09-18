const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const speech = require('@google-cloud/speech').v1p1beta1;
const dns = require('dns');

const app = express();
const port = 3000;

// Google Cloud Speech-to-Text 클라이언트 설정
const serviceAccountPath = '/Users/ensayne/AndroidStudioProjects/VoiceTranslatorProject/voice_translator_nodejs/stt-hardware-test-95b82c5ac6f1.json';
const client = new speech.SpeechClient({
  keyFilename: serviceAccountPath,
});

let recognizeStream = null;
let isRecognizing = false;
let isInternetAvailable = false;

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

// 음성 데이터 스트림 시작 함수
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

// 음성 데이터 스트림 중지 함수
function stopRecognizeStream() {
  if (recognizeStream) {
    recognizeStream.end();
    recognizeStream = null;
    isRecognizing = false;
    console.log('Recognition stopped.');
  }
}

// HTTP 서버 생성
const server = http.createServer(app);

// WebSocket 서버 생성 및 엔드포인트 나누기
const wssAudio = new WebSocket.Server({ noServer: true });
const wssCommand = new WebSocket.Server({ noServer: true });

// WebSocket 연결 처리 (음성 데이터 엔드포인트: /audio)
wssAudio.on('connection', (ws) => {
  console.log('WebSocket connected to /audio');

  ws.on('message', (message) => {
    if (Buffer.isBuffer(message)) {
      // 음성 데이터를 수신
      console.log('Received audio data from Arduino');

      // WebSocket으로 음성 데이터를 클라이언트로 전송
      wssAudio.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(Array.from(message)));
        }
      });

      // 음성 인식이 활성화된 경우 Google API로 데이터 전송
      if (isRecognizing && recognizeStream && isInternetAvailable) {
        console.log('Sending data to Google Speech-to-Text API.');
        recognizeStream.write(message);
      }
    }
  });

  ws.on('close', () => {
    console.log('WebSocket closed for /audio');
  });
});

// WebSocket 연결 처리 (명령어 엔드포인트: /command)
wssCommand.on('connection', (ws) => {
  console.log('WebSocket connected to /command');

  ws.on('message', (message) => {
    const command = message.toString().trim();
    if (command === 'start') {
      if (!isRecognizing) {
        console.log('Starting recognition from /command');
        startRecognizeStream();
        ws.send('status: 전송 중');
      } else {
        console.log('Already recognizing.');
      }
    } else if (command === 'stop') {
      if (isRecognizing) {
        console.log('Stopping recognition from /command');
        stopRecognizeStream();
        ws.send('status: 대기 중');
      } else {
        console.log('Recognition is not running.');
      }
    } else {
      console.log(`Unknown command from Arduino: ${command}`);
    }
  });

  ws.on('close', () => {
    console.log('WebSocket closed for /command');
  });
});

// HTTP 엔드포인트 처리 (시각화 클라이언트 제공)
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
      #status {
        font-family: monospace;
        font-size: 16px;
        font-weight: bold;
        color: green;
      }
      #waveform {
        width: 100%;
        height: 200px;
        background-color: #f0f0f0;
        border: 1px solid #ccc;
        margin-bottom: 20px;
      }
    </style>
  </head>
  <body>
    <h1>Google Speech-to-Text WebSocket Demo</h1>
    <div id="status">구글 API 전송 대기 중입니다</div>
    <canvas id="waveform"></canvas>
    <div id="log"></div>

    <script>
      const wsAudio = new WebSocket('ws://localhost:3000/audio');
      const wsCommand = new WebSocket('ws://localhost:3000/command');
      const logDiv = document.getElementById('log');
      const statusDiv = document.getElementById('status');
      const maxLogItems = 20;
      const canvas = document.getElementById('waveform');
      const ctx = canvas.getContext('2d');
      let waveData = [];
      
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      let audioBuffer = [];

      wsAudio.onmessage = (event) => {
        const data = JSON.parse(event.data);
        const logItem = document.createElement('div');
        logItem.textContent = data;

        // Log display logic
        if (logDiv.childNodes.length >= maxLogItems) {
          logDiv.removeChild(logDiv.firstChild);
        }
        logDiv.appendChild(logItem);
        logDiv.scrollTop = logDiv.scrollHeight;

        // Waveform logic
        waveData = data.map(Number); // Convert string data to numbers
        drawWaveform(waveData);
        playAudio(waveData);
      };

      wsCommand.onmessage = (event) => {
        const data = event.data;
        if (data.startsWith('status:')) {
          const statusText = data.split(':')[1].trim();
          statusDiv.textContent = '구글 API ' + statusText;
          statusDiv.style.color = statusText === '전송 중' ? 'red' : 'green';
        }
      };

      wsAudio.onopen = () => {
        console.log('WebSocket connected to /audio');
      };

      wsCommand.onopen = () => {
        console.log('WebSocket connected to /command');
      };

      wsAudio.onclose = () => {
        console.log('WebSocket disconnected from /audio');
      };

      wsCommand.onclose = () => {
        console.log('WebSocket disconnected from /command');
      };

      // Function to draw the waveform
      function drawWaveform(data) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.beginPath();
        ctx.moveTo(0, canvas.height / 2);

        const step = canvas.width / data.length;
        for (let i = 0; i < data.length; i++) {
          const amplitude = data[i] / 32768; // Normalize data to -1 to 1 range
          const y = (amplitude * canvas.height) / 2 + canvas.height / 2;
          ctx.lineTo(i * step, y);
        }

        ctx.strokeStyle = '#007BFF';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Function to play the audio
      function playAudio(data) {
        const buffer = new Float32Array(data.length);
        
        // Normalize data to range between -1 and 1 for audio playback
        for (let i = 0; i < data.length; i++) {
          buffer[i] = data[i] / 32768;
        }

        // Create an AudioBuffer and play the audio data
        const audioBuffer = audioContext.createBuffer(1, buffer.length, 16000);
        audioBuffer.copyToChannel(buffer, 0);

        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContext.destination);
        source.start();
      }
    </script>
  </body>
</html>

  `);
});

// WebSocket 서버 엔드포인트 설정
server.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url, `http://${request.headers.host}`);

  if (pathname === '/audio') {
    wssAudio.handleUpgrade(request, socket, head, (ws) => {
      wssAudio.emit('connection', ws, request);
    });
  } else if (pathname === '/command') {
    wssCommand.handleUpgrade(request, socket, head, (ws) => {
      wssCommand.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// 서버 시작
server.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
