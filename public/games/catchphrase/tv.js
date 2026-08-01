(function () {
	let listenersRegistered = false;
	let toastTimeout = null;
	let audioCtx = null;

	function el(html) {
		const div = document.createElement('div');
		div.innerHTML = html.trim();
		return div.firstElementChild;
	}

	function getAudioCtx() {
		if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
		return audioCtx;
	}

	function tone(freq, duration, gainLevel) {
		try {
			const ctx = getAudioCtx();
			if (ctx.state === 'suspended') ctx.resume();
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.type = 'square';
			osc.frequency.value = freq;
			gain.gain.setValueAtTime(gainLevel, ctx.currentTime);
			gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
			osc.connect(gain).connect(ctx.destination);
			osc.start();
			osc.stop(ctx.currentTime + duration);
		} catch (e) {
			/* audio not available - visual flash still works */
		}
	}

	function flashOrb(className, ms) {
		const orb = document.querySelector('.buzzer-orb');
		if (!orb) return;
		orb.classList.add(className);
		setTimeout(() => orb.classList.remove(className), ms);
	}

	function showToast(text) {
		const toast = document.querySelector('.catchphrase-toast');
		if (!toast) return;
		toast.textContent = text;
		toast.classList.add('visible');
		if (toastTimeout) clearTimeout(toastTimeout);
		toastTimeout = setTimeout(() => toast.classList.remove('visible'), 2500);
	}

	function registerListeners(conn) {
		if (listenersRegistered) return;
		listenersRegistered = true;
		conn.on('catchphrase:pulse', () => {
			tone(440, 0.06, 0.05);
			flashOrb('pulse', 150);
		});
		conn.on('catchphrase:event', payload => {
			if (payload.type === 'buzz') {
				tone(180, 0.55, 0.2);
				flashOrb('buzz', 600);
				showToast(payload.winningTeam ? `🚨 BUZZ! Point to Team ${payload.winningTeam}` : '🚨 BUZZ!');
			} else if (payload.type === 'gotIt') {
				showToast(payload.team ? `🎉 ${payload.playerName} got it! (Team ${payload.team})` : `🎉 ${payload.playerName} got it!`);
			}
		});
	}

	function renderSettings(game, conn) {
		const bar = el(`<div class="row" style="justify-content:center;flex-wrap:wrap;gap:10px;margin-bottom:8px;"></div>`);
		const freeBtn = el(`<button class="${game.mode === 'free' ? '' : 'secondary'} small">🎲 Free Play</button>`);
		const teamsBtn = el(`<button class="${game.mode === 'teams' ? '' : 'secondary'} small">👥 Teams</button>`);
		freeBtn.addEventListener('click', () => conn.request('host:command', { action: 'setMode', payload: { mode: 'free' } }));
		teamsBtn.addEventListener('click', () => conn.request('host:command', { action: 'setMode', payload: { mode: 'teams' } }));
		bar.appendChild(freeBtn);
		bar.appendChild(teamsBtn);
		if (game.mode === 'free') {
			const timerBtn = el(`<button class="secondary small">⏱ Timer: ${game.freeTimerEnabled ? 'On' : 'Off'}</button>`);
			timerBtn.addEventListener('click', () => conn.request('host:command', { action: 'toggleTimer' }));
			bar.appendChild(timerBtn);
		}
		return bar;
	}

	function renderTeamScores(game) {
		if (game.mode !== 'teams') return null;
		const teamA = game.turnOrder.filter(p => p.team === 'A').map(p => p.name).join(', ') || '—';
		const teamB = game.turnOrder.filter(p => p.team === 'B').map(p => p.name).join(', ') || '—';
		return el(`
			<div class="row" style="gap:16px;margin-bottom:16px;">
				<div class="card grow center">
					<h2>Team A: ${game.teamScores.A}</h2>
					<p class="muted">${teamA}</p>
				</div>
				<div class="card grow center">
					<h2>Team B: ${game.teamScores.B}</h2>
					<p class="muted">${teamB}</p>
				</div>
			</div>
		`);
	}

	function renderTurnStrip(game) {
		const chips = game.turnOrder.map(p => `
			<div class="player-chip ${p.connected ? '' : 'offline'} ${p.id === game.currentPlayerId ? 'current-turn' : ''}">
				<span class="dot"></span>${p.name}${p.team ? ` (${p.team})` : ''}
			</div>
		`).join('');
		return el(`<div class="tv-players-grid" style="margin-top:16px;">${chips || '<p class="muted">Waiting for players…</p>'}</div>`);
	}

	function renderTV(container, state, conn) {
		registerListeners(conn);
		const game = state.game;

		container.appendChild(renderSettings(game, conn));

		const teamScores = renderTeamScores(game);
		if (teamScores) container.appendChild(teamScores);

		const stage = el(`
			<div class="center">
				<div class="buzzer-orb"></div>
				<div class="catchphrase-toast"></div>
				${game.currentPlayerId
					? `<h2 style="margin-top:16px;">🎤 ${game.currentPlayerName}'s turn</h2><p class="muted">Everyone else: shout out your guesses!</p>`
					: `<h2 style="margin-top:16px;">Waiting for players…</h2>`}
			</div>
		`);
		container.appendChild(stage);

		container.appendChild(renderTurnStrip(game));
	}

	window.GameRenderers = window.GameRenderers || {};
	window.GameRenderers.catchphrase = { renderTV };
})();
