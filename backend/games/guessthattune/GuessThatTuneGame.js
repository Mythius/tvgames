const Game = require('../../core/Game');
const shuffle = require('../../core/shuffle');
const PLAYLISTS = require('./playlists');
const { checkGuess } = require('./matching');

// How long players get to guess once the song actually starts playing.
// Overridable via env var so this is testable without waiting it out.
const CLIP_MS = Number(process.env.TUNE_CLIP_MS) || 30 * 1000;
const ROUND_OPTIONS = [5, 10, 15, 20];
const TITLE_BASE_POINTS = 500;
const TITLE_SPEED_POINTS = 500; // extra, scaled by how much time was left
const ARTIST_POINTS = 250;
const MAX_LOAD_FAILURES = 5;

function availablePlaylists() {
	return PLAYLISTS.filter(p => p.playlistId);
}

// Accepts a bare ID, a spotify:playlist: URI or an open.spotify.com link.
function parsePlaylistId(input) {
	const text = String(input || '').trim();
	const match = text.match(/playlist[/:]([A-Za-z0-9]+)/) || text.match(/^([A-Za-z0-9]{10,})$/);
	return match ? match[1] : null;
}

/**
 * Guess That Tune: the TV plays a song through the Spotify embed (see
 * public/js/music.js) and everyone races to type the title and artist on
 * their phone. Faster correct titles earn more points; naming the artist is
 * a flat bonus.
 *
 * Spotify is only reachable from the browser, so the TV does the fetching
 * and playback and reports back here: the server moves into a phase
 * ('fetching', 'loading'), the TV sees it and does the work, then answers
 * with a tvReport action ('tracks', 'trackReady', 'clipStarted', or a
 * failure). The server owns the answer, timer and scoring from there.
 */
class GuessThatTuneGame extends Game {
	static id = 'guessthattune';
	static title = 'Guess That Tune';
	static description = 'A song plays on the TV - race to type the title and artist on your phone. Faster answers score more.';
	static minPlayers = 1;
	static maxPlayers = 16;
	static allowLateJoin = true;

	constructor(lobby) {
		super(lobby);
		this.phase = 'setup'; // 'setup' | 'fetching' | 'loading' | 'buffering' | 'playing' | 'reveal' | 'final'
		const first = availablePlaylists()[0];
		this.presetId = first ? first.id : null;
		this.customPlaylistId = null;
		this.totalRounds = 10;
		this.error = null;

		this.trackQueue = [];
		this.round = 0;
		this.roundsThisMatch = 0;
		this.loadFailures = 0;
		this.currentTrackId = null;
		this.track = null; // { name, artists, artistLabel, thumbnail } - the answer
		this.results = {}; // playerId -> { title, artist, points, titleRank }
		this.titleSolvers = 0;
		this.clipStartedAt = null;
		this.phaseEndsAt = null;
		this.timer = null;
	}

	start() {
		this.lobby.broadcastState();
	}

	destroy() {
		this.clearTimer();
	}

	clearTimer() {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}

	activePlaylistId() {
		if (this.customPlaylistId) return this.customPlaylistId;
		const preset = availablePlaylists().find(p => p.id === this.presetId);
		return preset ? preset.playlistId : null;
	}

	// --- host controls ------------------------------------------------------

	handleHostAction(action, payload = {}) {
		if (action === 'selectPreset') this.selectPreset(payload.presetId);
		else if (action === 'setCustomPlaylist') this.setCustomPlaylist(payload.playlist);
		else if (action === 'setRounds') this.setRounds(payload.rounds);
		else if (action === 'beginMatch') this.beginMatch();
		else if (action === 'tvReport') this.handleTvReport(payload);
		else if (action === 'revealNow') this.reveal();
		else if (action === 'skipSong') this.skipSong();
		else if (action === 'nextSong') this.nextSong();
		else if (action === 'backToSetup') this.backToSetup();
	}

	selectPreset(presetId) {
		if (this.phase !== 'setup') return;
		if (!availablePlaylists().some(p => p.id === presetId)) return;
		this.presetId = presetId;
		this.customPlaylistId = null;
		this.error = null;
		this.lobby.broadcastState();
	}

