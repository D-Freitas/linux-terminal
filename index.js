const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const pty = require('node-pty');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Servir arquivos estáticos (index.html)
app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', (ws) => {
  console.log('🌐 Novo cliente conectado');

  // Cria um terminal shell (bash ou sh)
  const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-color',
    cols: 80,
    rows: 24,
    cwd: process.env.HOME,
    env: process.env
  });

  // Envia a saída do shell para o cliente
  ptyProcess.on('data', (data) => {
    ws.send(data);
  });

  // Recebe dados do cliente e envia para o shell
  ws.on('message', (msg) => {
    ptyProcess.write(msg);
  });

  // Limpa ao desconectar
  ws.on('close', () => {
    console.log('❌ Cliente desconectado');
    ptyProcess.kill();
  });
});

const PORT = 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Terminal web rodando em http://localhost:${PORT}`);
});
