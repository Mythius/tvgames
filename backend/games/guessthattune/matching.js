// Loose answer checking for typed song/artist guesses. Spotify titles carry a
// lot of noise ("Song - Remastered 2011", "Song (feat. Someone)") that nobody
// will type, so both sides are normalized before comparing, and small typos
// are forgiven with an edit-distance check.

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

function levenshtein(a, b) {
	if (a === b) return 0;
	if (!a.length) return b.length;
	if (!b.length) return a.length;
	let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const cur = [i];
		for (let j = 1; j <= b.length; j++) {
			cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
		}
		prev = cur;
	}
	return prev[b.length];
}

function similar(guess, target) {
	if (!guess || !target) return false;
	if (guess === target) return true;
	if (target.length < 4) return false; // short titles must be exact
	const allowed = Math.floor(target.length * 0.2);
	return levenshtein(guess, target) <= allowed;
}

// A guess can name the title, the artist, or both ("hey jude by the beatles"),
// so it's checked whole and also split into parts on common separators.
function guessParts(guess) {
	const raw = String(guess || '').toLowerCase();
	const pieces = raw.split(/\s+by\s+|\s+-\s+|,|\//);
	return [...new Set([raw, ...pieces].map(normalize).filter(Boolean))];
}

function checkGuess(guess, track) {
	const parts = guessParts(guess);
	const title = normalize(track.name);
	const artists = (track.artists || []).map(normalize).filter(Boolean);
	return {
		title: parts.some(p => similar(p, title)),
		artist: parts.some(p => artists.some(a => similar(p, a))),
	};
}

module.exports = { normalize, checkGuess };