	setCustomPlaylist(input) {
		if (this.phase !== 'setup') return;
		const id = parsePlaylistId(input);
		if (!id) {
			this.error = "That doesn't look like a Spotify playlist link or ID.";
		} else {
			this.customPlaylistId = id;
			this.error = null;
		}
		this.lobby.broadcastState();
	}

	setRounds(rounds) {
		if (this.phase !== 'setup' || !ROUND_OPTIONS.includes(rounds)) return;
		this.totalRounds = rounds;
		this.lobby.broadcastState();
	}

	beginMatch() {
		if (this.phase !== 'setup' || !this.activePlaylistId()) return;
		this.phase = 'fetching';
		this.error = null;
		this.lobby.broadcastState();
	}

	backToSetup(error = null) {
		this.clearTimer();
		this.phase = 'setup';
		this.error = error;
		this.round = 0;
		this.currentTrackId = null;
		this.track = null;
		this.phaseEndsAt = null;
		this.lobby.broadcastState();
	}

	// --- reports from the TV's Spotify player -------------------------------

	handleTvReport({ type, ...data }) {
		if (type === 'tracks') this.onTracks(data);
		else if (type === 'fetchFailed') this.onFetchFailed(data);
		else if (type === 'trackReady') this.onTrackReady(data);
		else if (type === 'trackFailed') this.onTrackFailed(data);
		else if (type === 'clipStarted') this.onClipStarted(data);
	}

	onTracks({ trackIds }) {
		if (this.phase !== 'fetching') return;
		const ids = [...new Set((Array.isArray(trackIds) ? trackIds : []).filter(id => typeof id === 'string' && id))];
		if (!ids.length) return this.backToSetup('That playlist has no playable songs.');
		this.trackQueue = shuffle(ids);
		this.roundsThisMatch = Math.min(this.totalRounds, ids.length);
		this.round = 0;
		this.loadFailures = 0;
		for (const player of this.lobby.players.values()) player.score = 0;
		this.loadNextTrack();
	}

	onFetchFailed({ error }) {
		if (this.phase !== 'fetching') return;
		this.backToSetup(`Couldn't load that playlist${error ? `: ${String(error).slice(0, 120)}` : '.'}`);
	}

	loadNextTrack() {
		this.clearTimer();
		if (this.round >= this.roundsThisMatch || !this.trackQueue.length) return this.finish();
		this.round += 1;
		this.phase = 'loading';
		this.currentTrackId = this.trackQueue.pop();
		this.track = null;
		this.results = {};
		this.titleSolvers = 0;
		this.clipStartedAt = null;
		this.phaseEndsAt = null;
		this.lobby.broadcastState();
	}

	onTrackReady({ trackId, name, artist, thumbnail }) {
		if (this.phase !== 'loading' || trackId !== this.currentTrackId || !name) return;
		const artistLabel = String(artist || '').slice(0, 200);
		this.track = {
			name: String(name).slice(0, 200),
			artistLabel,
			// Check the full credit plus each individual artist.
			artists: [artistLabel, ...artistLabel.split(', ')],
			thumbnail: typeof thumbnail === 'string' ? thumbnail : null,
		};
		this.loadFailures = 0;
		this.phase = 'buffering';
		this.lobby.broadcastState();
	}

	onTrackFailed({ trackId }) {
		if (this.phase !== 'loading' || trackId !== this.currentTrackId) return;
		this.loadFailures += 1;
		this.round -= 1; // a song that never played doesn't use up a round
		if (this.loadFailures >= MAX_LOAD_FAILURES) {
			return this.backToSetup("Spotify kept failing to load songs. Check the playlist and the TV's connection.");
		}
		this.loadNextTrack();
	}

	onClipStarted({ trackId }) {
		if (this.phase !== 'buffering' || trackId !== this.currentTrackId) return;
		this.phase = 'playing';
		this.clipStartedAt = Date.now();
		this.phaseEndsAt = this.clipStartedAt + CLIP_MS;
		this.clearTimer();
		this.timer = setTimeout(() => this.reveal(), CLIP_MS);
		this.lobby.broadcastState();
	}

	// --- round flow ---------------------------------------------------------

	reveal() {
		if (this.phase !== 'playing' && this.phase !== 'buffering') return;
		this.clearTimer();
		this.phase = 'reveal';
		this.phaseEndsAt = null;
		this.lobby.broadcastState();
	}

