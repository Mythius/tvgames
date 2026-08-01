/**
 * Base class every game mode extends. A Game instance is owned by exactly one
 * Lobby for the lifetime of a single play-through. Subclasses never touch
 * sockets directly - they talk to players/TV through the Lobby helper
 * methods (broadcastTV, sendToPlayer, broadcastPlayers) so the transport is
 * fully decoupled from game logic.
 */
class Game {
	static id = 'base';
	static title = 'Base Game';
	static description = '';
	static minPlayers = 1;
	static maxPlayers = 99;

	/** Whether players may join the lobby while this game is already in progress. */
	static allowLateJoin = false;

	constructor(lobby) {
		this.lobby = lobby;
	}

	/** Called once when the host starts the game. */
	start() {}

	/** Called for a `player:action` event routed to this game. */
	handlePlayerAction(player, action, payload) {}

	/** Called for a `host:command` event routed to this game. */
	handleHostAction(action, payload) {}

	/** Called when a new player joins while the game is already in progress (only possible if allowLateJoin is true). */
	handlePlayerJoin(player) {}

	/** Called once a player is permanently removed (grace period expired or left voluntarily). */
	handlePlayerLeave(player) {}

	/** Called when a previously-disconnected player reconnects. */
	handlePlayerReconnect(player) {}

	/** State broadcast to the TV and included in every player's view. Must be JSON-serializable. */
	getPublicState() {
		return {};
	}

	/** Private, per-player state (e.g. their prompt, whether they can vote). */
	getPlayerState(player) {
		return {};
	}

	/** Clear any timers - called when the lobby is torn down or the game ends. */
	destroy() {}
}

module.exports = Game;
