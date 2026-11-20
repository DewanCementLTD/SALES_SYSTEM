import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { splitSqlScript, stripLineComment } from './parse-sql.js';

const db = (p) => fileURLToPath(new URL(`../../../../../db/${p}`, import.meta.url));

describe('SQL*Plus script splitter (P0-04)', () => {
  it('splits SQL on ";" and PL/SQL on "/" and skips SQL*Plus commands', () => {
    const script = [
      'SET DEFINE OFF',
      'WHENEVER SQLERROR EXIT',
      '-- a comment',
      'CREATE TABLE T1 (',
      '  A NUMBER, -- first column',
      "  B VARCHAR2(10) DEFAULT 'x--y'",
      ');',
      'PROMPT hello',
      'DECLARE',
      '  n NUMBER;',
      'BEGIN',
      '  n := 1; -- kept inside PL/SQL',
      'END;',
      '/',
      "INSERT INTO T1 (A, B) VALUES (1, 'it''s; fine');",
      '/',
      'CREATE OR REPLACE TRIGGER TR1 BEFORE INSERT ON T1 FOR EACH ROW',
      'BEGIN NULL; END;',
      '/',
    ].join('\r\n');
    const st = splitSqlScript(script);
    expect(st.map((s) => s.plsql)).toEqual([false, true, false, true]);
    expect(st[0].sql).toBe("CREATE TABLE T1 (\n  A NUMBER,\n  B VARCHAR2(10) DEFAULT 'x--y'\n)");
    expect(st[0].line).toBe(4);
    expect(st[1].sql).toContain('-- kept inside PL/SQL');
    expect(st[1].sql.endsWith('END;')).toBe(true);
    expect(st[2].sql).toBe("INSERT INTO T1 (A, B) VALUES (1, 'it''s; fine')");
  });

  it('keeps "--" inside string literals', () => {
    expect(stripLineComment("SELECT '--' FROM DUAL -- c")).toBe("SELECT '--' FROM DUAL ");
  });

  it('fails loudly on an unterminated statement', () => {
    expect(() => splitSqlScript('CREATE TABLE X (A NUMBER)')).toThrow(/missing ";"/);
    expect(() => splitSqlScript('BEGIN\nNULL;\nEND;')).toThrow(/missing "\/"/);
  });

  it.each([
    '05_NEW_SYSTEM_TABLES.sql',
    'migrations/001_LEGACY_TABLES_NOT_HOSTED.sql',
    'migrations/002_GEO_HIERARCHY.sql',
  ])('parses the real script %s', (file) => {
    const st = splitSqlScript(readFileSync(db(file), 'utf8'));
    expect(st.length).toBeGreaterThan(3);
    for (const s of st) {
      expect(s.sql.trim()).not.toBe('');
      // SQL statements are sent without the terminating ";" (ORA-00911 otherwise)
      if (!s.plsql) expect(s.sql.trimEnd().endsWith(';')).toBe(false);
      else expect(s.sql.trimEnd().toUpperCase()).toMatch(/END\s*(\w+)?;$/);
    }
  });
});
