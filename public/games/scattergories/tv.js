(function () {
	let timerInterval = null;
	const RADIUS = 54;
	const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

	function el(html) {
		const div = document.createElement('div');
		div.innerHTML = html.trim();
		return div.firstElementChild;
	}

	function stopTimerLoop() {
		if (timerInterval) clearInterval(timerInterval);
		timerInterval = null;
	}

	function renderLetterAndCategories(game) {
		const cats = game.currentCategories.map((c, i) => `<li><span class="cat-num">${i + 1}</span>${c}</li>`).join('');
		return el(`
			<div class="row" style="align-items:flex-start;gap:24px;flex-wrap:wrap;justify-content:center;">
				<div class="scatter-letter">${game.currentLetter || '?'}</div>
				<ol class="scatter-categories">${cats}</ol>
			</div>
		`);
	}

	function renderSetup(container, game, conn) {
		const deckButtons = game.deckList.map(d => `
			<button class="${d.id === game.deckId ? '' : 'secondary'} small" data-deck="${d.id}">${d.name}</button>
		`).join('');
		const bar = el(`<div class="row" style="justify-content:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;">${deckButtons}</div>`);
		bar.querySelectorAll('[data-deck]').forEach(btn => {
			btn.addEventListener('click', () => conn.request('host:command', { action: 'selectDeck', payload: { deckId: btn.dataset.deck } }));
		});
		container.appendChild(bar);

		container.appendChild(renderLetterAndCategories(game));

		const actions = el(`
			<div class="row" style="justify-content:center;gap:12px;margin-top:20px;">
				<button class="secondary" id="reroll">🎲 Reroll Letter</button>
				<button class="accent2" id="accept">✅ Accept &amp; Start</button>
			</div>
		`);
		actions.querySelector('#reroll').addEventListener('click', () => conn.request('host:command', { action: 'rerollLetter' }));
		actions.querySelector('#accept').addEventListener('click', () => conn.request('host:command', { action: 'acceptAndStart' }));
		container.appendChild(actions);
	}

	function renderWriting(container, game) {
		container.appendChild(renderLetterAndCategories(game));

		const timerWrap = el(`
			<div class="center" style="margin-top:24px;">
				<div class="scatter-ring-wrap">
					<svg width="120" height="120" viewBox="0 0 120 120">
						<circle cx="60" cy="60" r="${RADIUS}" stroke-width="12" fill="none" class="ring-bg" />
						<circle cx="60" cy="60" r="${RADIUS}" stroke-width="12" fill="none" class="ring-fg"
							stroke-dasharray="${CIRCUMFERENCE}" stroke-dashoffset="0"
							transform="rotate(-90 60 60)" />
					</svg>
					<div class="scatter-ring-seconds">--</div>
				</div>
				<p class="muted">Write an answer for every category starting with ${game.currentLetter}!</p>
			</div>
		`);
		container.appendChild(timerWrap);

		stopTimerLoop();
		const ring = timerWrap.querySelector('.ring-fg');
		const secondsEl = timerWrap.querySelector('.scatter-ring-seconds');
		const total = game.roundDurationMs;
		const endsAt = game.phaseEndsAt;
		const tick = () => {
			const remaining = Math.max(0, endsAt - Date.now());
			const frac = total ? remaining / total : 0;
			ring.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - frac));
			secondsEl.textContent = Math.ceil(remaining / 1000);
			if (remaining <= 0) stopTimerLoop();
		};
		tick();
		timerInterval = setInterval(tick, 200);
	}

	function renderReveal(container, game, conn) {
		container.appendChild(renderLetterAndCategories(game));

		const table = el(`<div class="scatter-reveal-wrap"><table class="scatter-reveal-table"></table></div>`);
		const t = table.querySelector('table');
		if (game.reveal.rows.length && game.reveal.rows[0].entries.length) {
			const headRow = el(`<tr><th>Category</th>${game.reveal.rows[0].entries.map(e => `<th>${e.name}</th>`).join('')}</tr>`);
			t.appendChild(headRow);
		}
		game.reveal.rows.forEach(row => {
			const tr = el(`<tr><td>${row.category}</td>${row.entries.map(e => `<td>${e.text || '<span class="muted">—</span>'}</td>`).join('')}</tr>`);
			t.appendChild(tr);
		});
		container.appendChild(table);

		const footer = el(`
			<div class="center" style="margin-top:16px;">
				<p class="muted">Debate it out, then everyone scores themselves on their phone. (${game.scoresSubmittedCount}/${game.totalPlayers} submitted)</p>
				<button id="next-round" style="margin-top:8px;">▶ Next Round</button>
			</div>
		`);
		footer.querySelector('#next-round').addEventListener('click', () => conn.request('host:command', { action: 'nextRound' }));
		container.appendChild(footer);
	}

	function renderTV(container, state, conn) {
		stopTimerLoop();
		const game = state.game;
		if (game.phase === 'setup') renderSetup(container, game, conn);
		else if (game.phase === 'writing') renderWriting(container, game);
		else if (game.phase === 'reveal') renderReveal(container, game, conn);
	}

	window.GameRenderers = window.GameRenderers || {};
	window.GameRenderers.scattergories = { renderTV };
})();
