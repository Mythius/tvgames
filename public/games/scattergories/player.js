(function () {
	// Only the 'writing' phase has live text inputs at risk of losing focus.
	// Unrelated broadcasts (someone else joining/leaving) shouldn't rebuild
	// the screen mid-keystroke, so we skip re-rendering it unless the round
	// itself actually changed. Reveal/setup have no inputs to protect and can
	// always redraw freely (e.g. to show live "X/Y scored" progress).
	let lastContainer = null;
	let lastWritingSignature = null;

	function el(html) {
		const div = document.createElement('div');
		div.innerHTML = html.trim();
		return div.firstElementChild;
	}

	function renderLetterHeader(game) {
		return el(`
			<div class="center" style="width:100%;margin-bottom:12px;">
				<span class="badge">Round ${game.round}</span>
				<div class="scatter-letter small">${game.currentLetter || '?'}</div>
			</div>
		`);
	}

	function renderSetup(container, state) {
		container.appendChild(renderLetterHeader(state.game));
		container.appendChild(el(`
			<div class="center">
				<h2>Get ready…</h2>
				<p class="muted">Waiting for the host to accept the letter and start the round.</p>
			</div>
		`));
	}

	function renderWriting(container, state, conn) {
		const game = state.game;
		container.appendChild(renderLetterHeader(game));

		const list = el(`<div class="stack" style="width:100%"></div>`);
		game.currentCategories.forEach((category, i) => {
			const existing = (state.you.myAnswers && state.you.myAnswers[i]) || '';
			const row = el(`
				<div class="card" style="padding:12px 16px;">
					<p class="muted" style="margin:0 0 6px;">${i + 1}. ${category}</p>
					<input type="text" maxlength="60" autocomplete="off" placeholder="Starts with ${game.currentLetter}…" />
				</div>
			`);
			const input = row.querySelector('input');
			input.value = existing;
			let debounceTimer = null;
			input.addEventListener('input', () => {
				if (debounceTimer) clearTimeout(debounceTimer);
				const text = input.value;
				debounceTimer = setTimeout(() => {
					conn.send('player:action', { action: 'updateAnswer', payload: { categoryIndex: i, text } });
				}, 400);
			});
			list.appendChild(row);
		});
		container.appendChild(list);
	}

	function renderReveal(container, state, conn) {
		const game = state.game;
		container.appendChild(renderLetterHeader(game));

		if (state.you.hasSubmittedScore) {
			container.appendChild(el(`
				<div class="center">
					<h2>✅ Score submitted!</h2>
					<p class="muted">Waiting for everyone else… (${game.scoresSubmittedCount}/${game.totalPlayers})</p>
				</div>
			`));
		} else {
			const myAnswers = state.you.myAnswers || {};
			const rows = game.currentCategories.map((c, i) => `
				<div class="row" style="justify-content:space-between;">
					<span class="muted">${c}</span><span>${myAnswers[i] || '—'}</span>
				</div>
			`).join('');
			const card = el(`
				<div class="card stack" style="width:100%;">
					<p class="muted">Discuss your answers out loud, then score yourself for this round:</p>
					${rows}
					<input type="text" inputmode="numeric" id="score-input" placeholder="Your total points" style="margin-top:8px;" />
					<button id="submit-score" style="width:100%;">Submit Score</button>
				</div>
			`);
			card.querySelector('#submit-score').addEventListener('click', () => {
				const score = Number(card.querySelector('#score-input').value) || 0;
				conn.send('player:action', { action: 'submitScore', payload: { score } });
			});
			container.appendChild(card);
		}
	}

	function renderPlayer(container, state, conn) {
		const game = state.game;

		if (game.phase === 'writing') {
			const sig = JSON.stringify({ phase: game.phase, round: game.round, letter: game.currentLetter });
			if (container === lastContainer && sig === lastWritingSignature) return;
			lastContainer = container;
			lastWritingSignature = sig;
			container.innerHTML = '';
			renderWriting(container, state, conn);
			return;
		}

		lastWritingSignature = null;
		container.innerHTML = '';
		if (game.phase === 'setup') renderSetup(container, state);
		else if (game.phase === 'reveal') renderReveal(container, state, conn);
	}

	window.GameRenderers = window.GameRenderers || {};
	window.GameRenderers.scattergories = window.GameRenderers.scattergories || {};
	window.GameRenderers.scattergories.renderPlayer = renderPlayer;
})();
