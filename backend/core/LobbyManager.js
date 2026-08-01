const Lobby = require('./Lobby');
const { listGames } = require('../games/registry');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O to avoid confusion with 1/0
const CODE_LENGTH = 4;
const CLEANUP_INTERVAL_MS = 60 * 1000;
const STALE_MS = 10 * 60 * 1000; // remove empty lobbies after 10 minutes of inactivity

class LobbyManager {
	constructor(io) {
		this.io = io;
		/** @type {Map<string, Lobby>} */
		this.lobbies = new Map();
		this.cleanupInterval = setInterval(() => this.sweep(), CLEANUP_INTERVAL_MS);
	}

	generateCode() {
		let code;
		do {
			code = Array.from({ length: CODE_LENGTH }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
		} while (this.lobbies.has(code));
		return code;
	}

	createLobby() {
		const code = this.generateCode();
		const lobby = new Lobby(code, this.io, listGames());
		this.lobbies.set(code, lobby);
		return lobby;
	}

	getLobby(code) {
		return this.lobbies.get((code || '').toUpperCase()) || null;
	}

	removeLobby(code) {
		const lobby = this.lobbies.get(code);
		if (!lobby) return;
		lobby.destroy();
		this.lobbies.delete(code);
	}

	sweep() {
		const now = Date.now();
		for (const [code, lobby] of this.lobbies.entries()) {
			if (lobby.isEmpty() && now - lobby.lastActivity > STALE_MS) {
				this.removeLobby(code);
			}
		}
	}
}

module.exports = LobbyManager;
