const fs = require("fs");
const path = require("path");

function loadList(file) {
  return fs
    .readFileSync(path.join(__dirname, "data", file), "utf8")
    .split(/\r?\n/)
    .map((w) => w.trim().toLowerCase())
    .filter((w) => /^[a-z]{5}$/.test(w));
}

const ANSWERS = loadList("answers.txt");
const EXTRA = loadList("valid_extra.txt");

const ANSWER_SET = new Set(ANSWERS);
const VALID_SET = new Set([...ANSWERS, ...EXTRA]);

console.log(`Loaded ${ANSWERS.length} answers, ${VALID_SET.size} total valid guesses.`);

function randomAnswer() {
  return ANSWERS[Math.floor(Math.random() * ANSWERS.length)];
}

function isValidGuess(word) {
  return VALID_SET.has(word.toLowerCase());
}

module.exports = { randomAnswer, isValidGuess, ANSWER_SET };
