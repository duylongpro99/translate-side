import { describe, expect, it } from 'vitest';
import { integerWords, normalize, speakable, splitClauses, splitSentences } from './speakable';

describe('integerWords', () => {
  it.each([
    [0, 'không'],
    [5, 'năm'],
    [10, 'mười'],
    [11, 'mười một'],
    [14, 'mười bốn'],
    [15, 'mười lăm'],
    [21, 'hai mươi mốt'],
    [24, 'hai mươi tư'],
    [25, 'hai mươi lăm'],
    [105, 'một trăm lẻ năm'],
    [110, 'một trăm mười'],
    [1050, 'một nghìn không trăm năm mươi'],
    [2026, 'hai nghìn không trăm hai mươi sáu'],
    [1_250_000, 'một triệu hai trăm năm mươi nghìn'],
    [1_000_005, 'một triệu không trăm lẻ năm'],
    [3_000_000_000, 'ba tỷ'],
  ])('reads %d in Vietnamese', (n, words) => {
    expect(integerWords(n, 'vi')).toBe(words);
  });

  it.each([
    [0, 'zero'],
    [13, 'thirteen'],
    [42, 'forty-two'],
    [100, 'one hundred'],
    [1_250_000, 'one million two hundred fifty thousand'],
    [2026, 'two thousand twenty-six'],
  ])('reads %d in English', (n, words) => {
    expect(integerWords(n, 'en')).toBe(words);
  });

  it('leaves numbers too large to say as words, and non-integers', () => {
    expect(integerWords(10 ** 16, 'en')).toBeUndefined();
    expect(integerWords(1.5, 'vi')).toBeUndefined();
    expect(integerWords(-1, 'vi')).toBeUndefined();
  });
});

describe('normalize, Vietnamese', () => {
  it.each([
    ['Giá 1.250.000 đ', 'Giá một triệu hai trăm năm mươi nghìn đồng'],
    ['Giá 1.250.000đ một chiếc', 'Giá một triệu hai trăm năm mươi nghìn đồng một chiếc'],
    ['Phí 50.000 VND', 'Phí năm mươi nghìn đồng'],
    ['Ngày 25/10/2026 trời mưa', 'Ngày hai mươi lăm tháng mười năm hai nghìn không trăm hai mươi sáu trời mưa'],
    ['họp 01-04-2025', 'họp ngày một tháng tư năm hai nghìn không trăm hai mươi lăm'],
    ['vào ngày 2/9', 'vào ngày hai tháng chín'],
    ['chia 1/2 số tiền', 'chia một/hai số tiền'],
    ['Tăng 3,5 %', 'Tăng ba phẩy năm phần trăm'],
    ['tăng 12%', 'tăng mười hai phần trăm'],
    ['Đến TP.HCM hôm nay', 'Đến Thành phố Hồ Chí Minh hôm nay'],
    ['Ở Q.1 và P. 12', 'Ở quận một và phường mười hai'],
    ['Nguyễn P. Long', 'Nguyễn P. Long'],
    ['cam, táo, v.v. Sau đó', 'cam, táo, vân vân. Sau đó'],
    ['giá $5', 'giá năm đô la'],
    ['Xem https://example.com/a?b=1 để biết', 'Xem để biết'],
    ['COVID-19 năm 2020', 'COVID-mười chín năm hai nghìn không trăm hai mươi'],
    ['Giá 1.5 triệu đồng', 'Giá một phẩy năm triệu đồng'],
    ['IP 192.168.1.1', 'IP 192.168.1.1'],
    ['PGS.TS. Nguyễn Văn A', 'phó giáo sư tiến sĩ Nguyễn Văn A'],
  ])('%s', (input, out) => {
    expect(normalize(input, 'vi-VN')).toBe(out);
  });
});

