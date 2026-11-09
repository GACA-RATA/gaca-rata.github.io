// Paste the Google Apps Script web app address between the quotes so every
// phone shares scores without anyone typing it in. Leave it empty and each
// phone keeps its own scores (it can still be set in Settings).
window.RATA_CONFIG = {
  // Hole on the paper as a share of the bullet size (1.00 = same size).
  // Tuned from test targets; every phone uses these.
  holeFactor: { "22lr": 1.0, "9mm": 1.0, "177": 1.0 },
  syncUrl: "https://script.google.com/macros/s/AKfycbxkZldKwnEZzKSyK1KgFru-8oA0bitMF8-Sz5hiloSq0mOPmolW-phVh8Yo9oOMhAf48Q/exec",
};
