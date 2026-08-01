const Game = require('../../core/Game');
const PROMPTS = require('./prompts');

const WRITING_MS = 75 * 1000;
const JUDGING_MS = 20 * 1000;
const REVEAL_AUTO_ADVANCE_MS = 15 * 1000;
const ROUND_RESULTS_AUTO_ADVANCE_MS = 20 * 1000;
const TOTAL_ROUNDS = 3;
const NO_ANSWER_TEXT = '🤷 (no answer)';

function shuffle(array) {
	const copy = [...array];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy;
}

class PromptClashGame extends Game {
	static id = 'promptclash';
	static title = 'Prompt Clash';
	static description = 'Everyone writes funny answers to secret prompts, then votes for the best one.';
	static minPlayers = 3;
	static maxPlayers = 12;

	constructor(lobby) {
		super(lobby);
		this.round = 0;
		this.phase = 'writing';
		this.phaseEndsAt = null;
		this.matchups = [];
		this.currentMatchupIndex = 0;
		this.usedPromptIndices = new Set();
		this.timer = null;
	}

	start() {
		this.startRound();
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

	pickPrompts(count) {
		if (this.usedPromptIndices.size + count > PROMPTS.length) {
			this.usedPromptIndices.clear();
		}
		const available = PROMPTS.map((_, i) => i).filter(i => !this.usedPromptIndices.has(i));
		const chosen = shuffle(available).slice(0, count);
		chosen.forEach(i => this.usedPromptIndices.add(i));
		return chosen.map(i => PROMPTS[i]);
	}

	// --- round setup ------------------------------------------------------

	startRound() {
		const roster = [...this.lobby.players.values()];
		const n = roster.length;
		const promptTexts = this.pickPrompts(n);

		this.matchups = promptTexts.map((promptText, i) => ({
			promptText,
			entries: [
				{ playerId: roster[i].id, answer: null },
				{ playerId: roster[(i + 1) % n].id, answer: null },
			],
			votes: {},
			revealed: false,
			displayOrder: Math.random() < 0.5 ? [0, 1] : [1, 0],
		}));

		this.round += 1;
		this.phase = 'writing';
		this.currentMatchupIndex = 0;
		this.phaseEndsAt = Date.now() + WRITING_MS;
		this.clearTimer();
		this.timer = setTimeout(() => this.finishWriting(), WRITING_MS);
		this.lobby.broadcastState();
	}

	// map a playerId to the (up to 2) prompts assigned to them this round
	promptsForPlayer(playerId) {
		const result = [];
		this.matchups.forEach((matchup, matchupIndex) => {
			matchup.entries.forEach((entry, role) => {
				if (entry.playerId === playerId) {
					result.push({
						matchupIndex,
						role,
						promptText: matchup.promptText,
						submitted: entry.answer !== null,
					});
				}
			});
		});
		return result;
	}

	allAnswersIn() {
		return this.matchups.every(m => m.entries.every(e => e.answer !== null));
	}

	// --- writing phase ------------------------------------------------------

	handleSubmitAnswer(player, { matchupIndex, text }) {
		if (this.phase !== 'writing') return;
		const matchup = this.matchups[matchupIndex];
		if (!matchup) return;
		const entry = matchup.entries.find(e => e.playerId === player.id);
		if (!entry || entry.answer !== null) return;
		entry.answer = String(text || '').trim().slice(0, 100) || NO_ANSWER_TEXT;
		if (this.allAnswersIn()) {
			this.finishWriting();
		} else {
			this.lobby.broadcastState();
		}
	}

	finishWriting() {
		if (this.phase !== 'writing') return;
		for (const matchup of this.matchups) {
			for (const entry of matchup.entries) {
				if (entry.answer === null) entry.answer = NO_ANSWER_TEXT;
			}
		}
		this.phase = 'judging';
		this.startJudging(0);
	}

	// --- judging phase ------------------------------------------------------

	startJudging(index) {
		this.clearTimer();
		if (index >= this.matchups.length) {
			this.finishRound();
			return;
		}
		this.currentMatchupIndex = index;
		const matchup = this.matchups[index];
		matchup.votes = {};
		matchup.revealed = false;
		this.phaseEndsAt = Date.now() + JUDGING_MS;
		this.timer = setTimeout(() => this.revealMatchup(), JUDGING_MS);
		this.lobby.broadcastState();
	}

	eligibleVoterIds(matchup) {
		const authorIds = matchup.entries.map(e => e.playerId);
		return [...this.lobby.players.values()]
			.filter(p => !authorIds.includes(p.id))
			.map(p => p.id);
	}

	handleVote(player, { choice }) {
		if (this.phase !== 'judging') return;
		const matchup = this.matchups[this.currentMatchupIndex];
		if (!matchup || matchup.revealed) return;
		const authorIds = matchup.entries.map(e => e.playerId);
		if (authorIds.includes(player.id)) return;
		if (matchup.votes[player.id]) return;
		if (choice !== 0 && choice !== 1) return;
		matchup.votes[player.id] = choice;

		const eligible = this.eligibleVoterIds(matchup);
		const votedCount = Object.keys(matchup.votes).filter(id => eligible.includes(id)).length;
		if (eligible.length > 0 && votedCount >= eligible.length) {
			this.revealMatchup();
		} else {
			this.lobby.broadcastState();
		}
	}

	revealMatchup() {
		const matchup = this.matchups[this.currentMatchupIndex];
		if (!matchup || matchup.revealed) return;
		this.clearTimer();
		matchup.revealed = true;

		const tally = [0, 0];
		Object.values(matchup.votes).forEach(choice => tally[choice]++);
		matchup.entries.forEach((entry, role) => {
			const player = this.lobby.players.get(entry.playerId);
			if (!player) return;
			player.score += tally[role] * 500;
		});
		if (tally[0] !== tally[1]) {
			const winnerRole = tally[0] > tally[1] ? 0 : 1;
			const winnerPlayer = this.lobby.players.get(matchup.entries[winnerRole].playerId);
			if (winnerPlayer) winnerPlayer.score += 500;
		}

		this.timer = setTimeout(() => this.advanceFromReveal(), REVEAL_AUTO_ADVANCE_MS);
		this.lobby.broadcastState();
	}

	advanceFromReveal() {
		this.clearTimer();
		this.startJudging(this.currentMatchupIndex + 1);
	}

	// --- round / game results ------------------------------------------------

	finishRound() {
		this.clearTimer();
		this.phase = 'roundResults';
		this.phaseEndsAt = null;
		if (this.round >= TOTAL_ROUNDS) {
			this.phase = 'gameOver';
			this.lobby.broadcastState();
			return;
		}
		this.timer = setTimeout(() => this.startRound(), ROUND_RESULTS_AUTO_ADVANCE_MS);
		this.lobby.broadcastState();
	}

	// --- host controls ------------------------------------------------------

	handleHostAction(action) {
		if (action === 'skipWriting' && this.phase === 'writing') {
			this.finishWriting();
		} else if (action === 'advance') {
			if (this.phase === 'judging') {
				const matchup = this.matchups[this.currentMatchupIndex];
				if (matchup && matchup.revealed) this.advanceFromReveal();
			} else if (this.phase === 'roundResults' && this.round < TOTAL_ROUNDS) {
				this.clearTimer();
				this.startRound();
			}
		}
	}

	handlePlayerAction(player, action, payload) {
		if (action === 'submitAnswer') this.handleSubmitAnswer(player, payload || {});
		else if (action === 'vote') this.handleVote(player, payload || {});
	}

	handlePlayerLeave(player) {
		// Historical answers/scores stay put; they simply won't be included
		// in roster-based calculations (eligible voters, next round) going forward.
	}

	// --- state serialization -------------------------------------------------

	getPublicState() {
		const base = {
			gameId: PromptClashGame.id,
			round: this.round,
			totalRounds: TOTAL_ROUNDS,
			phase: this.phase,
			phaseEndsAt: this.phaseEndsAt,
		};

		if (this.phase === 'writing') {
			base.writingStatus = [...this.lobby.players.values()].map(p => {
				const assigned = this.promptsForPlayer(p.id);
				return {
					playerId: p.id,
					name: p.name,
					submittedCount: assigned.filter(a => a.submitted).length,
					totalCount: assigned.length,
				};
			});
		}

		if (this.phase === 'judging') {
			const matchup = this.matchups[this.currentMatchupIndex];
			const eligible = this.eligibleVoterIds(matchup);
			const votedCount = Object.keys(matchup.votes).filter(id => eligible.includes(id)).length;
			base.currentMatchupIndex = this.currentMatchupIndex;
			base.totalMatchups = this.matchups.length;
			base.currentMatchup = {
				promptText: matchup.promptText,
				revealed: matchup.revealed,
				votedCount,
				eligibleVoterCount: eligible.length,
				answers: matchup.displayOrder.map(role => {
					const entry = matchup.entries[role];
					const out = { key: role === 0 ? 'A' : 'B', text: entry.answer };
					if (matchup.revealed) {
						out.votes = Object.values(matchup.votes).filter(v => v === role).length;
						const author = this.lobby.players.get(entry.playerId);
						out.authorName = author ? author.name : '(left the game)';
					}
					return out;
				}),
			};
		}

		if (this.phase === 'roundResults' || this.phase === 'gameOver') {
			base.scoreboard = [...this.lobby.players.values()]
				.map(p => ({ playerId: p.id, name: p.name, score: p.score }))
				.sort((a, b) => b.score - a.score);
		}

		return base;
	}

	getPlayerState(player) {
		if (this.phase === 'writing') {
			return { prompts: this.promptsForPlayer(player.id) };
		}
		if (this.phase === 'judging') {
			const matchup = this.matchups[this.currentMatchupIndex];
			const authorIds = matchup.entries.map(e => e.playerId);
			const isAuthor = authorIds.includes(player.id);
			return {
				isAuthor,
				canVote: !isAuthor && !matchup.revealed && !matchup.votes[player.id],
				hasVoted: Boolean(matchup.votes[player.id]),
			};
		}
		return {};
	}
}

module.exports = PromptClashGame;
