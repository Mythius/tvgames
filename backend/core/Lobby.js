const crypto = require('crypto');
const Player = require('./Player');
const { getGame } = require('../games/registry');

const HOST_DISCONNECT_GRACE_MS = 5 * 60 * 1000; // 5 minutes to reconnect the TV
const MAX_PLAYERS = 16;

class Lobby {
	constructor(code, io, gameList) {
		this.code = code;
		this.io = io;
		this.gameList = gameList;
		this.hostToken = crypto.randomUUID();
		this.hostSocketId = null;
		this.hostConnected = false;
		this.hostDisconnectTimer = null;

		/** @type {Map<string, Player>} */
		this.players = new Map();

		this.phase = 'lobby'; // 'lobby' | 'in-game'
		this.selectedGameId = null;
		this.currentGame = null;

		this.createdAt = Date.now();
		this.lastActivity = Date.now();
	}

	touch() {
		this.lastActivity = Date.now();
	}

	isEmpty() {
		if (this.hostConnected) return false;
		for (const player of this.players.values()) {
			if (player.connected) return false;
		}
		return true;
	}

	// --- membership -----------------------------------------------------

	addPlayer(name) {
		if (this.players.size >= MAX_PLAYERS) {
			throw new Error('Lobby is full');
		}
		const trimmed = (name || '').trim().slice(0, 20) || 'Player';
		const player = new Player(trimmed);
		this.players.set(player.id, player);
		this.touch();
		return player;
	}

	removePlayer(playerId) {
		const player = this.players.get(playerId);
		if (!player) return;
		this.clearPlayerDisconnectTimer(player);
		this.players.delete(playerId);
		if (this.currentGame) {
			this.currentGame.handlePlayerLeave(player);
		}
		this.touch();
	}

	clearPlayerDisconnectTimer(player) {
		if (player.disconnectTimer) {
			clearTimeout(player.disconnectTimer);
			player.disconnectTimer = null;
		}
	}

	markPlayerDisconnected(playerId) {
		const player = this.players.get(playerId);
		if (!player) return;
		player.connected = false;
		player.socketId = null;
		this.clearPlayerDisconnectTimer(player);
		player.disconnectTimer = setTimeout(() => {
			this.removePlayer(playerId);
			this.broadcastState();
		}, player.graceMs);
		this.touch();
	}

	reconnectPlayer(player, socketId) {
		this.clearPlayerDisconnectTimer(player);
		player.connected = true;
		player.socketId = socketId;
		if (this.currentGame) {
			this.currentGame.handlePlayerReconnect(player);
		}
		this.touch();
	}

	markHostDisconnected() {
		this.hostConnected = false;
		this.hostSocketId = null;
		if (this.hostDisconnectTimer) clearTimeout(this.hostDisconnectTimer);
		this.hostDisconnectTimer = setTimeout(() => {
			this.hostDisconnectTimer = null;
		}, HOST_DISCONNECT_GRACE_MS);
	}

	reconnectHost(socketId) {
		if (this.hostDisconnectTimer) {
			clearTimeout(this.hostDisconnectTimer);
			this.hostDisconnectTimer = null;
		}
		this.hostConnected = true;
		this.hostSocketId = socketId;
		this.touch();
	}

	// --- game lifecycle ---------------------------------------------------

	selectGame(gameId) {
		if (this.phase !== 'lobby') throw new Error('Cannot change game while one is in progress');
		if (!getGame(gameId)) throw new Error('Unknown game');
		this.selectedGameId = gameId;
		this.touch();
	}

	startGame() {
		if (this.phase !== 'lobby') throw new Error('Game already in progress');
		const GameClass = getGame(this.selectedGameId);
		if (!GameClass) throw new Error('No game selected');
		const connectedCount = [...this.players.values()].filter(p => p.connected).length;
		if (connectedCount < GameClass.minPlayers) {
			throw new Error(`Need at least ${GameClass.minPlayers} players`);
		}
		for (const player of this.players.values()) player.score = 0;
		this.currentGame = new GameClass(this);
		this.phase = 'in-game';
		this.currentGame.start();
		this.touch();
	}

	endGame() {
		if (this.currentGame) this.currentGame.destroy();
		this.currentGame = null;
		this.phase = 'lobby';
		this.selectedGameId = null;
		this.touch();
	}

	destroy() {
		if (this.currentGame) this.currentGame.destroy();
		for (const player of this.players.values()) this.clearPlayerDisconnectTimer(player);
		if (this.hostDisconnectTimer) clearTimeout(this.hostDisconnectTimer);
	}

	// --- transport helpers used by Game subclasses -----------------------

	broadcastTV(event, payload) {
		if (this.hostConnected && this.hostSocketId) {
			this.io.to(this.hostSocketId).emit(event, payload);
		}
	}

	sendToPlayer(playerId, event, payload) {
		const player = this.players.get(playerId);
		if (player && player.connected && player.socketId) {
			this.io.to(player.socketId).emit(event, payload);
		}
	}

	broadcastPlayers(event, payload, { excludeIds = [] } = {}) {
		for (const player of this.players.values()) {
			if (excludeIds.includes(player.id)) continue;
			if (player.connected && player.socketId) {
				this.io.to(player.socketId).emit(event, payload);
			}
		}
	}

	// --- state snapshots ---------------------------------------------------

	playersPublicInfo() {
		return [...this.players.values()].map(p => p.publicInfo());
	}

	baseState() {
		return {
			code: this.code,
			phase: this.phase,
			selectedGameId: this.selectedGameId,
			players: this.playersPublicInfo(),
			game: this.currentGame ? this.currentGame.getPublicState() : null,
		};
	}

	hostView() {
		return {
			...this.baseState(),
			isHost: true,
			hostConnected: this.hostConnected,
			gameList: this.gameList,
		};
	}

	playerView(player) {
		return {
			...this.baseState(),
			isHost: false,
			you: {
				id: player.id,
				name: player.name,
				score: player.score,
				...(this.currentGame ? this.currentGame.getPlayerState(player) : {}),
			},
		};
	}

	broadcastState() {
		this.broadcastTV('state:update', this.hostView());
		for (const player of this.players.values()) {
			if (player.connected && player.socketId) {
				this.io.to(player.socketId).emit('state:update', this.playerView(player));
			}
		}
	}
}

module.exports = Lobby;
module.exports.MAX_PLAYERS = MAX_PLAYERS;
