(function () {
	let listenersRegistered = false;

	function el(html) {
		const div = document.createElement('div');
		div.innerHTML = html.trim();
		return div.firstElementChild;
	}

	function flashIndicator(className, ms) {
		const indicator = document.querySelector('.phone-pulse-indicator');
		if (!indicator) return;
		indicator.classList.add(className);
		setTimeout(() => indicator.classList.remove(className), ms);
	}

	function registerListeners(conn) {
		if (listenersRegistered) return;
		listenersRegistered = true;
		conn.on('catchphrase:pulse', () => {
			flashIndicator('pulse', 150);
			if (navigator.vibrate) navigator.vibrate(20);
		});
		conn.on('catchphrase:event', payload => {
			if (payload.type === 'buzz') {
				flashIndicator('buzz', 500);
				if (navigator.vibrate) navigator.vibrate([80, 60, 80]);
			}
		});
	}

	function renderPlayer(container, state, conn) {
		registerListeners(conn);
		container.innerHTML = '';
		const game = state.game;
		const you = state.you;

		const header = el(`
			<div class="center" style="width:100%">
				<div class="phone-pulse-indicator"></div>
				${game.mode === 'teams' && you.team ? `<span class="badge">Team ${you.team} — ${game.teamScores[you.team]} pts</span>` : ''}
			</div>
		`);
		container.appendChild(header);

		if (!game.currentPlayerId) {
			container.appendChild(el(`<div class="center"><h2>Waiting for players…</h2></div>`));
			return;
		}

		if (you.isCurrentPlayer) {
			const card = el(`
				<div class="card center" style="margin-top:16px;">
					<p class="muted">Describe this without saying it!</p>
					<h1 style="font-size:2.2rem;">${you.word}</h1>
					${you.canStartTimer ? `<p class="muted">Take your time - start the timer whenever the room's ready.</p>` : ''}
					${you.canStartTimer ? `<button class="accent2" id="start-timer" style="margin-top:8px;width:100%;font-size:1.1em;">▶ Start Timer</button>` : ''}
					<button id="got-it" style="margin-top:12px;width:100%;font-size:1.3em;">✅ Got it!</button>
				</div>
			`);
			const startBtn = card.querySelector('#start-timer');
			if (startBtn) {
				startBtn.addEventListener('click', () => {
					conn.send('player:action', { action: 'startTimer' });
					startBtn.disabled = true;
				});
			}
			card.querySelector('#got-it').addEventListener('click', () => {
				conn.send('player:action', { action: 'gotIt' });
			});
			container.appendChild(card);
		} else {
			container.appendChild(el(`
				<div class="center" style="margin-top:24px;">
					<h2>🎤 ${game.currentPlayerName}'s turn</h2>
					<p class="muted">Shout out your guesses!</p>
				</div>
			`));
		}
	}

	window.GameRenderers = window.GameRenderers || {};
	window.GameRenderers.catchphrase = window.GameRenderers.catchphrase || {};
	window.GameRenderers.catchphrase.renderPlayer = renderPlayer;
})();
