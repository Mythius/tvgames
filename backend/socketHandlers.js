function safeAck(ack, payload) {
	if (typeof ack === 'function') ack(payload);
}

function attachSocketHandlers(io, lobbyManager) {
	io.on('connection', socket => {
		socket.data.session = null;

		const sessionLobby = () => {
			const session = socket.data.session;
			if (!session) return null;
			const lobby = lobbyManager.getLobby(session.code);
			if (!lobby) return null;
			return { session, lobby };
		};

		// --- host lifecycle ---------------------------------------------------

		socket.on('host:create', (_data, ack) => {
			const lobby = lobbyManager.createLobby();
			lobby.hostConnected = true;
			lobby.hostSocketId = socket.id;
			socket.data.session = { code: lobby.code, role: 'host' };
			safeAck(ack, { ok: true, code: lobby.code, hostToken: lobby.hostToken });
			lobby.broadcastState();
		});

		socket.on('host:rejoin', ({ code, hostToken } = {}, ack) => {
			const lobby = lobbyManager.getLobby(code);
			if (!lobby || lobby.hostToken !== hostToken) {
				return safeAck(ack, { ok: false, error: 'Lobby not found' });
			}
			lobby.reconnectHost(socket.id);
			socket.data.session = { code: lobby.code, role: 'host' };
			safeAck(ack, { ok: true, state: lobby.hostView() });
			lobby.broadcastState();
		});

		// --- player lifecycle ---------------------------------------------------

		socket.on('player:join', ({ code, name } = {}, ack) => {
			const lobby = lobbyManager.getLobby(code);
			if (!lobby) return safeAck(ack, { ok: false, error: 'Lobby not found' });
			const midGame = lobby.phase === 'in-game';
			const allowLateJoin = midGame && lobby.currentGame && lobby.currentGame.constructor.allowLateJoin;
			if (midGame && !allowLateJoin) return safeAck(ack, { ok: false, error: 'Game already in progress' });
			try {
				const player = lobby.addPlayer(name);
				player.socketId = socket.id;
				socket.data.session = { code: lobby.code, role: 'player', playerId: player.id };
				safeAck(ack, { ok: true, playerId: player.id, token: player.token });
				if (allowLateJoin) lobby.currentGame.handlePlayerJoin(player);
				lobby.broadcastState();
			} catch (err) {
				safeAck(ack, { ok: false, error: err.message });
			}
		});

		socket.on('player:rejoin', ({ code, playerId, token } = {}, ack) => {
			const lobby = lobbyManager.getLobby(code);
			if (!lobby) return safeAck(ack, { ok: false, error: 'Lobby not found' });
			const player = lobby.players.get(playerId);
			if (!player || player.token !== token) return safeAck(ack, { ok: false, error: 'Not found' });
			lobby.reconnectPlayer(player, socket.id);
			socket.data.session = { code: lobby.code, role: 'player', playerId };
			safeAck(ack, { ok: true, state: lobby.playerView(player) });
			lobby.broadcastState();
		});

		socket.on('player:leave', () => {
			const ctx = sessionLobby();
			if (ctx && ctx.session.role === 'player') {
				ctx.lobby.removePlayer(ctx.session.playerId);
				ctx.lobby.broadcastState();
			}
			socket.data.session = null;
		});

		// --- host controls ------------------------------------------------------

		socket.on('host:selectGame', ({ gameId } = {}, ack) => {
			const ctx = sessionLobby();
			if (!ctx || ctx.session.role !== 'host') return safeAck(ack, { ok: false, error: 'Not host' });
			try {
				ctx.lobby.selectGame(gameId);
				safeAck(ack, { ok: true });
				ctx.lobby.broadcastState();
			} catch (err) {
				safeAck(ack, { ok: false, error: err.message });
			}
		});

		socket.on('host:startGame', (_data, ack) => {
			const ctx = sessionLobby();
			if (!ctx || ctx.session.role !== 'host') return safeAck(ack, { ok: false, error: 'Not host' });
			try {
				ctx.lobby.startGame();
				safeAck(ack, { ok: true });
				ctx.lobby.broadcastState();
			} catch (err) {
				safeAck(ack, { ok: false, error: err.message });
			}
		});

		socket.on('host:command', ({ action, payload } = {}, ack) => {
			const ctx = sessionLobby();
			if (!ctx || ctx.session.role !== 'host') return safeAck(ack, { ok: false, error: 'Not host' });
			if (ctx.lobby.currentGame) ctx.lobby.currentGame.handleHostAction(action, payload);
			safeAck(ack, { ok: true });
		});

		socket.on('host:endGame', (_data, ack) => {
			const ctx = sessionLobby();
			if (!ctx || ctx.session.role !== 'host') return safeAck(ack, { ok: false, error: 'Not host' });
			ctx.lobby.endGame();
			safeAck(ack, { ok: true });
			ctx.lobby.broadcastState();
		});

		socket.on('host:kickPlayer', ({ playerId } = {}, ack) => {
			const ctx = sessionLobby();
			if (!ctx || ctx.session.role !== 'host') return safeAck(ack, { ok: false, error: 'Not host' });
			ctx.lobby.removePlayer(playerId);
			safeAck(ack, { ok: true });
			ctx.lobby.broadcastState();
		});

		// --- player game actions ------------------------------------------------

		socket.on('player:action', ({ action, payload } = {}) => {
			const ctx = sessionLobby();
			if (!ctx || ctx.session.role !== 'player') return;
			const player = ctx.lobby.players.get(ctx.session.playerId);
			if (!player || !ctx.lobby.currentGame) return;
			ctx.lobby.currentGame.handlePlayerAction(player, action, payload);
		});

		// --- disconnect ------------------------------------------------------

		socket.on('disconnect', () => {
			const ctx = sessionLobby();
			if (!ctx) return;
			const { lobby, session } = ctx;
			if (session.role === 'host' && lobby.hostSocketId === socket.id) {
				lobby.markHostDisconnected();
				lobby.broadcastState();
			} else if (session.role === 'player') {
				const player = lobby.players.get(session.playerId);
				if (player && player.socketId === socket.id) {
					lobby.markPlayerDisconnected(session.playerId);
					lobby.broadcastState();
				}
			}
		});
	});
}

module.exports = attachSocketHandlers;
