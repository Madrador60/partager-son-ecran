"use strict";

// Traduit un évènement clavier/souris reçu du viewer en actions nut-js.
// Module pur (sans Electron) pour pouvoir être testé.

const NAMED_KEYS = {
  Enter: "Enter", Escape: "Escape", Backspace: "Backspace", Tab: "Tab", Delete: "Delete", Insert: "Insert",
  Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown",
  ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
  " ": "Space", Spacebar: "Space", CapsLock: "CapsLock", PrintScreen: "Print", ScrollLock: "ScrollLock",
  Pause: "Pause", NumLock: "NumLock", ContextMenu: "Menu", Meta: "LeftSuper", OS: "LeftSuper"
};

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "AltGraph"]);

// Repli sur la position physique pour les raccourcis (Ctrl+1, Ctrl+-, …).
const CODE_KEYS = {
  Minus: "Minus", Equal: "Equal", BracketLeft: "LeftBracket", BracketRight: "RightBracket", Backslash: "Backslash",
  Semicolon: "Semicolon", Quote: "Quote", Comma: "Comma", Period: "Period", Slash: "Slash", Backquote: "Grave"
};

function baseKeyName({ key, code }) {
  if (NAMED_KEYS[key]) return NAMED_KEYS[key];
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) return key;
  if (/^[a-z]$/i.test(key)) return key.toUpperCase();
  if (/^[0-9]$/.test(key)) return `Num${key}`;
  if (/^Key[A-Z]$/.test(code || "")) return code.slice(3);
  if (/^Digit[0-9]$/.test(code || "")) return `Num${code.slice(5)}`;
  if (CODE_KEYS[code]) return CODE_KEYS[code];
  return null;
}

/**
 * Retourne l'action à exécuter pour un keydown :
 * - { kind: "text", text } pour un caractère imprimable (indépendant de la disposition clavier) ;
 * - { kind: "combo", keys } pour une touche spéciale ou un raccourci (modificateurs d'abord) ;
 * - null si rien à faire (modificateur seul, touche inconnue).
 */
function planKeydown(payload) {
  const { key = "", ctrl = false, alt = false, shift = false, meta = false } = payload;
  if (MODIFIER_KEYS.has(key)) return null;
  const printable = [...key].length === 1 && key !== " ";
  // AltGr est signalé comme Ctrl+Alt : on tape directement le caractère produit (@, #, €…).
  const altGr = ctrl && alt && !meta;
  if (printable && ((!ctrl && !alt && !meta) || altGr)) return { kind: "text", text: key };
  const base = baseKeyName(payload);
  if (!base) return null;
  const keys = [];
  if (ctrl) keys.push("LeftControl");
  if (alt) keys.push("LeftAlt");
  if (shift) keys.push("LeftShift");
  if (meta && base !== "LeftSuper") keys.push("LeftSuper");
  keys.push(base);
  return { kind: "combo", keys };
}

function buttonName(button) {
  return button === 2 ? "RIGHT" : button === 1 ? "MIDDLE" : "LEFT";
}

module.exports = { planKeydown, buttonName, baseKeyName };
