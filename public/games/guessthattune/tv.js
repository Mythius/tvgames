(function () {
	// The TV is the only screen that talks to Spotify (through Music from
	// /js/music.js). The server moves the game into a phase and the TV does
	// the matching work exactly once, reporting back with a 'tvReport'
	// host command. `handledKey` remembers which piece of work already ran,
	// since renderTV is called again on every state broadcast.
	let handledKey = null;
	let startedTrackId = null;
	let timerInterval = null;
	let listenersRegistered = false;
	const RADIUS = 54;
	const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

	function el(html) {
		const div = document.createElement('div');
		div.innerHTML = html.trim();
		return div.firstElementChild;
	}

	function esc(text) {
		return String(text == null ? '' : text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
	}

	function report(conn, type, data = {}) {
		return conn.request('host:command', { action: 'tvReport', payload: { type, ...data } });
	}

	function stopTimerLoop() {
		if (timerInterval) clearInterval(timerInterval);
		timerInterval = null;
	}

	function pauseMusic() {
		try {
			if (window.Music && Music.currentSong) Music.currentSong.pause();
		} catch (e) {
			/* nothing playing */
		}
	}

	// Stop the music when the host ends the game or switches away from it.
	function registerListeners(conn) {
		if (listenersRegistered) return;
		listenersRegistered = true;
		conn.on('state:update', state => {
			if (!state.game || state.game.gameId !== 'guessthattune') {
				pauseMusic();
				handledKey = null;
				stopTimerLoop();
			}
		});
	}

	// --- Spotify side effects ---------------------------------------------

	async function fetchPlaylist(conn, playlistId) {
		try {
			await Music.loadPlayList(playlistId);
			await report(conn, 'tracks', { tracks: Music.playListData });
		} catch (e) {
			await report(conn, 'fetchFailed', { error: e && e.message });
		}
	}

	async function loadTrack(conn, trackId) {
		try {
			const song = await Music.loadSong(trackId);
			song.addListener('playback_update', e => {
				const d = e && e.data;
				if (!d || d.isPaused || d.isBuffering || !(d.position > 0)) return;
				if (startedTrackId === trackId) return;
				startedTrackId = trackId;
				report(conn, 'clipStarted', { trackId });
			});
			song.addListener('ready', () => song.play());
			await report(conn, 'trackReady', { trackId });
			song.play();
		} catch (e) {
			console.warn('Guess That Tune: could not load track', trackId, e);
			await report(conn, 'trackFailed', { trackId });
		}
	}

	function runSideEffects(game, conn) {
		if (game.phase === 'setup' || game.phase === 'final') {
			if (handledKey) pauseMusic();
			handledKey = null;
			return;
		}
		if (game.phase === 'fetching') {
			const key = `fetch:${game.activePlaylistId}`;
			if (handledKey === key) return;
			handledKey = key;
			pauseMusic();
			fetchPlaylist(conn, game.activePlaylistId);
		} else if (game.phase === 'loading') {
			const key = `load:${game.round}:${game.currentTrackId}`;
			if (handledKey === key) return;
			handledKey = key;
			loadTrack(conn, game.currentTrackId);
		}
	}

	// --- rendering ---------------------------------------------------------

	function renderHeader(game) {
		return el(`
			<div class="center" style="margin-bottom:12px;">
				<span class="badge">Song ${game.round} of ${game.roundsThisMatch}</span>
			</div>
		`);
	}

	function renderSetup(container, game, conn) {
		const playlistButtons = game.playlists.map(p => `
			<button class="${p.id === game.presetId ? '' : 'secondary'} small" data-preset="${esc(p.id)}">${esc(p.name)}</button>
		`).join('');
		const roundButtons = game.roundOptions.map(n => `
			<button class="${n === game.totalRounds ? '' : 'secondary'} small" data-rounds="${n}">${n} songs</button>
		`).join('');

		const panel = el(`
			<div class="stack center" style="width:100%;gap:20px;">
				<h1>🎵 Guess That Tune</h1>
				<p class="muted">A song plays on the TV - pick the title and artist on your phone. Faster = more points.</p>
				${game.error ? `<div class="error-banner">${esc(game.error)}</div>` : ''}
				<div class="stack center" style="width:100%;">
					<h3>Pick a genre</h3>
					<div class="row" style="justify-content:center;flex-wrap:wrap;gap:8px;">${playlistButtons}</div>
				</div>
				<div class="stack" style="width:100%;max-width:520px;">
					<p class="muted" style="margin:0;">…or paste any Spotify playlist link:</p>
					<form class="row" id="custom-form">
						<input type="text" id="custom-playlist" placeholder="https://open.spotify.com/playlist/…" autocomplete="off" />
						<button class="secondary small" type="submit">Use</button>
					</form>
					${game.customPlaylistId ? `<p class="muted" style="margin:0;">Using custom playlist <strong>${esc(game.customPlaylistId)}</strong></p>` : ''}
				</div>
				<div class="row" style="justify-content:center;flex-wrap:wrap;gap:8px;">${roundButtons}</div>
				<button class="accent2" id="begin" ${game.activePlaylistId ? '' : 'disabled'} style="font-size:1.2em;">▶ Start Music</button>
			</div>
		`);
		panel.querySelectorAll('[data-preset]').forEach(btn => {
			btn.addEventListener('click', () => conn.request('host:command', { action: 'selectPreset', payload: { presetId: btn.dataset.preset } }));
		});
		panel.querySelectorAll('[data-rounds]').forEach(btn => {
			btn.addEventListener('click', () => conn.request('host:command', { action: 'setRounds', payload: { rounds: Number(btn.dataset.rounds) } }));
		});
		panel.querySelector('#custom-form').addEventListener('submit', e => {
			e.preventDefault();
			const playlist = panel.querySelector('#custom-playlist').value;
			conn.request('host:command', { action: 'setCustomPlaylist', payload: { playlist } });
		});
		panel.querySelector('#begin').addEventListener('click', () => conn.request('host:command', { action: 'beginMatch' }));
		container.appendChild(panel);
	}

	function renderFetching(container) {
		container.appendChild(el(`
			<div class="center" style="margin-top:40px;">
				<div class="tune-vinyl"></div>
				<h2 style="margin-top:24px;">Loading playlist…</h2>
			</div>
		`));
	}

	function renderLoading(container, game, conn) {
		container.appendChild(renderHeader(game));
		const stage = el(`
			<div class="center" style="margin-top:24px;">
				<div class="tune-vinyl"></div>
				<h2 style="margin-top:24px;">${game.phase === 'loading' ? 'Cueing up the next song…' : 'Get ready…'}</h2>
				<button class="secondary" id="force-play" style="margin-top:12px;visibility:hidden;">▶ Music not playing? Tap here</button>
				<button class="secondary small" id="skip" style="margin-top:12px;">⏭ Skip this song</button>
			</div>
		`);
		// Browsers can block autoplay until someone interacts with the page,
		// so offer a manual play button if the song hasn't started on its own.
		const forcePlay = stage.querySelector('#force-play');
		if (game.phase === 'buffering') setTimeout(() => (forcePlay.style.visibility = 'visible'), 4000);
		forcePlay.addEventListener('click', () => Music.currentSong && Music.currentSong.play());
		stage.querySelector('#skip').addEventListener('click', () => conn.request('host:command', { action: 'skipSong' }));
		container.appendChild(stage);
	}

	function renderProgress(game) {
		const chips = game.progress.map(p => `
			<div class="player-chip ${p.connected ? '' : 'offline'} ${p.locked ? 'tune-locked' : ''}">
				<span class="dot"></span>${esc(p.name)}
				<span class="tune-marks">${p.locked ? '🔒' : '🤔'}</span>
			</div>
		`).join('');
		return el(`<div class="tv-players-grid" style="margin-top:20px;">${chips || '<p class="muted">Waiting for players…</p>'}</div>`);
	}

	function renderPlaying(container, game, conn) {
		container.appendChild(renderHeader(game));
		const stage = el(`
			<div class="center">
				<div class="row" style="gap:40px;justify-content:center;">
					<div class="tune-vinyl spinning"></div>
					<div class="tune-ring-wrap">
						<svg width="120" height="120" viewBox="0 0 120 120">
							<circle cx="60" cy="60" r="${RADIUS}" stroke-width="12" fill="none" class="ring-bg" />
							<circle cx="60" cy="60" r="${RADIUS}" stroke-width="12" fill="none" class="ring-fg"
								stroke-dasharray="${CIRCUMFERENCE}" stroke-dashoffset="0"
								transform="rotate(-90 60 60)" />
						</svg>
						<div class="tune-ring-seconds">--</div>
					</div>
				</div>
				<h2 style="margin-top:20px;">${game.artistChoices ? "What's this song? 🎵 Title + 🎤 Artist" : "What's this song called? 🎵"}</h2>
				<p class="muted" style="margin:0;">Pick on your phone and lock it in.</p>
				<div class="row" style="gap:12px;margin-top:8px;">
					<button class="secondary small" id="replay">⏮ Replay</button>
					<button class="secondary small" id="reveal">👀 Reveal now</button>
				</div>
			</div>
		`);
		stage.querySelector('#replay').addEventListener('click', () => Music.currentSong && Music.currentSong.restart());
		stage.querySelector('#reveal').addEventListener('click', () => conn.request('host:command', { action: 'revealNow' }));
		container.appendChild(stage);
		container.appendChild(renderProgress(game));

		const ring = stage.querySelector('.ring-fg');
		const secondsEl = stage.querySelector('.tune-ring-seconds');
		const tick = () => {
			const remaining = Math.max(0, game.phaseEndsAt - Date.now());
			ring.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - remaining / game.clipMs));
			secondsEl.textContent = Math.ceil(remaining / 1000);
			if (remaining <= 0) stopTimerLoop();
		};
		tick();
		timerInterval = setInterval(tick, 200);
	}

	function renderLeaderboard(game) {
		const rows = [...game.progress]
			.sort((a, b) => b.score - a.score)
			.map(p => `<div class="scoreboard-row"><span>${esc(p.name)}</span><span>${p.score}</span></div>`)
			.join('');
		return el(`<div class="stack" style="width:100%;max-width:520px;margin:20px auto 0;">${rows}</div>`);
	}

	function renderReveal(container, game, conn) {
		container.appendChild(renderHeader(game));
		const a = game.answer || {};
		const solvers = game.progress
			.filter(p => p.points > 0)
			.sort((x, y) => y.points - x.points)
			.map(p => `<div class="player-chip tune-solved"><span class="dot"></span>${esc(p.name)} <span class="tune-marks">${p.title ? '🎵' : ''}${p.artist ? '🎤' : ''}</span> +${p.points}</div>`)
			.join('');
		const isLast = game.round >= game.roundsThisMatch;
		const stage = el(`
			<div class="center">
				<div class="row" style="gap:28px;justify-content:center;flex-wrap:wrap;">
					${a.thumbnail ? `<img class="tune-art" src="${esc(a.thumbnail)}" alt="" />` : '<div class="tune-vinyl"></div>'}
					<div class="stack" style="text-align:left;">
						<p class="muted" style="margin:0;">It was…</p>
						<h1 style="font-size:2.6rem;margin:0;">${esc(a.name || '???')}</h1>
						<h2 class="muted" style="margin:0;">${esc(a.artist || '')}</h2>
					</div>
				</div>
				<div class="tv-players-grid" style="margin-top:20px;">${solvers || '<p class="muted">Nobody got it this time!</p>'}</div>
				<button id="next" style="margin-top:20px;">${isLast ? '🏆 Final Scores' : '▶ Next Song'}</button>
			</div>
		`);
		stage.querySelector('#next').addEventListener('click', () => conn.request('host:command', { action: 'nextSong' }));
		container.appendChild(stage);
		container.appendChild(renderLeaderboard(game));
	}

	function renderFinal(container, game, conn) {
		const winner = [...game.progress].sort((a, b) => b.score - a.score)[0];
		const stage = el(`
			<div class="center">
				<h1>🏆 ${winner ? `${esc(winner.name)} wins!` : 'Game over!'}</h1>
				<button id="again" style="margin-top:12px;">🔁 Play Again</button>
			</div>
		`);
		stage.querySelector('#again').addEventListener('click', () => conn.request('host:command', { action: 'backToSetup' }));
		container.appendChild(stage);
		container.appendChild(renderLeaderboard(game));
	}

	function renderTV(container, state, conn) {
		registerListeners(conn);
		stopTimerLoop();
		const game = state.game;
		runSideEffects(game, conn);

		if (game.phase === 'setup') renderSetup(container, game, conn);
		else if (game.phase === 'fetching') renderFetching(container);
		else if (game.phase === 'loading' || game.phase === 'buffering') renderLoading(container, game, conn);
		else if (game.phase === 'playing') renderPlaying(container, game, conn);
		else if (game.phase === 'reveal') renderReveal(container, game, conn);
		else if (game.phase === 'final') renderFinal(container, game, conn);
	}

	window.GameRenderers = window.GameRenderers || {};
	window.GameRenderers.guessthattune = { renderTV };
})();
