(function () {
	let countdownInterval = null;

	function el(html) {
		const div = document.createElement('div');
		div.innerHTML = html.trim();
		return div.firstElementChild;
	}

	function mountCountdown(container, phaseEndsAt) {
		if (countdownInterval) clearInterval(countdownInterval);
		if (!phaseEndsAt) return;
		const bar = el(`<div class="timer-bar"><div style="width:100%"></div></div>`);
		container.appendChild(bar);
		const inner = bar.firstElementChild;
		const start = Date.now();
		const total = phaseEndsAt - start;
		countdownInterval = setInterval(() => {
			const remaining = phaseEndsAt - Date.now();
			const pct = Math.max(0, Math.min(100, (remaining / total) * 100));
			inner.style.width = pct + '%';
			if (remaining <= 0) clearInterval(countdownInterval);
		}, 200);
	}

	function renderWriting(container, state, conn) {
		mountCountdown(container, state.game.phaseEndsAt);
		const prompts = state.you.prompts || [];
		prompts.forEach(p => {
			const card = el(`
				<div class="card stack" style="margin-top:12px;">
					<p class="muted">Your prompt</p>
					<h3>${p.promptText}</h3>
					${p.submitted
						? `<p class="muted">✅ Submitted — waiting for others…</p>`
						: `<form class="stack" data-matchup="${p.matchupIndex}">
							<input type="text" maxlength="100" placeholder="Type something funny…" autocomplete="off" required />
							<button type="submit">Submit</button>
						</form>`
					}
				</div>
			`);
			const form = card.querySelector('form');
			if (form) {
				form.addEventListener('submit', e => {
					e.preventDefault();
					const input = form.querySelector('input');
					conn.send('player:action', {
						action: 'submitAnswer',
						payload: { matchupIndex: p.matchupIndex, text: input.value },
					});
					input.disabled = true;
					form.querySelector('button').disabled = true;
				});
			}
			container.appendChild(card);
		});
	}

	function renderJudging(container, state, conn) {
		const you = state.you;
		if (you.isAuthor) {
			container.appendChild(el(`<div class="center"><h2>😏 One of your answers is on!</h2><p class="muted">Watch the TV to see how it does.</p></div>`));
			return;
		}
		if (you.hasVoted) {
			container.appendChild(el(`<div class="center"><h2>✅ Vote in!</h2><p class="muted">Waiting for everyone else…</p></div>`));
			return;
		}
		container.appendChild(el(`<h2 class="center">👀 Look at the TV, then vote for the funniest answer</h2>`));
		mountCountdown(container, state.game.phaseEndsAt);
		const row = el(`<div class="row" style="margin-top:20px;"></div>`);
		['A', 'B'].forEach((label, choice) => {
			const btn = el(`<button class="grow" style="font-size:2rem;padding:30px;">${label}</button>`);
			btn.addEventListener('click', () => {
				conn.send('player:action', { action: 'vote', payload: { choice } });
				row.querySelectorAll('button').forEach(b => (b.disabled = true));
			});
			row.appendChild(btn);
		});
		container.appendChild(row);
	}

	function renderScoreboard(container, state) {
		const isGameOver = state.game.phase === 'gameOver';
		const mine = state.game.scoreboard.findIndex(s => s.playerId === state.you.id);
		container.appendChild(el(`
			<div class="center">
				<h2>${isGameOver ? '🏆 Game over!' : `Round ${state.game.round} complete`}</h2>
				<p class="muted">You're in ${mine === -1 ? '—' : `${mine + 1}${['st', 'nd', 'rd'][mine] || 'th'}`} place with ${state.you.score} points</p>
				<p class="muted">Check the TV for the full scoreboard.</p>
			</div>
		`));
	}

	// The container persists across state:update broadcasts (see play.js), so
	// this only needs to touch the DOM when something relevant to THIS player
	// actually changed. Otherwise every other player's submission/vote would
	// blow away an in-progress <input>, killing its focus, typed text, and
	// (on mobile) the on-screen keyboard.
	let lastContainer = null;
	let lastSignature = null;

	function renderPlayer(container, state, conn) {
		const game = state.game;
		const signature = JSON.stringify({ phase: game.phase, round: game.round, you: state.you });
		if (container === lastContainer && signature === lastSignature) return;
		lastContainer = container;
		lastSignature = signature;

		container.innerHTML = '';
		if (game.phase === 'writing') renderWriting(container, state, conn);
		else if (game.phase === 'judging') renderJudging(container, state, conn);
		else if (game.phase === 'roundResults' || game.phase === 'gameOver') renderScoreboard(container, state);
	}

	window.GameRenderers = window.GameRenderers || {};
	window.GameRenderers.promptclash = window.GameRenderers.promptclash || {};
	window.GameRenderers.promptclash.renderPlayer = renderPlayer;
})();
