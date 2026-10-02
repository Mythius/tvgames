// Spotify titles carry a lot of noise ("Song - Remastered 2011",
// "Song (feat. Someone)"). These helpers clean that up for display and
// detect near-duplicates so the same song doesn't show up twice in a
// dropdown.

function displayTitle(name) {
	const text = String(name || '').trim();
	return text.replace(/\s+-\s+.*$/, '').trim() || text;
}

function normalize(text) {
	return String(text || '')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '') // strip accents
		.toLowerCase()
		.replace(/\s+-\s+.*$/, '') // " - Remastered 2011", " - Live", ...
		.replace(/[([{].*?[)\]}]/g, ' ') // "(feat. X)", "[Live]"
		.replace(/\b(feat|ft|featuring)\b.*$/, ' ')
		.replace(/&/g, ' and ')
		.replace(/[^a-z0-9 ]/g, '')
		.replace(/^the\s+/, '')
		.replace(/\s+/g, ' ')
		.trim();
}

module.exports = { displayTitle, normalize };
