import { describe, expect, it } from 'vitest';
import {
  checkCode,
  checkDuplicates,
  checkLength,
  checkMarkers,
  checkNumbers,
  checkScript,
  checkSegment,
  checkUrls,
  codeSpans,
  markerCounts,
  numbers,
  urls,
} from './checks.ts';

describe('checks: markers (M2-E4)', () => {
  it('passes the same markers, reordered words, and emphasis or code repeated by a gloss', () => {
    expect(checkMarkers('Futures are *lazy*: call `poll`, see [link]the docs[/link].', 'Future vốn *lười*: gọi `poll`, xem [link]tài liệu[/link].')).toBeUndefined();
    expect(checkMarkers('a series of *stages*', 'một chuỗi *giai đoạn* (*stages*)')).toBeUndefined();
    expect(checkMarkers('**bold** and *em*', '**đậm** và *nghiêng*')).toBeUndefined();
  });

  it('fails lost, extra or unpaired links', () => {
    expect(checkMarkers('Read [link]the docs[/link].', 'Đọc tài liệu.')?.detail).toBe('0 links for 1');
    expect(checkMarkers('Read [link]the docs[/link].', 'Đọc [link]tài[/link] [link]liệu[/link].')?.detail).toBe('2 links for 1');
    expect(checkMarkers('Read [link]the docs[/link].', 'Đọc [link]tài liệu.')?.detail).toBe('unpaired [link] markers');
    expect(checkMarkers('Read [link]the docs[/link].', 'Đọc [/link]tài liệu[link].')?.detail).toBe('unpaired [link] markers');
    // Nested opens are unpaired too.
    expect(checkMarkers('[link]a[/link] [link]b[/link]', '[link]a [link]b[/link][/link]')?.kind).toBe('markers');
  });

  it('fails lost or unbalanced emphasis; asterisks inside code spans are not emphasis', () => {
    expect(checkMarkers('Futures are *lazy*.', 'Future vốn lười.')?.detail).toBe('0 emphasis asterisks for 2');
    expect(checkMarkers('Futures are *lazy*.', 'Future vốn *lười*, *rất* *lười.')?.detail).toBe('an unpaired emphasis asterisk');
    expect(checkMarkers('Use `a*b*c` here.', 'Dùng `a*b*c` ở đây.')).toBeUndefined();
    expect(checkMarkers('Use `a*b*c` here.', 'Dùng `a*b*c` ở *đây*.')).toBeUndefined();
    // A literal asterisk in the source (odd count) stays one.
    expect(checkMarkers('Footnote* applies.', 'Chú thích* áp dụng.')).toBeUndefined();
  });

  it('fails lost backtick spans and an unclosed backtick', () => {
    expect(checkMarkers('crate `futures` for `ArcWake`', 'crate futures cho ArcWake')?.detail).toBe('0 code spans for 2');
    expect(checkMarkers('call `poll`', 'gọi `poll')?.kind).toBe('markers');
  });

  it('counts markers per kind outside code spans (round 15 carry-over)', () => {
    expect(markerCounts('`a*b*c` *x* [link]y[/link] `[link]`')).toEqual({ code: 2, link: 1, emphasis: 1 });
  });
});

describe('checks: code spans byte-identical', () => {
  it('passes each distinct span at least once, anywhere', () => {
    expect(checkCode('To `panic!` or Not to `panic!`', 'Nên hay không nên dùng `panic!`?')).toBeUndefined();
    expect(checkCode('`a` then `b`', '`b` rồi `a`')).toBeUndefined();
    expect(codeSpans('x `a` y `b c` z')).toEqual(['`a`', '`b c`']);
  });

  it('fails a changed, translated or unwrapped span', () => {
    expect(checkCode('`digesters` run', '`digester` chạy')?.detail).toBe('missing `digesters`');
    expect(checkCode('Rust\'s `?` operator', 'toán tử ? của Rust')?.detail).toBe('missing `?`');
    expect(checkCode('the `Future` trait', 'trait `Tương lai`')?.kind).toBe('code');
    expect(checkCode('`foo()` ', '` foo()`')?.kind).toBe('code');
  });
});

