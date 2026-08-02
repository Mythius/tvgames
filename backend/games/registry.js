const games = new Map();

function register(GameClass) {
	games.set(GameClass.id, GameClass);
}

function getGame(id) {
	return games.get(id) || null;
}

function listGames() {
	return [...games.values()].map(GameClass => ({
		id: GameClass.id,
		title: GameClass.title,
		description: GameClass.description,
		minPlayers: GameClass.minPlayers,
		maxPlayers: GameClass.maxPlayers,
	}));
}

module.exports = { register, getGame, listGames };

// Registered here so every game is available as soon as the registry is required.
register(require('./promptclash/PromptClashGame'));
register(require('./catchphrase/CatchphraseGame'));
register(require('./scattergories/ScattergoriesGame'));
