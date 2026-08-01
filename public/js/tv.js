const conn = new Connection();
const app = document.getElementById('app');

let latestState = null;

function el(html) {
	const div = document.createElement('div');
	div.innerHTML = html.trim();
	return div.firstElementChild;
}

function render() {
	app.innerHTML = '';
	if (!latestState) return renderConnecting();
	if (latestState.phase === 'lobby') return renderLobby();
	if (latestState.phase === 'in-game') return renderGame();
}

function renderConnecting() {
	app.appendChild(el(`<div class="center"><h1>Connecting…</h1></div>`));
}

function renderLobby() {
	const wrap = el(`<div class="stack center" style="width:100%; gap:28px;"></div>`);

	wrap.appendChild(el(`
		<div class="center">
			<p class="muted">Join at <strong>${location.origin}${location.port ? '' : ''}</strong></p>
			<div class="lobby-code">${latestState.code}</div>
		</div>
	`));

	const players = latestState.players.length
		? latestState.players.map(p => `
			<div class="player-chip ${p.connected ? '' : 'offline'}">
				<span class="dot"></span>${p.name}
				<button class="secondary small" data-kick="${p.id}" style="padding:2px 8px;min-height:auto;">✕</button>
			</div>
		`).join('')
		: `<p class="muted">Waiting for players to join…</p>`;
	const playersCard = el(`<div class="tv-players-grid">${players}</div>`);
	playersCard.querySelectorAll('[data-kick]').forEach(btn => {
		btn.addEventListener('click', () => conn.request('host:kickPlayer', { playerId: btn.dataset.kick }));
	});
	wrap.appendChild(playersCard);

	const games = latestState.gameList.map(g => `
		<button class="game-option ${latestState.selectedGameId === g.id ? 'selected' : ''}" data-game="${g.id}">
			<h3>${g.title}</h3>
			<p class="muted">${g.description}</p>
			<p class="muted">${g.minPlayers}-${g.maxPlayers} players</p>
		</button>
	`).join('');
	const gamesCard = el(`<div class="stack" style="width:100%;max-width:500px;">${games}</div>`);
	gamesCard.querySelectorAll('[data-game]').forEach(btn => {
		btn.addEventListener('click', () => conn.request('host:selectGame', { gameId: btn.dataset.game }));
	});
	wrap.appendChild(gamesCard);

	const connectedCount = latestState.players.filter(p => p.connected).length;
	const selectedGame = latestState.gameList.find(g => g.id === latestState.selectedGameId);
	const canStart = selectedGame && connectedCount >= selectedGame.minPlayers;
	const startBtn = el(`<button ${canStart ? '' : 'disabled'} style="font-size:1.3em;">▶ Start Game</button>`);
	startBtn.addEventListener('click', async () => {
		const res = await conn.request('host:startGame');
		if (!res.ok) alert(res.error);
	});
	wrap.appendChild(startBtn);
	if (selectedGame && !canStart) {
		wrap.appendChild(el(`<p class="muted">Need at least ${selectedGame.minPlayers} players to start.</p>`));
	}

	app.appendChild(wrap);
}

function renderGame() {
	const gameId = latestState.game && latestState.game.gameId;
	const renderer = window.GameRenderers && window.GameRenderers[gameId];
	const wrap = el(`<div class="stack" style="width:100%"></div>`);
	const header = el(`
		<div class="row" style="justify-content:space-between;">
			<span class="badge">Room ${latestState.code}</span>
			<button class="danger small" id="end-game">End Game</button>
		</div>
	`);
	header.querySelector('#end-game').addEventListener('click', () => {
		if (confirm('End the game and return everyone to the lobby?')) conn.request('host:endGame');
	});
	wrap.appendChild(header);

	const gameContainer = el(`<div style="width:100%"></div>`);
	wrap.appendChild(gameContainer);
	app.appendChild(wrap);

	if (renderer && renderer.renderTV) {
		renderer.renderTV(gameContainer, latestState, conn);
	} else {
		gameContainer.appendChild(el(`<p>Unsupported game state.</p>`));
	}
}

conn.on('state:update', state => {
	latestState = state;
	render();
});

conn.whenConnected(() => {
	const saved = Storage.get('tv_session');
	if (saved) {
		conn.request('host:rejoin', saved).then(res => {
			if (!res.ok) {
				Storage.clear('tv_session');
				createLobby();
			}
		});
	} else {
		createLobby();
	}
});

async function createLobby() {
	const res = await conn.request('host:create');
	if (res.ok) {
		Storage.set('tv_session', { code: res.code, hostToken: res.hostToken });
	}
}

render();
