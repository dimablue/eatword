// Wordle feedback scoring. Duplicated from server.js on purpose: server.js starts a
// listener on require, so the arena game can't import from it.
const WORD_LEN = 5;

function scoreGuess(guess, answer) {
  const result = Array(WORD_LEN).fill("gray");
  const answerChars = answer.split("");
  const guessChars = guess.split("");
  for (let i = 0; i < WORD_LEN; i++) {
    if (guessChars[i] === answerChars[i]) {
      result[i] = "green";
      answerChars[i] = null;
    }
  }
  for (let i = 0; i < WORD_LEN; i++) {
    if (result[i] === "green") continue;
    const idx = answerChars.indexOf(guessChars[i]);
    if (idx !== -1) {
      result[i] = "yellow";
      answerChars[idx] = null;
    }
  }
  return result;
}

function sameColors(a, b) {
  for (let i = 0; i < WORD_LEN; i++) if (a[i] !== b[i]) return false;
  return true;
}

module.exports = { scoreGuess, sameColors, WORD_LEN };
