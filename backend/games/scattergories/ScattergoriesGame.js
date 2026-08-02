const Game = require('../../core/Game');
const shuffle = require('../../core/shuffle');
const DECKS = require('./decks');

// 3 minutes to fill in every category. Overridable via env var so this is
// testable without actually waiting 3 real minutes for the timer to expire.
const ROUND_MS = Number(process.env.SCATTERGORIES_ROUND_MS) || 180 * 1000;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function getDeck(id) {
	return DECKS.find(d => d.id === id) || DECKS[0];
}

/**
 * Scattergories: a secret letter + a card list of categories are rolled and
 * shown to everyone (TV and every phone) before anything starts. The host
 * can reroll the letter as many times as they like, and only once they hit
 * Accept does the round timer actually begin. Matching the letter is left up
 * to the group's honor system - nothing here validates answers. When time's
 * up, everyone's answers are revealed together so the group can debate out
 * loud, then each player manually enters their own score for the round.
 */
class ScattergoriesGame extends Game {
	static id = 'scattergories';
	static title = 'Scattergories';
	static description = 'Fill every category with a word starting with the secret letter before time runs out - then debate and self-score as a group.';
	static minPlayers = 1;
	static maxPlayers = 16;
	static allowLateJoin = true;

	constructor(lobby) {
		super(lobby);
		this.round = 0;
		this.phase = 'setup'; // 'setup' | 'writing' | 'reveal'
		this.deckId = DECKS[0].id;
		this.currentLetter = null;
		this.currentCategories = [];
		this.answers = {}; // playerId -> { [categoryIndex]: text }
		this.roundScoreSubmitted = {}; // playerId -> bool
		this.phaseEndsAt = null;
		this.timer = null;
	}

	start() {
		this.round = 1;
		this.rollLetter();
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

	rollLetter() {
		const deck = getDeck(this.deckId);
		this.currentLetter = LETTERS[Math.floor(Math.random() * LETTERS.length)];
		this.currentCategories = shuffle(deck.categories);
	}

	// --- host controls ------------------------------------------------------

	handleHostAction(action, payload) {
		if (action === 'selectDeck') this.selectDeck(payload && payload.deckId);
		else if (action === 'rerollLetter') this.rerollLetter();
		else if (action === 'acceptAndStart') this.acceptAndStart();
		else if (action === 'nextRound') this.startNextRound();
	}

	selectDeck(deckId) {
		if (this.phase !== 'setup') return;
		if (!getDeck(deckId)) return;
		this.deckId = deckId;
		this.rollLetter();
		this.lobby.broadcastState();
	}

	rerollLetter() {
		if (this.phase !== 'setup') return;
		this.rollLetter();
		this.lobby.broadcastState();
	}

	acceptAndStart() {
		if (this.phase !== 'setup') return;
		this.phase = 'writing';
		this.answers = {};
		this.phaseEndsAt = Date.now() + ROUND_MS;
		this.clearTimer();
		this.timer = setTimeout(() => this.finishWriting(), ROUND_MS);
		this.lobby.broadcastState();
	}

	startNextRound() {
		if (this.phase !== 'reveal') return;
		this.round += 1;
		this.phase = 'setup';
		this.phaseEndsAt = null;
		this.roundScoreSubmitted = {};
		this.rollLetter();
		this.lobby.broadcastState();
	}

	finishWriting() {
		if (this.phase !== 'writing') return;
		this.clearTimer();
		this.phase = 'reveal';
		this.phaseEndsAt = null;
		this.roundScoreSubmitted = {};
		this.lobby.broadcastState();
	}

	// --- player actions ------------------------------------------------------

	handlePlayerAction(player, action, payload) {
		if (action === 'updateAnswer') this.updateAnswer(player, payload || {});
		else if (action === 'submitScore') this.submitScore(player, payload || {});
	}

	updateAnswer(player, { categoryIndex, text }) {
		if (this.phase !== 'writing') return;
		if (!Number.isInteger(categoryIndex) || categoryIndex < 0 || categoryIndex >= this.currentCategories.length) return;
		if (!this.answers[player.id]) this.answers[player.id] = {};
		this.answers[player.id][categoryIndex] = String(text || '').slice(0, 60);
		// No broadcast here on purpose - this is private, in-progress input.
		// Nobody else needs to see it live, and re-rendering everyone's screen
		// on every keystroke would blow away whatever they're typing too.
	}

	submitScore(player, { score }) {
		if (this.phase !== 'reveal') return;
		const clamped = Math.max(0, Math.min(200, Math.round(Number(score) || 0)));
		player.score += clamped;
		this.roundScoreSubmitted[player.id] = true;
		this.lobby.broadcastState();
	}

	// --- roster changes ------------------------------------------------------

	handlePlayerJoin(player) {
		this.lobby.broadcastState();
	}

	handlePlayerLeave(player) {
		delete this.answers[player.id];
		delete this.roundScoreSubmitted[player.id];
		this.lobby.broadcastState();
	}

	// --- state serialization -------------------------------------------------

	getPublicState() {
		const players = [...this.lobby.players.values()];
		const state = {
			gameId: ScattergoriesGame.id,
			phase: this.phase,
			round: this.round,
			deckId: this.deckId,
			deckList: DECKS.map(d => ({ id: d.id, name: d.name, categoryCount: d.categories.length })),
			currentLetter: this.currentLetter,
			currentCategories: this.currentCategories,
			roundDurationMs: ROUND_MS,
			phaseEndsAt: this.phaseEndsAt,
		};

		if (this.phase === 'reveal') {
			state.reveal = {
				rows: this.currentCategories.map((category, i) => ({
					category,
					entries: players.map(p => ({
						playerId: p.id,
						name: p.name,
						text: (this.answers[p.id] && this.answers[p.id][i]) || '',
					})),
				})),
			};
			state.scoresSubmittedCount = players.filter(p => this.roundScoreSubmitted[p.id]).length;
			state.totalPlayers = players.length;
		}

		return state;
	}

	getPlayerState(player) {
		return {
			myAnswers: this.answers[player.id] || {},
			hasSubmittedScore: Boolean(this.roundScoreSubmitted[player.id]),
		};
	}
}

module.exports = ScattergoriesGame;
