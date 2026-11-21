// A faster drop-in for csv-reader 1.0.0: the same answer on every input, in less CPU.
//
// The reference reads one character at a time and grows every field a character
// at a time. This one jumps from one interesting character to the next -- a regex
// finds the next comma, CR or LF in an unquoted field, indexOf finds the next
// quote in a quoted one -- and cuts whole runs out with slice, so a clean field
// costs one slice and a clean line one split. The reading rules are the
// reference's, kept exactly:
//
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside a quoted field a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled,
//     "" inside it one quote, and each CRLF or lone CR inside it read as LF; what
//     follows its closing quote, up to the next comma or line break, is appended
//     as it stands (quote_junk, when the field ends); a quote that never closes
//     is a literal character, and the text after it is read again as unquoted
//     (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay
//     strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds the
//     records after it (every record when header is false), each padded with ""
//     (short_row, with fields: its count) or cut (long_row, with extra: the cut
//     fields) to the first record's width;
//   - each error is {code, line, row}: line the 1-based line its record starts
//     on (every LF, CRLF and lone CR inside a quoted field counted), row its
//     record's index in rows (null for the header), in the order met.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** The next interesting character of an unquoted field: a comma, a CR or an LF. */
const UNQUOTED_NEXT = /[,\r\n]/g;

/** csv-reader 1.0.0's answer for one case's input: {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and its index in rows (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // The slice text[a..b), with every CRLF and lone CR inside it turned into one
  // LF and the line count moved past each of them. A slice holding neither is cut
  // out as it stands.
  function normalized(a, b) {
    if (b <= a) return '';
    const nl = text.indexOf('\n', a);
    const cr = text.indexOf('\r', a);
    if ((nl === -1 || nl >= b) && (cr === -1 || cr >= b)) return text.slice(a, b);
    return text.slice(a, b).replace(/\r\n|\r|\n/g, () => {
      line += 1;
      return '\n';
    });
  }

  // Reads unquoted characters onto `value` up to the next comma or line break: a
  // CR not followed by LF is dropped (stray_cr). Returns [value, ended, added];
  // ended is 0 for a comma, 1 for a line break, 2 for the end of the text, and
  // added counts the characters kept.
  function readUnquoted(value) {
    let added = 0;
    let start = pos;
    UNQUOTED_NEXT.lastIndex = pos;
    let m;
    while ((m = UNQUOTED_NEXT.exec(text)) !== null) {
      const i = m.index;
      const c = text.charCodeAt(i);
      if (c === 44) {
        if (i > start) {
          value += text.slice(start, i);
          added += i - start;
        }
        pos = i + 1;
        return [value, COMMA, added];
      }
      if (c === 10) {
        if (i > start) {
          value += text.slice(start, i);
          added += i - start;
        }
        pos = i + 1;
        line += 1;
        return [value, LINE_BREAK, added];
      }
      if (text.charCodeAt(i + 1) === 10) {
        if (i > start) {
          value += text.slice(start, i);
          added += i - start;
        }
        pos = i + 2;
        line += 1;
        return [value, LINE_BREAK, added];
      }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      if (i > start) {
        value += text.slice(start, i);
        added += i - start;
      }
      pos = i + 1;
      start = i + 1;
      UNQUOTED_NEXT.lastIndex = i + 1;
    }
    if (n > start) {
      value += text.slice(start, n);
      added += n - start;
    }
    pos = n;
    return [value, END, added];
  }

  // Reads a quoted field whose opening quote is at pos. Returns [value, ended].
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    let seg = pos;
    for (;;) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text after
        // it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        return readUnquoted('"');
      }
      if (text.charCodeAt(q + 1) === 34) {
        value += normalized(seg, q) + '"';
        pos = q + 2;
        seg = q + 2;
        continue;
      }
      value += normalized(seg, q);
      pos = q + 1;
      break;
    }
    if (pos >= n) return [value, END];
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      return [value, COMMA];
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      return [value, LINE_BREAK];
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return [value, LINE_BREAK];
    }
    // What follows the closing quote is appended as it stands, up to the next
    // comma or line break.
    const junk = readUnquoted(value);
    if (junk[2] > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return junk;
  }

  // Files a finished record: the first record sets the width, the header is kept
  // apart, and the rest are padded with "" or cut to the width.
  function finishRecord(fields) {
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // A line with no quote and no stray CR is cut out whole and split on commas.
    let lineEnd = text.indexOf('\n', pos);
    if (lineEnd === -1) lineEnd = n;
    let contentEnd = lineEnd;
    if (contentEnd > pos && text.charCodeAt(contentEnd - 1) === 13) contentEnd -= 1;
    if (contentEnd > pos) {
      const flat = text.slice(pos, contentEnd);
      if (flat.indexOf('"') === -1 && flat.indexOf('\r') === -1) {
        finishRecord(flat.split(','));
        pos = lineEnd < n ? lineEnd + 1 : n;
        line += 1;
        continue;
      }
    }

    const fields = [];
    let ended;
    let quoted = false;
    do {
      let field;
      if (text.charCodeAt(pos) === 34) {
        quoted = true;
        field = readQuoted();
      } else {
        quoted = false;
        field = readUnquoted('');
      }
      fields.push(field[0]);
      ended = field[1];
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    finishRecord(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
