// SPELL CHECK for the notes editor: Electron's own spellchecker (Windows' dictionaries). The page asks for the
// right-click suggestions through here; picking one replaces the word in place.
module.exports.attach = (win, local) => {
  const wc = win.webContents, ses = wc.session;
  try { // follow the system language; if Windows gave none, fall back to US English when it is available
    if (!ses.getSpellCheckerLanguages().length && ses.availableSpellCheckerLanguages.includes('en-US')) ses.setSpellCheckerLanguages(['en-US']);
  } catch {}
  wc.on('context-menu', (_e, p) => {
    if (!p.isEditable) return;
    if (!wc.isDestroyed()) wc.send('ev', 'spell-ctx', { word: p.misspelledWord || '', sugg: (p.dictionarySuggestions || []).slice(0, 6), x: p.x, y: p.y, t: Date.now() });
  });
  local.spellReplace = (_e, w) => { if (typeof w === 'string' && w.length < 80) wc.replaceMisspelling(w); return true; };
  local.spellAdd = (_e, w) => { if (typeof w === 'string' && w.length < 80) ses.addWordToSpellCheckerDictionary(w); return true; };
  local.spellLangs = () => { try { return { on: ses.getSpellCheckerLanguages(), all: ses.availableSpellCheckerLanguages }; } catch { return { on: [], all: [] }; } };
};
