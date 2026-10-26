// Detector de usos ambientales (reloj, azar global, navegador) en fuentes JavaScript.
// Antes de buscar quita comentarios y, salvo para Math['random'], también el contenido de
// cadenas: un texto como "window" no es una llamada. El código dentro de ${...} se conserva.

// Devuelve `source` sin comentarios. Con keepStrings=false también se quita el contenido de
// cadenas y plantillas; con keepStrings=true se conserva tal cual.
export function codeOnly(source, keepStrings = false) {
  let out = '';
  const stack = [{ kind: 'code', braces: 0 }];
  const str = (text) => { if (keepStrings) out += text; };
  let i = 0;
  while (i < source.length) {
    const top = stack[stack.length - 1];
    const c = source[i];
    const d = source[i + 1];

    if (top.kind === 'line') {
      if (c === '\n') { stack.pop(); out += '\n'; }
      i++;
      continue;
    }
    if (top.kind === 'block') {
      if (c === '*' && d === '/') { stack.pop(); i += 2; } else { i++; }
      continue;
    }
    if (top.kind === 'sq' || top.kind === 'dq') {
      const close = top.kind === 'sq' ? "'" : '"';
      if (c === '\\') { str(source.slice(i, i + 2)); i += 2; continue; }
      if (c === close || c === '\n') { stack.pop(); str(c); i++; continue; }
      str(c); i++;
      continue;
    }
    if (top.kind === 'tpl') {
      if (c === '\\') { str(source.slice(i, i + 2)); i += 2; continue; }
      if (c === '`') { stack.pop(); str(c); i++; continue; }
      if (c === '$' && d === '{') { stack.push({ kind: 'code', braces: 0, expr: true }); i += 2; continue; }
      str(c); i++;
      continue;
    }

    // código
    if (c === '/' && d === '/') { stack.push({ kind: 'line' }); i += 2; continue; }
    if (c === '/' && d === '*') { stack.push({ kind: 'block' }); i += 2; continue; }
    if (c === "'") { stack.push({ kind: 'sq' }); str(c); i++; continue; }
    if (c === '"') { stack.push({ kind: 'dq' }); str(c); i++; continue; }
    if (c === '`') { stack.push({ kind: 'tpl' }); str(c); i++; continue; }
    if (c === '{') top.braces++;
    if (c === '}') {
      if (top.expr && top.braces === 0) { stack.pop(); i++; continue; }
      top.braces--;
    }
    out += c;
    i++;
  }
  return out;
}

const AMBIENT = [
  [/\bMath\s*\.\s*random\b/, 'Math.random'],
  [/\bDate\.now\b/, 'Date.now'],
  [/\bnew\s+Date\b/, 'new Date'],
  [/\bperformance\s*\.\s*now\b/, 'performance.now'],
  [/\bglobalThis\b/, 'globalThis'],
  [/\bwindow\b/, 'window'],
  [/\bdocument\b/, 'document'],
  [/\blocalStorage\b/, 'localStorage'],
];

// Math['random'] necesita sus cadenas para verse, así que se busca sobre el código con cadenas.
const BRACKET_RANDOM = /\bMath\s*\[\s*(['"`])random\1\s*\]/;

// Lista de usos ambientales encontrados en código ejecutable (vacía si no hay ninguno).
export function ambientUses(source) {
  const sinCadenas = codeOnly(source, false);
  const conCadenas = codeOnly(source, true);
  const hallados = AMBIENT.filter(([re]) => re.test(sinCadenas)).map(([, nombre]) => nombre);
  if (BRACKET_RANDOM.test(conCadenas)) hallados.push("Math['random']");
  return hallados;
}
