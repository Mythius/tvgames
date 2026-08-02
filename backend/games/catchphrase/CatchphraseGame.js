const Game = require('../../core/Game');
const shuffle = require('../../core/shuffle');
const WORDS = require('./words');

const MIN_ROUND_MS = 25 * 1000;
const MAX_ROUND_MS = 75 * 1000;
const PULSE_MIN_MS = 120;
const PULSE_MAX_EXTRA_MS = 900;

/**
 * Pass-and-play word guessing game. One player at a time is "it" and sees a
 * secret word - everyone else has to guess it out loud in the room. A hidden,
 * randomized timer accelerates a pulse/beep until it buzzes; whoever is
 * holding the word when that happens loses the point to the other team (in
 * Teams mode). Settings (mode, timer) can be changed by the host at any
 * point, and players can join or leave mid-game - Teams mode simply
 * reshuffles into two fresh teams whenever the roster changes.
 */
class CatchphraseGame extends Game {
	static id = 'catchphrase';
	static title = 'Catch Phrase';
	static description = 'Describe the secret word before the buzzer goes off. Play solo pass-around or team vs. team.';
	static minPlayers = 2;
	static maxPlayers = 16;
	static allowLateJoin = true;

	constructor(lobby) {
		super(lobby);
		this.mode = 'free'; // 'free' | 'teams'
		this.freeTimerEnabled = true;
		this.teamOf = {}; // playerId -> 'A' | 'B' (teams mode only)
		this.teamScores = { A: 0, B: 0 };
		this.turnOrder = [];
		this.turnIndex = 0;
		this.wordQueue = [];
		this.currentWord = null;

		this.roundActive = false;
		this.awaitingStart = false; // timer is armed but paused until the current player taps "Start"
		this.roundStart = null;
		this.roundDuration = null;
		this.pulseTimeout = null;
		this.buzzTimeout = null;
	}

	start() {
		this.turnOrder = shuffle([...this.lobby.players.keys()]);
		this.turnIndex = 0;
		this.currentWord = this.drawWord();
		this.syncTimer();
		this.lobby.broadcastState();
	}

	destroy() {
		this.stopTimer();
	}

	// --- word queue -----------------------------------------------------

	drawWord() {
		if (!this.wordQueue.length) this.wordQueue = shuffle(WORDS.map((_, i) => i));
		return WORDS[this.wordQueue.pop()];
	}

	// --- turn order -------------------------------------------------------

	currentPlayerId() {
		if (!this.turnOrder.length) return null;
		return this.turnOrder[this.turnIndex % this.turnOrder.length];
	}

	advanceTurn() {
		if (this.turnOrder.length) this.turnIndex = (this.turnIndex + 1) % this.turnOrder.length;
		this.currentWord = this.drawWord();
	}

	// --- host settings ------------------------------------------------------

	handleHostAction(action, payload) {
		if (action === 'setMode') this.setMode(payload && payload.mode);
		else if (action === 'toggleTimer') this.setFreeTimerEnabled(!this.freeTimerEnabled);
	}

	setMode(mode) {
		if ((mode !== 'teams' && mode !== 'free') || mode === this.mode) return;
		this.mode = mode;
		if (mode === 'teams') this.redistributeTeams();
		this.syncTimer();
		this.lobby.broadcastState();
	}

	setFreeTimerEnabled(enabled) {
		this.freeTimerEnabled = Boolean(enabled);
		this.syncTimer();
		this.lobby.broadcastState();
	}

	redistributeTeams() {
		const ids = shuffle([...this.lobby.players.keys()]);
		this.stopTimer();
		this.turnOrder = ids;
		this.turnIndex = 0;
		this.teamOf = {};
		ids.forEach((id, i) => {
			this.teamOf[id] = i % 2 === 0 ? 'A' : 'B';
		});
		this.teamScores = { A: 0, B: 0 };
		this.currentWord = ids.length ? this.drawWord() : null;
	}

	// --- timer / buzzer ------------------------------------------------------

	timerShouldRun() {
		return this.turnOrder.length > 0 && (this.mode === 'teams' || (this.mode === 'free' && this.freeTimerEnabled));
	}

	// A round is never auto-started - it's only armed. The current player
	// decides when the room is ready and taps Start themselves, so there's
	// no secret clock already running while everyone's still talking/celebrating.
	syncTimer() {
		const should = this.timerShouldRun();
		if (!should) {
			this.stopTimer();
			this.awaitingStart = false;
			return;
		}
		if (!this.roundActive) this.awaitingStart = true;
	}

	handleStartTimer(player) {
		if (player.id !== this.currentPlayerId()) return;
		if (!this.awaitingStart || this.roundActive) return;
		this.startRoundTimer();
		this.lobby.broadcastState();
	}

	startRoundTimer() {
		this.stopTimer();
		this.awaitingStart = false;
		this.roundActive = true;
		this.roundStart = Date.now();
		this.roundDuration = MIN_ROUND_MS + Math.random() * (MAX_ROUND_MS - MIN_ROUND_MS);
		this.buzzTimeout = setTimeout(() => this.onBuzz(), this.roundDuration);
		this.schedulePulse();
	}

