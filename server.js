require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const LobbyManager = require('./backend/core/LobbyManager');
const attachSocketHandlers = require('./backend/socketHandlers');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname + '/public';

app.use(express.static(PUBLIC_DIR));
app.get('/tv', (req, res) => res.sendFile(PUBLIC_DIR + '/tv.html'));
app.get('/play', (req, res) => res.sendFile(PUBLIC_DIR + '/play.html'));

const lobbyManager = new LobbyManager(io);
attachSocketHandlers(io, lobbyManager);

server.listen(PORT, () => {
	console.log(`Serving http://localhost:${PORT}`);
});