describe('normalize, English', () => {
  it.each([
    ['It costs $5.', 'It costs five dollars.'],
    ['It costs $1.', 'It costs one dollar.'],
    ['$1.50, $2.00 and $1.01', 'one dollar and fifty cents, two dollars and one dollar and one cent'],
    ['a ratio of 1,5', 'a ratio of one point five'],
    ['raised $1.5 million', 'raised one point five million dollars'],
    ['about 1,250,000 people', 'about one million two hundred fifty thousand people'],
    ['up 3.5%', 'up three point five percent'],
    ['on 10/25/2026', 'on October twenty-fifth, twenty twenty-six'],
    ['on 25/10/2026', 'on October twenty-fifth, twenty twenty-six'],
    ['in 1999 and since 2005', 'in nineteen ninety-nine and since two thousand five'],
    ['Dr. Smith, e.g. here', 'Doctor Smith, for example here'],
    ['apples, pears, etc. Then', 'apples, pears, et cetera. Then'],
    ['No. 5 and no more', 'number five and no more'],
    ['see www.example.com now', 'see now'],
  ])('%s', (input, out) => {
    expect(normalize(input, 'en-US')).toBe(out);
  });

  it('only drops URLs and tidies spaces in other languages', () => {
    expect(normalize('Il a 25 ans  https://x.fr ici', 'fr')).toBe('Il a 25 ans ici');
  });
});

describe('splitSentences', () => {
  it('splits after . ! ? when a sentence follows', () => {
    expect(splitSentences('One. Two! Three? four')).toEqual(['One.', 'Two!', 'Three? four']);
  });

  it('keeps closing quotes and brackets with their sentence', () => {
    expect(splitSentences('He said "Stop." Then he left.')).toEqual(['He said "Stop."', 'Then he left.']);
    expect(splitSentences('Anh nói: “Dừng lại!” Rồi đi.')).toEqual(['Anh nói: “Dừng lại!”', 'Rồi đi.']);
    expect(splitSentences('(It was late.) We left.')).toEqual(['(It was late.)', 'We left.']);
  });

  it('keeps initials and an ellipsis before a lower-case word inside the sentence', () => {
    expect(splitSentences('J. Smith works in the U.S. Army. He is tall.')).toEqual(['J. Smith works in the U.S. Army.', 'He is tall.']);
    expect(splitSentences('Wait... she said. Then ran.')).toEqual(['Wait... she said.', 'Then ran.']);
  });

  it('ends a sentence after a one-letter word such as the particle ạ', () => {
    expect(splitSentences('Cảm ơn anh ạ. Em đi đây.')).toEqual(['Cảm ơn anh ạ.', 'Em đi đây.']);
  });

  it('splits Vietnamese sentences starting with an accented capital', () => {
    expect(splitSentences('Trời mưa. Đường ướt. Ông về.')).toEqual(['Trời mưa.', 'Đường ướt.', 'Ông về.']);
  });

  it('splits at line breaks and CJK stops, and drops pieces without letters or digits', () => {
    expect(splitSentences('Title\nBody text.\n\n— \n')).toEqual(['Title', 'Body text.']);
    expect(splitSentences('你好。再见！')).toEqual(['你好。', '再见！']);
  });
});

describe('splitClauses', () => {
  it('cuts a long sentence at a comma before the limit', () => {
    const s = `${'a'.repeat(30)}, ${'b'.repeat(30)}, ${'c'.repeat(30)}.`;
    expect(splitClauses(s, 50)).toEqual([`${'a'.repeat(30)},`, `${'b'.repeat(30)},`, `${'c'.repeat(30)}.`]);
  });

  it('cuts at a space when there is no punctuation, and never returns an empty clause', () => {
    const s = Array.from({ length: 30 }, () => 'word').join(' ');
    const clauses = splitClauses(s, 40);
    expect(clauses.every((c) => c.length > 0 && c.length <= 40)).toBe(true);
    expect(clauses.join(' ')).toBe(s);
  });

  it('leaves short sentences alone', () => {
    expect(splitClauses('Short one. Another.')).toEqual(['Short one.', 'Another.']);
  });
});

describe('speakable', () => {
  it('normalizes then splits', () => {
    expect(speakable('Giá tăng 3,5 %. Dr. Lan đến TP.HCM.', 'vi')).toEqual(['Giá tăng ba phẩy năm phần trăm.', 'Dr.', 'Lan đến Thành phố Hồ Chí Minh.']);
    expect(speakable('Dr. Lan arrived. It cost $5.', 'en')).toEqual(['Doctor Lan arrived.', 'It cost five dollars.']);
  });
});
