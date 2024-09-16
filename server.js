// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const speech = require('@google-cloud/speech');
const bodyParser = require('body-parser');

const app = express();
const port = 3000;
const host = '192.168.75.214';

// Google Speech-to-Text 클라이언트 생성
const client = new speech.SpeechClient({
    keyFilename: '/Users/ensayne/AndroidStudioProjects/VoiceTranslatorProject/voice_translator_nodejs/service-account-key.json',
});

let recognizeStream = null;

// Google Speech-to-Text 요청 설정
const requestConfig = {
  config: {
    encoding: 'LINEAR16',
    sampleRateHertz: 16000,
    languageCode: 'en-US',
  },
  interimResults: true,
};

// 오디오 스트림을 시작하는 함수
function startRecognitionStream() {
  recognizeStream = client
    .streamingRecognize(requestConfig)
    .on('error', (err) => {
      console.error('Error from Speech API:', err);
      stopRecognitionStream();
    })
    .on('data', (data) => {
      const transcript = data.results[0] && data.results[0].alternatives[0]
        ? data.results[0].alternatives[0].transcript
        : '';
      console.log(`Transcription: ${transcript}`);

      // 웹소켓을 통해 브라우저에 전송
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(transcript);
        }
      });
    });
}

// 오디오 스트림을 중지하는 함수
function stopRecognitionStream() {
  if (recognizeStream) {
    recognizeStream.end();
    recognizeStream = null;
  }
}

// WebSocket 서버 생성
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('New WebSocket connection established');
});

app.use(express.static('public')); // 정적 파일 제공
app.use(bodyParser.json()); // JSON 요청 본문 파싱

// '/audio' 엔드포인트에서 데이터를 받기
app.post('/audio', (req, res) => {
  const audioData = req.body.audio; // ESP32에서 전송된 오디오 데이터

  if (!audioData) {
    console.log('No audio data received');
    res.status(400).send('No audio data received');
    return;
  }

  // 스트림이 활성화되어 있지 않다면 시작
  if (!recognizeStream) {
    startRecognitionStream();
  }

  // 오디오 데이터를 스트림에 전달
  recognizeStream.write(audioData);

  res.send('Audio data received');
});

// 서버 실행
server.listen(port, host, () => {
  console.log(`Server is running at http://${host}:${port}`);
});
