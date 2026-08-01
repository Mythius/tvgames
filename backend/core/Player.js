const crypto = require('crypto');

const DISCONNECT_GRACE_MS = 2 * 60 * 1000; // 2 minutes to reconnect before a player is dropped

class Player {
	constructor(name) {
		this.id = crypto.randomUUID();
		this.token = crypto.randomUUID();
		this.name = name;
		this.socketId = null;
		this.connected = true;
		this.score = 0;
		this.disconnectTimer = null;
	}

	get graceMs() {
		return DISCONNECT_GRACE_MS;
	}

	publicInfo() {
		return {
			id: this.id,
			name: this.name,
			connected: this.connected,
			score: this.score,
		};
	}
}

module.exports = Player;
module.exports.DISCONNECT_GRACE_MS = DISCONNECT_GRACE_MS;
