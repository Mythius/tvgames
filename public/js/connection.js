// Thin promise-based wrapper around socket.io-client shared by every page.
class Connection {
	constructor() {
		this.socket = io({ transports: ['websocket', 'polling'] });
		this._onceConnectedCbs = [];
		this.socket.on('connect', () => {
			this._onceConnectedCbs.forEach(cb => cb());
		});
	}

	whenConnected(cb) {
		if (this.socket.connected) cb();
		else this._onceConnectedCbs.push(cb);
	}

	request(event, payload = {}) {
		return new Promise(resolve => {
			this.socket.emit(event, payload, response => resolve(response));
		});
	}

	send(event, payload = {}) {
		this.socket.emit(event, payload);
	}

	on(event, handler) {
		this.socket.on(event, handler);
	}
}

const Storage = {
	get(key) {
		try {
			const raw = localStorage.getItem(key);
			return raw ? JSON.parse(raw) : null;
		} catch (e) {
			return null;
		}
	},
	set(key, value) {
		localStorage.setItem(key, JSON.stringify(value));
	},
	clear(key) {
		localStorage.removeItem(key);
	},
};
