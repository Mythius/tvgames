const conn = new Connection();
const app = document.getElementById('app');

let latestState = null;
let joinError = '';
let joining = false;

function render() {
	app.innerHTML = '';
	if (!latestState) return renderJoin();
	if (latestState.phase === 'lobby') return renderLobby();
	if (latestState.phase === 'in-game') return renderGame();
}

function el(html) {
	const div = document.createElement('div');
	div.innerHTML = html.trim();
	return div.firstElementChild;
}

function renderJoin() {
	const params = new URLSearchParams(location.search);
	const card = el(`
		<div class="stack" style="width:100%">
			<h1>🎉 Living Room Games</h1>
			<p class="muted">Enter the code shown on the TV to join.</p>
			${joinError ? `<div class="error-banner">${joinError}</div>` : ''}
			<form class="stack" id="join-form">
				<input type="text" id="name" placeholder="Your name" maxlength="20" autocomplete="off" required />
				<input type="text" id="code" placeholder="Room code" maxlength="4" autocomplete="off" style="text-transform:uppercase" required />
				<button type="submit">${joining ? 'Joining…' : 'Join'}</button>
			</form>
		</div>
	`);
	const codeInput = card.querySelector('#code');
	codeInput.value = (params.get('code') || '').toUpperCase();
	card.querySelector('#join-form').addEventListener('submit', async e => {
		e.preventDefault();
		joining = true;
		joinError = '';
		render();
		const name = card.querySelector('#name').value;
		const code = codeInput.value.toUpperCase();
		const res = await conn.request('player:join', { code, name });
		joining = false;
		if (res.ok) {
			Storage.set('player_session', { code, playerId: res.playerId, token: res.token });
		} else {
			joinError = res.error || 'Could not join';
			render();
		}
	});
	app.appendChild(card);
}

function renderLobby() {
	const players = latestState.players.map(p => `
		<div class="player-chip ${p.connected ? '' : 'offline'}"><span class="dot"></span>${p.name}</div>
	`).join('');
	const card = el(`
		<div class="stack" style="width:100%">
			<span class="badge">Room ${latestState.code}</span>
			<h2>You're in!</h2>
			<p class="muted">${latestState.selectedGameId ? 'Waiting for the host to start the game…' : 'Waiting for the host to pick a game…'}</p>
			<div class="tv-players-grid">${players}</div>
			<button class="secondary small" id="leave">Leave</button>
		</div>
	`);
	card.querySelector('#leave').addEventListener('click', leaveLobby);
	app.appendChild(card);
}

function leaveLobby() {
	conn.send('player:leave');
	Storage.clear('player_session');
	latestState = null;
	render();
}

function renderGame() {
	const gameId = latestState.game && latestState.game.gameId;
	const renderer = window.GameRenderers && window.GameRenderers[gameId];
	if (renderer && renderer.renderPlayer) {
		renderer.renderPlayer(app, latestState, conn, { leaveLobby });
	} else {
		app.appendChild(el(`<div class="center"><p>Unsupported game state.</p></div>`));
	}
}

conn.on('state:update', state => {
	latestState = state;
	render();
});

conn.whenConnected(() => {
	const saved = Storage.get('player_session');
	if (saved) {
		conn.request('player:rejoin', saved).then(res => {
			if (!res.ok) {
				Storage.clear('player_session');
				if (!latestState) render();
			}
		});
	} else if (!latestState) {
		render();
	}
});

render();
