// Split a SQL*Plus-style script into statements the driver can execute one by one.
// - SQL statements end with ";" at end of line.
// - PL/SQL blocks (BEGIN/DECLARE/CREATE … TRIGGER|PROCEDURE|FUNCTION|PACKAGE|TYPE) end with a line "/".
// - SQL*Plus commands (SET, SPOOL, PROMPT, WHENEVER, EXIT, REM, COLUMN, @file) are skipped.
// - "--" comments outside string literals are removed from SQL statements (the XE test server
//   rejects a comment after ";", see SCHEMA §2.5); PL/SQL blocks are kept as written.

const SQLPLUS_CMD =
  /^(SET|SPOOL|PROMPT|WHENEVER|EXIT|QUIT|REM|REMARK|COLUMN|COL|TTITLE|BTITLE|BREAK|CLEAR|SHOW|DEFINE|UNDEFINE|ACCEPT|PAUSE|@)(\s|$|@)/i;
const PLSQL_START =
  /^(BEGIN|DECLARE|CREATE\s+(OR\s+REPLACE\s+)?(EDITIONABLE\s+)?(TRIGGER|PROCEDURE|FUNCTION|PACKAGE|TYPE)\b)/i;

/** Remove a trailing `-- comment` that is outside single-quoted literals. */
export function stripLineComment(line) {
  let inStr = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "'") inStr = !inStr;
    else if (!inStr && ch === '-' && line[i + 1] === '-') return line.slice(0, i);
  }
  return line;
}

/**
 * @param {string} text script content
 * @returns {{ sql: string, line: number, plsql: boolean }[]}
 */
export function splitSqlScript(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  /** @type {{ sql: string, line: number, plsql: boolean }[]} */
  const out = [];
  let buf = [];
  let startLine = 0;
  let mode = 'idle'; // idle | sql | plsql
  let inBlockComment = false;

  lines.forEach((raw, idx) => {
    const lineNo = idx + 1;
    const trimmed = raw.trim();

    if (mode === 'plsql') {
      if (trimmed === '/') {
        out.push({ sql: buf.join('\n').trim(), line: startLine, plsql: true });
        buf = [];
        mode = 'idle';
      } else {
        buf.push(raw);
      }
      return;
    }

    // block comments /* … */ outside statements are skipped
    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false;
      return;
    }
    if (mode === 'idle') {
      if (trimmed === '' || trimmed === '/' || trimmed.startsWith('--')) return;
      if (trimmed.startsWith('/*')) {
        if (!trimmed.includes('*/')) inBlockComment = true;
        return;
      }
      if (SQLPLUS_CMD.test(trimmed)) return;
      startLine = lineNo;
      if (PLSQL_START.test(trimmed)) {
        mode = 'plsql';
        buf.push(raw);
        return;
      }
      mode = 'sql';
    }

    // mode === 'sql'
    const code = stripLineComment(raw).replace(/\s+$/, '');
    if (code.trim() === '') return;
    if (code.endsWith(';')) {
      buf.push(code.slice(0, -1));
      out.push({ sql: buf.join('\n').trim(), line: startLine, plsql: false });
      buf = [];
      mode = 'idle';
    } else {
      buf.push(code);
    }
  });

  if (buf.length && buf.join('').trim()) {
    throw new Error(
      `Unterminated ${mode === 'plsql' ? 'PL/SQL block (missing "/")' : 'statement (missing ";")'} starting at line ${startLine}`,
    );
  }
  return out;
}