describe('checks: URLs', () => {
  it('finds URLs with punctuation around them, and keeps a balanced parenthesis', () => {
    expect(urls('See https://go.dev/blog/errors-are-values. Or (https://example.com/a?b=1&c=2), www.rust-lang.org!')).toEqual([
      'https://go.dev/blog/errors-are-values',
      'https://example.com/a?b=1&c=2',
      'www.rust-lang.org',
    ]);
    expect(urls('https://en.wikipedia.org/wiki/Rust_(programming_language).')).toEqual(['https://en.wikipedia.org/wiki/Rust_(programming_language)']);
    expect(urls('code: `https://in.code/span`')).toEqual([]);
  });

  it('passes the URL byte-identical anywhere; fails a changed or dropped one', () => {
    expect(checkUrls('Read https://go.dev/doc/effective_go, then code.', 'Đọc xong https://go.dev/doc/effective_go rồi viết mã.')).toBeUndefined();
    expect(checkUrls('Read https://go.dev/doc/effective_go.', 'Đọc https://go.dev/doc/effective-go.')?.detail).toContain('missing https://go.dev/doc/effective_go');
    expect(checkUrls('Read https://go.dev/doc.', 'Đọc tài liệu.')?.kind).toBe('url');
  });
});

describe('checks: numbers', () => {
  it('compares digits only: thousand and decimal separators may be localised', () => {
    expect(numbers('1,000 users, 3.5 s, 1 000 000 bytes')).toEqual(['1000', '35', '1', '000', '000']);
    expect(checkNumbers('It took 3.5 seconds for 1,000 requests.', 'Mất 3,5 giây cho 1.000 yêu cầu.')).toBeUndefined();
    expect(checkNumbers('1,234,567 rows', '1.234.567 dòng')).toBeUndefined();
    expect(checkNumbers('1,234 rows', '1 234 dòng')).toBeUndefined();
    // Repeated or fewer times is fine; order too.
    expect(checkNumbers('3 items, then 3 more and 4', '4 và 3 mục')).toBeUndefined();
  });

  it('ignores numbers inside code spans and URLs (their own checks cover them)', () => {
    expect(checkNumbers('Call `retry(3)` at https://x.io/v2/api', 'Gọi `retry(3)` tại https://x.io/v2/api')).toBeUndefined();
    expect(numbers('`x = 42` at https://a.b/c/7')).toEqual([]);
  });

  it('fails a dropped, changed or spelled-out number', () => {
    expect(checkNumbers('back in the 1800s', 'vào thế kỷ 19')?.detail).toBe('missing 1800');
    expect(checkNumbers('Go 1.18 added generics', 'Go 1.19 thêm generics')?.detail).toBe('missing 118');
    expect(checkNumbers('wait 2 seconds', 'chờ hai giây')?.kind).toBe('number');
  });
});

describe('checks: length ratio', () => {
  it('fails empty and runaway output; passes normal expansion and short labels', () => {
    expect(checkLength('Hello world, how are you today?', '', 'vi')?.detail).toBe('empty');
    expect(checkLength('', '', 'vi')).toBeUndefined();
    expect(checkLength('Hello world, how are you today?', 'Xin chào thế giới, hôm nay bạn thế nào?', 'vi')).toBeUndefined();
    // Short sources are not judged on the low side ("OK" → "Ừ").
    expect(checkLength('OK', 'Ừ', 'vi')).toBeUndefined();
    const src = 'This example shows the first difference between Rust and other languages.';
    expect(checkLength(src, 'Ví dụ.', 'vi')?.kind).toBe('length');
    expect(checkLength(src, 'x'.repeat(3 * src.length + 81), 'vi')?.detail).toContain('runaway');
    // A short heading with a first-use gloss is within the slack.
    expect(checkLength('Ownership', 'Quyền sở hữu (ownership — cơ chế quản lý bộ nhớ của Rust)', 'vi')).toBeUndefined();
  });

  it('allows the denser Chinese, Japanese and Korean text', () => {
    const src = 'The quick brown fox jumps over the lazy dog near the riverbank.';
    expect(checkLength(src, '敏捷的棕色狐狸跳过了河岸边的懒狗。', 'zh-CN')).toBeUndefined();
    expect(checkLength(src, '狐狸跳过懒狗。', 'zh')).toBeUndefined();
    expect(checkLength(src, '狐狸跳过懒狗。', 'vi')?.kind).toBe('length');
  });
});

