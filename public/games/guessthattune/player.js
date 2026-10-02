(function () {
	// Other players' correct guesses broadcast state to everyone, so the
	// guessing screen is only rebuilt when something about *this* player's
	// round changes - otherwise whatever they're typing would get wiped.
	let lastContainer = null;
	let lastSignature = null;
	let listenersRegistered = false;
	let currentRound = null;
	let lastFeedback = null; // survives the re-render a correct guess triggers

	function el(html) {
		const div = document.createElement('div');
		div.innerHTML = html.trim();
		return div.firstElementChild;
	}

	function esc(text) {
		return String(text == null ? '' : text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
	}

	function showFeedback(text, kind) {
		lastFeedback = { round: currentRound, text, kind };
		const box = document.querySelector('.tune-feedback');
		if (!box) return;
		box.textContent = text;
		box.className = `tune-feedback ${kind}`;
	}

	function registerListeners(conn) {
		if (listenersRegistered) return;
		listenersRegistered = true;
		conn.on('tune:guessResult', result => {
			if (result.miss) {
				showFeedback(`❌ "${result.guess}" - nope, keep trying!`, 'miss');
				if (navigator.vibrate) navigator.vibrate(60);
				return;
			}
			const parts = [];
			if (result.newTitle) parts.push('the title');
			if (result.newArtist) parts.push('the artist');
			showFeedback(`✅ You got ${parts.join(' and ')}!`, 'hit');
			if (navigator.vibrate) navigator.vibrate([40, 40, 40]);
		});
	}

	function renderHeader(game, you) {
		return el(`
			<div class="center" style="width:100%;margin-bottom:12px;">
				<span class="badge">${game.round ? `Song ${game.round} of ${game.roundsThisMatch} · ` : ''}${you.score} pts</span>
			</div>
		`);
	}

	function renderWaiting(container, state, title, subtitle) {
		container.appendChild(renderHeader(state.game, state.you));
		container.appendChild(el(`
			<div class="center" style="margin-top:24px;">
				<div class="tune-vinyl small"></div>
				<h2 style="margin-top:16px;">${title}</h2>
				<p class="muted">${subtitle}</p>
			</div>
		`));
	}

	function renderPlaying(container, state, conn) {
		const you = state.you;
		container.appendChild(renderHeader(state.game, you));
		const done = you.gotTitle && you.gotArtist;
		const card = el(`
			<div class="card stack" style="width:100%;">
				<div class="row" style="justify-content:center;gap:10px;">
					<span class="tune-status ${you.gotTitle ? 'done' : ''}">🎵 Title ${you.gotTitle ? '✓' : '?'}</span>
					<span class="tune-status ${you.gotArtist ? 'done' : ''}">🎤 Artist ${you.gotArtist ? '✓' : '?'}</span>
				</div>
				${done
					? `<h2 class="center">🎉 Nailed it! +${you.roundPoints}</h2><p class="muted center">Waiting for everyone else…</p>`
					: `<form class="stack" id="guess-form">
						<input type="text" id="guess" maxlength="120" autocomplete="off" autocapitalize="off" placeholder="${you.gotTitle ? 'Who sings it?' : you.gotArtist ? "What's the song called?" : 'Song title or artist…'}" />
						<button type="submit" style="width:100%;">Guess</button>
					</form>
					<p class="muted" style="margin:0;font-size:0.85em;">Guess as many times as you like. You can type both, e.g. "Song by Artist".</p>`}
				<div class="tune-feedback"></div>
			</div>
		`);
		const form = card.querySelector('#guess-form');
		if (form) {
			const input = form.querySelector('#guess');
			form.addEventListener('submit', e => {
				e.preventDefault();
				const text = input.value.trim();
				if (!text) return;
				conn.send('player:action', { action: 'guess', payload: { text } });
				input.value = '';
				input.focus();
			});
			setTimeout(() => input.focus(), 0);
		}
		container.appendChild(card);
		if (lastFeedback && lastFeedback.round === state.game.round) showFeedback(lastFeedback.text, lastFeedback.kind);
	}

	function renderReveal(container, state) {
		const game = state.game;
		const you = state.you;
		const a = game.answer || {};
		container.appendChild(renderHeader(game, you));
		container.appendChild(el(`
			<div class="card center" style="width:100%;">
				${a.thumbnail ? `<img class="tune-art small" src="${esc(a.thumbnail)}" alt="" />` : ''}
				<h2 style="margin:12px 0 4px;">${esc(a.name || '???')}</h2>
				<p class="muted" style="margin:0;">${esc(a.artist || '')}</p>
				<h3 style="margin-top:16px;">${you.roundPoints ? `+${you.roundPoints} points` : 'No points this time'}</h3>
			</div>
		`));
	}

	function renderFinal(container, state) {
		const sorted = [...state.game.progress].sort((a, b) => b.score - a.score);
		const place = sorted.findIndex(p => p.id === state.you.id) + 1;
		container.appendChild(el(`
			<div class="center" style="margin-top:24px;">
				<h1>${place === 1 ? '🏆 You win!' : `#${place || '-'}`}</h1>
				<p class="muted">${state.you.score} points</p>
			</div>
		`));
	}

	function renderPlayer(container, state, conn) {
		registerListeners(conn);
		const game = state.game;
		const you = state.you;
		currentRound = game.round;

		if (game.phase === 'playing') {
			const sig = JSON.stringify([game.phase, game.round, you.gotTitle, you.gotArtist]);
			if (container === lastContainer && sig === lastSignature) return;
			lastContainer = container;
			lastSignature = sig;
			container.innerHTML = '';
			renderPlaying(container, state, conn);
			return;
		}

		lastSignature = null;
		container.innerHTML = '';
		if (game.phase === 'setup') renderWaiting(container, state, '🎵 Guess That Tune', 'Waiting for the host to pick the music…');
		else if (game.phase === 'fetching') renderWaiting(container, state, 'Loading songs…', 'Get your thumbs ready!');
		else if (game.phase === 'loading' || game.phase === 'buffering') renderWaiting(container, state, 'Get ready…', 'Listen to the TV - the next song is about to play.');
		else if (game.phase === 'reveal') renderReveal(container, state);
		else if (game.phase === 'final') renderFinal(container, state);
	}

	window.GameRenderers = window.GameRenderers || {};
	window.GameRenderers.guessthattune = window.GameRenderers.guessthattune || {};
	window.GameRenderers.guessthattune.renderPlayer = renderPlayer;
})();
