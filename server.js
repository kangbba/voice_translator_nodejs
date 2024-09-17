// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const app = express();
const port = 3000;
const host = '192.168.75.215';

app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let latestAudioData = "응답이 아직 안 왔습니다";

wss.on('connection', (ws) => {
  console.log('New WebSocket connection established');
  ws.send(latestAudioData);
});

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta http-equiv="X-UA-Compatible" content="IE=edge">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Audio Data Viewer</title>
      <style>
        #log {
          font-size: 14px;
          margin-bottom: 20px;
        }
        #toggleButton {
          padding: 10px 20px;
          margin-bottom: 20px;
          cursor: pointer;
        }
        #controls {
          display: flex;
          align-items: center;
          margin-top: 10px;
        }
        canvas {
          border: 1px solid black;
        }
      </style>
    </head>
    <body>
      <h1>ESP32 Audio Data</h1>
      <button id="toggleButton">Toggle Visualization</button>
      <div id="log">응답이 아직 안 왔습니다</div>
      <canvas id="audioCanvas" width="800" height="200"></canvas>
      <div id="controls">
        <label for="scaleSlider">Amplitude Scale:</label>
        <input type="range" id="scaleSlider" min="1" max="100" value="50">
      </div>

      <script>
        const logDiv = document.getElementById('log');
        const toggleButton = document.getElementById('toggleButton');
        const canvas = document.getElementById('audioCanvas');
        const ctx = canvas.getContext('2d');
        const scaleSlider = document.getElementById('scaleSlider');
        let visualize = false;
        let amplitudeScale = 50; // 슬라이더로 조절할 진폭 스케일 값

        const ws = new WebSocket('ws://${host}:${port}');

        ws.onmessage = (event) => {
          const data = parseFloat(event.data.split(': ')[1]);
          if (visualize) {
            drawWaveform(data);
          } else {
            logDiv.innerText = event.data;
          }
        };

        ws.onerror = (error) => {
          logDiv.innerText = 'WebSocket error: ' + error.message;
        };

        toggleButton.addEventListener('click', () => {
          visualize = !visualize;
          toggleButton.innerText = visualize ? 'Turn Off Visualization' : 'Turn On Visualization';
          if (!visualize) {
            logDiv.style.display = 'block';
            ctx.clearRect(0, 0, canvas.width, canvas.height);
          } else {
            logDiv.style.display = 'none';
          }
        });

        // 슬라이더로 진폭 조절
        scaleSlider.addEventListener('input', (event) => {
          amplitudeScale = parseInt(event.target.value);
        });

        // 음파 시각화를 부드러운 곡선 형태로 그리는 함수
        const waveData = [];
        const maxWaveDataLength = 400;

        function drawWaveform(value) {
          if (waveData.length >= maxWaveDataLength) {
            waveData.shift(); // 오래된 데이터 제거
          }

          waveData.push(value); // 새로운 데이터 추가

          // 캔버스 초기화 및 그리기 시작
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.beginPath();
          ctx.moveTo(0, canvas.height / 2);

          // 곡선으로 그리기
          for (let i = 0; i < waveData.length; i++) {
            const x = (i / maxWaveDataLength) * canvas.width;
            const y = canvas.height / 2 - (waveData[i] / (32768 / amplitudeScale)) * (canvas.height / 2); // 진폭 스케일을 반영하여 그리기
            ctx.lineTo(x, y);
          }

          ctx.strokeStyle = 'blue';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      </script>
    </body>
    </html>
  `);
});

// '/audio' 엔드포인트에서 데이터를 받기
app.post('/audio', (req, res) => {
  console.log('POST request received at /audio');
  const audioData = req.body.audio;

  if (!audioData) {
    console.log('No audio data received');
    res.status(400).send('No audio data received');
    return;
  }

  console.log('Received audio data:', audioData);
  latestAudioData = `Received audio data: ${audioData}`;

  // 모든 웹 소켓 클라이언트에게 데이터 전송
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(latestAudioData);
    }
  });

  res.send('Audio data received');
});

// 서버 실행
server.listen(port, host, () => {
  console.log(`Server is running at http://${host}:${port}`);
});