	stopTimer() {
		if (this.pulseTimeout) clearTimeout(this.pulseTimeout);
		if (this.buzzTimeout) clearTimeout(this.buzzTimeout);
		this.pulseTimeout = null;
		this.buzzTimeout = null;
		this.roundActive = false;
	}

	schedulePulse() {
		const elapsed = Date.now() - this.roundStart;
		const remainingFrac = Math.max(0, 1 - elapsed / this.roundDuration);
		const interval = PULSE_MIN_MS + remainingFrac * remainingFrac * PULSE_MAX_EXTRA_MS;
		this.pulseTimeout = setTimeout(() => {
			if (!this.roundActive) return;
			this.lobby.broadcastTV('catchphrase:pulse', {});
			this.lobby.broadcastPlayers('catchphrase:pulse', {});
			this.schedulePulse();
		}, interval);
	}

	onBuzz() {
		this.stopTimer();
		const holderId = this.currentPlayerId();
		const holder = holderId ? this.lobby.players.get(holderId) : null;
		let winningTeam = null;
		if (this.mode === 'teams' && holderId) {
			const losingTeam = this.teamOf[holderId];
			winningTeam = losingTeam === 'A' ? 'B' : 'A';
			this.teamScores[winningTeam] += 1;
		}
		const event = { type: 'buzz', holderName: holder ? holder.name : null, winningTeam };
		this.lobby.broadcastTV('catchphrase:event', event);
		this.lobby.broadcastPlayers('catchphrase:event', event);

		this.advanceTurn();
		this.syncTimer();
		this.lobby.broadcastState();
	}

	// --- player actions ------------------------------------------------------

	handlePlayerAction(player, action) {
		if (action === 'startTimer') return this.handleStartTimer(player);
		if (action !== 'gotIt') return;
		if (player.id !== this.currentPlayerId()) return;

		player.score += 1;
		let team = null;
		if (this.mode === 'teams') {
			team = this.teamOf[player.id];
			this.teamScores[team] += 1;
		}
		const event = { type: 'gotIt', playerName: player.name, team };
		this.lobby.broadcastTV('catchphrase:event', event);
		this.lobby.broadcastPlayers('catchphrase:event', event);

		// The buzzer timer is NOT reset here - it keeps ticking toward its
		// secret target across turns, exactly like the physical device.
		this.advanceTurn();
		this.lobby.broadcastState();
	}

	// --- roster changes ------------------------------------------------------

	handlePlayerJoin(player) {
		const wasEmpty = this.turnOrder.length === 0;
		this.turnOrder.push(player.id);
		if (this.mode === 'teams') {
			this.redistributeTeams();
		} else if (wasEmpty) {
			this.turnIndex = 0;
			this.currentWord = this.drawWord();
		}
		this.syncTimer();
		this.lobby.broadcastState();
	}

	handlePlayerLeave(player) {
		const idx = this.turnOrder.indexOf(player.id);
		if (idx === -1) return;
		const wasCurrent = idx === this.turnIndex % this.turnOrder.length;
		this.turnOrder.splice(idx, 1);
		delete this.teamOf[player.id];

		if (this.turnOrder.length === 0) {
			this.turnIndex = 0;
			this.currentWord = null;
			this.stopTimer();
			this.awaitingStart = false;
			this.lobby.broadcastState();
			return;
		}

		if (this.mode === 'teams') {
			this.redistributeTeams();
		} else {
			if (idx < this.turnIndex) this.turnIndex -= 1;
			this.turnIndex = this.turnIndex % this.turnOrder.length;
			if (wasCurrent) this.currentWord = this.drawWord();
		}
		this.syncTimer();
		this.lobby.broadcastState();
	}

	// --- state serialization -------------------------------------------------

	getPublicState() {
		const currentId = this.currentPlayerId();
		const currentPlayer = currentId ? this.lobby.players.get(currentId) : null;
		const turnOrder = this.turnOrder
			.map(id => {
				const p = this.lobby.players.get(id);
				return p ? { id, name: p.name, connected: p.connected, team: this.mode === 'teams' ? this.teamOf[id] : null } : null;
			})
			.filter(Boolean);

		return {
			gameId: CatchphraseGame.id,
			mode: this.mode,
			freeTimerEnabled: this.freeTimerEnabled,
			timerRunning: this.roundActive,
			awaitingStart: this.awaitingStart,
			teamScores: this.mode === 'teams' ? this.teamScores : null,
			turnOrder,
			currentPlayerId: currentId,
			currentPlayerName: currentPlayer ? currentPlayer.name : null,
			currentTeam: this.mode === 'teams' && currentId ? this.teamOf[currentId] : null,
		};
	}

	getPlayerState(player) {
		const isCurrentPlayer = this.currentPlayerId() === player.id;
		return {
			isCurrentPlayer,
			word: isCurrentPlayer ? this.currentWord : null,
			team: this.mode === 'teams' ? this.teamOf[player.id] || null : null,
			canStartTimer: isCurrentPlayer && this.awaitingStart && !this.roundActive,
		};
	}
}

module.exports = CatchphraseGame;
