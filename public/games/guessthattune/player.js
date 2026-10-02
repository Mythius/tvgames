(function () {
	// Other players locking in broadcasts state to everyone, so the picking
	// screen is only rebuilt when something about *this* player's round
	// changes - otherwise their half-made dropdown choices would get wiped.
	let lastContainer = null;
	let lastSignature = null;

	function el(html) {
		const div = document.createElement('div');
		div.innerHTML = html.trim();
		return div.firstElementChild;
	}

	function esc(text) {
		return String(text == null ? '' : text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
	}

	function options(choices, placeholder) {
		return `<option value="" disabled selected>${placeholder}</option>` +
			choices.map((c, i) => `<option value="${i}">${esc(c)}</option>`).join('');
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

	function renderPicking(container, state, conn) {
		const game = state.game;
		const you = state.you;
		container.appendChild(renderHeader(game, you));

		if (you.lockedIn) {
			container.appendChild(el(`
				<div class="card center" style="width:100%;">
					<h2>🔒 Locked in!</h2>
					<p style="margin:4px 0;">🎵 ${esc(you.myTitle)}</p>
					${you.myArtist ? `<p style="margin:4px 0;">🎤 ${esc(you.myArtist)}</p>` : ''}
					<p class="muted">Waiting for everyone else…</p>
				</div>
			`));
			return;
		}

		const titles = game.titleChoices || [];
		const artists = game.artistChoices;
		const card = el(`
			<form class="card stack" style="width:100%;" id="pick-form">
				<label class="muted" for="pick-title">🎵 Song title</label>
				<select class="tune-select" id="pick-title">${options(titles, 'Pick the song…')}</select>
				${artists ? `
					<label class="muted" for="pick-artist">🎤 Artist</label>
					<select class="tune-select" id="pick-artist">${options(artists, 'Pick the artist…')}</select>
				` : ''}
				<button type="submit" id="lock-in" style="width:100%;margin-top:8px;" disabled>🔒 Lock it in</button>
				<p class="muted center" style="margin:0;font-size:0.85em;">One answer per song - the faster you lock in a right title, the more it's worth.</p>
			</form>
		`);
		const titleSelect = card.querySelector('#pick-title');
		const artistSelect = card.querySelector('#pick-artist');
		const button = card.querySelector('#lock-in');
		const update = () => {
			button.disabled = !titleSelect.value || (artistSelect && !artistSelect.value);
		};
		titleSelect.addEventListener('change', update);
		if (artistSelect) artistSelect.addEventListener('change', update);
		card.addEventListener('submit', e => {
			e.preventDefault();
			if (button.disabled) return;
			button.disabled = true;
			conn.send('player:action', {
				action: 'lockIn',
				payload: {
					title: titles[Number(titleSelect.value)],
					artist: artistSelect ? artists[Number(artistSelect.value)] : null,
				},
			});
		});
		container.appendChild(card);
	}

	function renderReveal(container, state) {
		const game = state.game;
		const you = state.you;
		const a = game.answer || {};
		const mark = ok => (ok ? '✅' : '❌');
		const picks = you.lockedIn
			? `<p style="margin:12px 0 0;">${mark(you.gotTitle)} You picked: ${esc(you.myTitle)}</p>
				${you.myArtist ? `<p style="margin:4px 0 0;">${mark(you.gotArtist)} You picked: ${esc(you.myArtist)}</p>` : ''}`
			: `<p class="muted" style="margin:12px 0 0;">You didn't lock in an answer.</p>`;
		container.appendChild(renderHeader(game, you));
		container.appendChild(el(`
			<div class="card center" style="width:100%;">
				${a.thumbnail ? `<img class="tune-art small" src="${esc(a.thumbnail)}" alt="" />` : ''}
				<h2 style="margin:12px 0 4px;">${esc(a.name || '???')}</h2>
				<p class="muted" style="margin:0;">${esc(a.artist || '')}</p>
				${picks}
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
		const game = state.game;
		const you = state.you;

		if (game.phase === 'playing') {
			const sig = JSON.stringify([game.phase, game.round, you.lockedIn]);
			if (container === lastContainer && sig === lastSignature) return;
			lastContainer = container;
			lastSignature = sig;
			container.innerHTML = '';
			renderPicking(container, state, conn);
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