	skipSong() {
		if (this.phase === 'playing' || this.phase === 'buffering') return this.reveal();
		if (this.phase === 'loading') {
			this.round -= 1;
			this.loadNextTrack();
		}
	}

	nextSong() {
		if (this.phase !== 'reveal') return;
		this.loadNextTrack();
	}

	finish() {
		this.clearTimer();
		this.phase = 'final';
		this.currentTrackId = null;
		this.phaseEndsAt = null;
		this.lobby.broadcastState();
	}

	// --- player actions ------------------------------------------------------

	handlePlayerAction(player, action, payload) {
		if (action === 'guess') this.handleGuess(player, (payload && payload.text) || '');
	}

	handleGuess(player, text) {
		if (this.phase !== 'playing' || !this.track) return;
		const guess = String(text).slice(0, 120);
		if (!guess.trim()) return;
		const result = this.results[player.id] || (this.results[player.id] = { title: false, artist: false, points: 0, titleRank: null });
		const hit = checkGuess(guess, this.track);
		const newTitle = hit.title && !result.title;
		const newArtist = hit.artist && !result.artist;

		if (newTitle) {
			const remainingFrac = Math.max(0, (this.phaseEndsAt - Date.now()) / CLIP_MS);
			const points = TITLE_BASE_POINTS + Math.round(TITLE_SPEED_POINTS * remainingFrac);
			result.title = true;
			result.points += points;
			player.score += points;
			this.titleSolvers += 1;
			result.titleRank = this.titleSolvers;
		}
		if (newArtist) {
			result.artist = true;
			result.points += ARTIST_POINTS;
			player.score += ARTIST_POINTS;
		}

		// Misses only go back to the guesser - no need to redraw every screen.
		this.lobby.sendToPlayer(player.id, 'tune:guessResult', {
			guess,
			newTitle,
			newArtist,
			miss: !newTitle && !newArtist,
		});
		if (newTitle || newArtist) {
			if (this.everyoneSolved()) this.reveal();
			else this.lobby.broadcastState();
		}
	}

	everyoneSolved() {
		const connected = [...this.lobby.players.values()].filter(p => p.connected);
		return connected.length > 0 && connected.every(p => this.results[p.id] && this.results[p.id].title && this.results[p.id].artist);
	}

	// --- roster changes ------------------------------------------------------

	handlePlayerJoin() {
		this.lobby.broadcastState();
	}

	handlePlayerLeave(player) {
		delete this.results[player.id];
		if (this.phase === 'playing' && this.everyoneSolved()) this.reveal();
		else this.lobby.broadcastState();
	}

	// --- state serialization -------------------------------------------------

	getPublicState() {
		const showAnswer = this.phase === 'reveal';
		const players = [...this.lobby.players.values()];
		return {
			gameId: GuessThatTuneGame.id,
			phase: this.phase,
			error: this.error,
			playlists: availablePlaylists().map(p => ({ id: p.id, name: p.name })),
			presetId: this.customPlaylistId ? null : this.presetId,
			customPlaylistId: this.customPlaylistId,
			activePlaylistId: this.activePlaylistId(),
			roundOptions: ROUND_OPTIONS,
			totalRounds: this.totalRounds,
			round: this.round,
			roundsThisMatch: this.roundsThisMatch,
			currentTrackId: this.currentTrackId,
			clipMs: CLIP_MS,
			phaseEndsAt: this.phaseEndsAt,
			answer: showAnswer && this.track
				? { name: this.track.name, artist: this.track.artistLabel, thumbnail: this.track.thumbnail }
				: null,
			progress: players.map(p => {
				const r = this.results[p.id] || {};
				return { id: p.id, name: p.name, connected: p.connected, score: p.score, title: Boolean(r.title), artist: Boolean(r.artist), points: r.points || 0, titleRank: r.titleRank || null };
			}),
		};
	}

	getPlayerState(player) {
		const r = this.results[player.id] || {};
		return {
			gotTitle: Boolean(r.title),
			gotArtist: Boolean(r.artist),
			roundPoints: r.points || 0,
		};
	}
}

module.exports = GuessThatTuneGame;
