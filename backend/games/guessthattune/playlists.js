// Spotify playlists the host can pick from on the TV. `playlistId` is the
// part of a playlist link after /playlist/ (e.g. open.spotify.com/playlist/
// 7phO9PAhj7bU6TwcHPrr7s -> '7phO9PAhj7bU6TwcHPrr7s'). Entries with an empty
// playlistId are hidden until one is filled in. The host can also paste any
// playlist link/ID on the TV without editing this file.
module.exports = [
	{ id: 'mix', name: '🎶 General Mix', playlistId: '7phO9PAhj7bU6TwcHPrr7s' },
	{ id: 'pop', name: '🎤 Pop', playlistId: '' },
	{ id: 'rock', name: '🎸 Rock', playlistId: '' },
	{ id: 'hiphop', name: '🎧 Hip-Hop', playlistId: '' },
	{ id: 'country', name: '🤠 Country', playlistId: '' },
	{ id: 'oldies', name: '📻 Oldies', playlistId: '' },
	{ id: 'eighties', name: '🕺 80s', playlistId: '' },
	{ id: 'nineties', name: '💿 90s', playlistId: '' },
	{ id: 'disney', name: '🏰 Movies & TV', playlistId: '' },
	{ id: 'christmas', name: '🎄 Christmas', playlistId: '' },
];