describe('checks: wrong script (M2-D19)', () => {
  it('fails letters of a script that is neither the target\'s nor in the source', () => {
    expect(checkScript('This is a brand new idea', 'Đây là một ý nghĩ hoàn איn toàn mới', 'vi')?.detail).toBe('Hebrew text (א)');
    expect(checkScript('Do not stuff beans', 'Đừng nhét đậu麻 vào mũi', 'vi')?.detail).toBe('Han text (麻)');
    expect(checkScript('much lessened', 'giảm đi đángگری', 'vi')?.kind).toBe('script');
  });

  it('passes the target\'s own script, scripts the source has, Greek, and code spans', () => {
    expect(checkScript('Hello', 'こんにちは世界', 'ja')).toBeUndefined();
    expect(checkScript('A sign reading মানবে না', 'Tấm biển ghi মানবে না', 'vi')).toBeUndefined();
    expect(checkScript('the λ calculus', 'phép tính λ', 'vi')).toBeUndefined();
    expect(checkScript('print `"你好"`', 'in `"你好"`', 'vi')).toBeUndefined();
    expect(checkScript('Hello', 'Привет', 'ru')).toBeUndefined();
    expect(checkScript('Hello', 'Привет', 'vi')?.detail).toBe('Cyrillic text (П)');
  });
});

describe('checks: neighbour duplicates (document level, M2-D19)', () => {
  const same = 'Quyền sở hữu là một tập hợp quy tắc chi phối cách chương trình Rust quản lý bộ nhớ.';
  it('fails the later of two near-identical translations of different sources, within the window', () => {
    const rows = [
      { id: 'a', source: 'Ownership is a set of rules that govern how a Rust program manages memory.', translation: same },
      { id: 'b', source: 'Some languages have garbage collection that regularly looks for no-longer-used memory.', translation: same },
    ];
    expect([...checkDuplicates(rows).keys()]).toEqual(['b']);
  });

  it('passes repeated boilerplate (same source), short headings, and copies outside the window', () => {
    const boiler = 'Boilerplate footer text that repeats on every single page of the site.';
    expect(checkDuplicates([{ id: 'a', source: boiler, translation: same }, { id: 'b', source: boiler, translation: same }]).size).toBe(0);
    expect(checkDuplicates([{ id: 'a', source: 'Example', translation: 'Ví dụ' }, { id: 'b', source: 'Examples', translation: 'Ví dụ' }]).size).toBe(0);
    const far = [
      { id: 'a', source: 'Ownership is a set of rules that govern how a Rust program manages memory.', translation: same },
      { id: 'x', source: 'One.', translation: 'Một.' },
      { id: 'y', source: 'Two.', translation: 'Hai.' },
      { id: 'b', source: 'Some languages have garbage collection that regularly looks for no-longer-used memory.', translation: same },
    ];
    expect(checkDuplicates(far).size).toBe(0);
  });
});

describe('checks: checkSegment', () => {
  it('lists every failing check, none for a clean translation', () => {
    expect(checkSegment('Call `poll` 3 times at https://a.io.', 'Gọi `poll` 3 lần tại https://a.io.', 'vi')).toEqual([]);
    expect(checkSegment('Call `poll` 3 times at https://a.io.', 'Gọi poll ba lần.', 'vi').map((f) => f.kind)).toEqual(['markers', 'code', 'url', 'number']);
  });
});
