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

	function renderWriting(container, game) {
		container.appendChild(el(`<h2 class="center">✍️ Everyone's writing their answers…</h2>`));
		mountCountdown(container, game.phaseEndsAt);
		const rows = (game.writingStatus || []).map(p => `
			<div class="player-chip"><span class="dot" style="background:${p.submittedCount === p.totalCount ? 'var(--good)' : 'var(--warn)'}"></span>
				${p.name} — ${p.submittedCount}/${p.totalCount}
			</div>
		`).join('');
		container.appendChild(el(`<div class="tv-players-grid" style="margin-top:20px;">${rows}</div>`));
	}

	function renderJudging(container, game, conn) {
		const m = game.currentMatchup;
		container.appendChild(el(`<p class="center muted">Matchup ${game.currentMatchupIndex + 1} of ${game.totalMatchups}</p>`));
		container.appendChild(el(`<h2 class="center">${m.promptText}</h2>`));
		if (!m.revealed) mountCountdown(container, game.phaseEndsAt);

		const answers = el(`<div class="row" style="margin-top:24px; align-items:stretch;"></div>`);
		m.answers.forEach(a => {
			answers.appendChild(el(`
				<div class="matchup-answer">
					${m.revealed ? `<span class="votes">${a.votes} ★</span>` : ''}
					<div>${a.text}</div>
					${m.revealed ? `<div class="author">— ${a.authorName}</div>` : ''}
				</div>
			`));
		});
		container.appendChild(answers);

		if (!m.revealed) {
			container.appendChild(el(`<p class="center muted" style="margin-top:16px;">${m.votedCount}/${m.eligibleVoterCount} voted</p>`));
		} else {
			const nextBtn = el(`<button style="margin-top:20px;width:100%;">Next ▶</button>`);
			nextBtn.addEventListener('click', () => conn.request('host:command', { action: 'advance' }));
			container.appendChild(nextBtn);
		}
	}

	function renderScoreboard(container, game, conn) {
		const isGameOver = game.phase === 'gameOver';
		container.appendChild(el(`<h2 class="center">${isGameOver ? '🏆 Final Results' : `Round ${game.round} results`}</h2>`));
		const rows = game.scoreboard.map(s => `
			<div class="scoreboard-row"><span>${s.name}</span><span>${s.score}</span></div>
		`).join('');
		container.appendChild(el(`<div class="stack" style="margin-top:16px;">${rows}</div>`));

		if (!isGameOver) {
			const nextBtn = el(`<button style="margin-top:24px;width:100%;">Next Round ▶</button>`);
			nextBtn.addEventListener('click', () => conn.request('host:command', { action: 'advance' }));
			container.appendChild(nextBtn);
		} else {
			const again = el(`<button class="accent2" style="margin-top:24px;width:100%;">Back to Lobby</button>`);
			again.addEventListener('click', () => conn.request('host:endGame'));
			container.appendChild(again);
		}
	}

	function renderTV(container, state, conn) {
		const game = state.game;
		if (game.phase === 'writing') renderWriting(container, game);
		else if (game.phase === 'judging') renderJudging(container, game, conn);
		else if (game.phase === 'roundResults' || game.phase === 'gameOver') renderScoreboard(container, game, conn);
	}

	window.GameRenderers = window.GameRenderers || {};
	window.GameRenderers.promptclash = { renderTV };
})();
