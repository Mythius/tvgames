const Game = require('../../core/Game');
const shuffle = require('../../core/shuffle');
const PLAYLISTS = require('./playlists');
const { displayTitle, normalize } = require('./titles');

// How long players get to answer once the song actually starts playing.
// Overridable via env var so this is testable without waiting it out.
const CLIP_MS = Number(process.env.TUNE_CLIP_MS) || 30 * 1000;
const ROUND_OPTIONS = [5, 10, 15, 20];
const CHOICES_PER_DROPDOWN = 8; // the right answer + up to 7 others from the playlist
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

// The right answer plus other distinct entries from the playlist, in
// alphabetical order so the answer's position gives nothing away.
function buildChoices(answer, pool) {
	const seen = new Set([normalize(answer)]);
	const others = [];
	for (const candidate of shuffle(pool)) {
		const key = normalize(candidate);
		if (!candidate || seen.has(key)) continue;
		seen.add(key);
		others.push(candidate);
		if (others.length >= CHOICES_PER_DROPDOWN - 1) break;
	}
	return [answer, ...others].sort((a, b) => a.localeCompare(b));
}

/**
 * Guess That Tune: the TV plays a song through the Spotify embed (see
 * public/js/music.js) and everyone picks the title and artist from two
 * dropdowns on their phone, filled with other songs from the same playlist.
 * Each player locks in one answer per song. A right title scores more the
 * faster it was locked in; the right artist is a flat bonus. Points are only
 * added at the reveal so nobody can tell early whether they were right.
 *
 * Spotify is only reachable from the browser, so the TV does the fetching
 * and playback and reports back here: the server moves into a phase
 * ('fetching', 'loading'), the TV sees it and does the work, then answers
 * with a tvReport action ('tracks', 'trackReady', 'clipStarted', or a
 * failure). The server owns the answers, timer and scoring from there.
 */
class GuessThatTuneGame extends Game {
	static id = 'guessthattune';
	static title = 'Guess That Tune';
	static description = 'A song plays on the TV - pick the title and artist on your phone. Faster answers score more.';
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

		this.library = new Map(); // trackId -> { name, artist, thumbnail } for the whole playlist
		this.trackQueue = [];
		this.round = 0;
		this.roundsThisMatch = 0;
		this.loadFailures = 0;
		this.currentTrackId = null;
		this.track = null; // the current answer
		this.titleChoices = [];
		this.artistChoices = null; // null when the playlist only has one artist
		this.answers = {}; // playerId -> { title, artist, lockedAt }
		this.results = {}; // playerId -> { title, artist, points } (filled in at reveal)
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

	onTracks({ tracks }) {
		if (this.phase !== 'fetching') return;
		this.library = new Map();
		for (const t of Array.isArray(tracks) ? tracks : []) {
			if (!t || typeof t.id !== 'string' || !t.id || !t.name || this.library.has(t.id)) continue;
			this.library.set(t.id, {
				name: displayTitle(String(t.name).slice(0, 200)),
				artist: String(t.artist || 'Unknown artist').slice(0, 200),
				thumbnail: typeof t.thumbnail === 'string' ? t.thumbnail : null,
			});
		}
		if (this.library.size < 2) return this.backToSetup('That playlist needs at least 2 playable songs.');
		this.trackQueue = shuffle([...this.library.keys()]);
		this.roundsThisMatch = Math.min(this.totalRounds, this.library.size);
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
		this.track = this.library.get(this.currentTrackId);
		this.answers = {};
		this.results = {};
		this.clipStartedAt = null;
		this.phaseEndsAt = null;

		const others = [...this.library.values()].filter(t => t !== this.track);
		this.titleChoices = buildChoices(this.track.name, others.map(t => t.name));
		const artistChoices = buildChoices(this.track.artist, others.map(t => t.artist));
		this.artistChoices = artistChoices.length > 1 ? artistChoices : null;
		this.lobby.broadcastState();
	}

	onTrackReady({ trackId }) {
		if (this.phase !== 'loading' || trackId !== this.currentTrackId) return;
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
		this.scoreRound();
		this.phase = 'reveal';
		this.phaseEndsAt = null;
		this.lobby.broadcastState();
	}

	scoreRound() {
		this.results = {};
		for (const [playerId, answer] of Object.entries(this.answers)) {
			const player = this.lobby.players.get(playerId);
			if (!player) continue;
			const title = answer.title === this.track.name;
			const artist = Boolean(this.artistChoices) && answer.artist === this.track.artist;
			let points = 0;
			if (title) {
				const remainingFrac = Math.max(0, Math.min(1, (this.phaseEndsAt - answer.lockedAt) / CLIP_MS));
				points += TITLE_BASE_POINTS + Math.round(TITLE_SPEED_POINTS * remainingFrac);
			}
			if (artist) points += ARTIST_POINTS;
			player.score += points;
			this.results[playerId] = { title, artist, points };
		}
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
		if (action === 'lockIn') this.lockIn(player, payload || {});
	}

	lockIn(player, { title, artist }) {
		if (this.phase !== 'playing' || this.answers[player.id]) return;
		if (!this.titleChoices.includes(title)) return;
		if (this.artistChoices && !this.artistChoices.includes(artist)) return;
		this.answers[player.id] = { title, artist: this.artistChoices ? artist : null, lockedAt: Date.now() };
		if (this.everyoneLockedIn()) this.reveal();
		else this.lobby.broadcastState();
	}

	everyoneLockedIn() {
		const connected = [...this.lobby.players.values()].filter(p => p.connected);
		return connected.length > 0 && connected.every(p => this.answers[p.id]);
	}

	// --- roster changes ------------------------------------------------------

	handlePlayerJoin() {
		this.lobby.broadcastState();
	}

	handlePlayerLeave(player) {
		delete this.answers[player.id];
		if (this.phase === 'playing' && this.everyoneLockedIn()) this.reveal();
		else this.lobby.broadcastState();
	}

	// --- state serialization -------------------------------------------------

	getPublicState() {
		const revealed = this.phase === 'reveal';
		const asking = ['loading', 'buffering', 'playing'].includes(this.phase);
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
			titleChoices: asking ? this.titleChoices : null,
			artistChoices: asking ? this.artistChoices : null,
			answer: revealed && this.track ? { ...this.track } : null,
			progress: players.map(p => {
				const r = (revealed && this.results[p.id]) || {};
				return {
					id: p.id,
					name: p.name,
					connected: p.connected,
					score: p.score,
					locked: Boolean(this.answers[p.id]),
					title: Boolean(r.title),
					artist: Boolean(r.artist),
					points: r.points || 0,
				};
			}),
		};
	}

	getPlayerState(player) {
		const answer = this.answers[player.id] || null;
		const r = (this.phase === 'reveal' && this.results[player.id]) || {};
		return {
			lockedIn: Boolean(answer),
			myTitle: answer ? answer.title : null,
			myArtist: answer ? answer.artist : null,
			gotTitle: Boolean(r.title),
			gotArtist: Boolean(r.artist),
			roundPoints: r.points || 0,
		};
	}
}

module.exports = GuessThatTuneGame;
