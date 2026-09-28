import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { parseRosterPaste } from '../src/lib/bulkparse.js';
import { loadHeroes } from '../src/lib/heroes.js';
import { loadGame } from '../src/lib/game.js';

const parse = (text) => parseRosterPaste(text);
const ids = (result) => result.applied.map((a) => a.heroId);

describe('parseRosterPaste', () => {
  before(() => {
    loadHeroes();
    loadGame();
  });

  describe('the basic shape', () => {
    it('reads name, level and prestige', () => {
      const { applied, errors } = parse('Wolverine 60 6');

      assert.deepEqual(errors, []);
      assert.equal(applied.length, 1);
      assert.deepEqual(applied[0], {
        line: 1,
        heroId: 'wolverine',
        name: 'Wolverine',
        level: 60,
        prestige: 6,
      });
    });

    it('treats a lone number as the level', () => {
      // "Thor 60" means level 60 — prestige 60 is not even valid.
      const [entry] = parse('Thor 60').applied;
      assert.equal(entry.level, 60);
      assert.equal(entry.prestige, null);
    });

    it('handles several lines', () => {
      const result = parse('Wolverine 60 6\nStorm 44 3\nThor 60');
      assert.deepEqual(errors_of(result), []);
      assert.deepEqual(ids(result), ['wolverine', 'storm', 'thor']);
    });

    it('ignores blank lines', () => {
      assert.equal(parse('\n\nThor 60\n\n\nStorm 44\n').applied.length, 2);
    });
  });

  // Hero names contain spaces, hyphens and digits, so values have to be read
  // from the END of the line. Splitting on the first space would mangle most
  // of the roster.
  describe('names that would break a naive parser', () => {
    it('handles multi-word names', () => {
      assert.deepEqual(ids(parse('Doctor Strange 60 5')), ['doctor_strange']);
      assert.deepEqual(ids(parse('Captain America 52 2')), ['captain_america']);
      assert.deepEqual(ids(parse('Mister Fantastic 41')), ['mister_fantastic']);
    });

    it('handles hyphenated names without eating the hyphen as a separator', () => {
      assert.deepEqual(ids(parse('Spider-Man 60 4')), ['spider_man']);
      assert.deepEqual(ids(parse('She-Hulk 33')), ['she_hulk']);
      assert.deepEqual(ids(parse('Star-Lord 60 1')), ['star_lord']);
    });

    it('handles a name containing digits', () => {
      const [entry] = parse('X-23 60 3').applied;
      assert.equal(entry.heroId, 'x_23');
      assert.equal(entry.level, 60);
      assert.equal(entry.prestige, 3);
    });

    it('handles a digit-name with only one value', () => {
      const [entry] = parse('X-23 45').applied;
      assert.equal(entry.heroId, 'x_23');
      assert.equal(entry.level, 45);
    });
  });

  describe('forgiving formats', () => {
    it('accepts commas, pipes and tabs as separators', () => {
      assert.deepEqual(ids(parse('Wolverine, 60, 6')), ['wolverine']);
      assert.deepEqual(ids(parse('Storm | 44 | 3')), ['storm']);
      assert.deepEqual(ids(parse('Thor\t60\t2')), ['thor']);
    });

    it('accepts a spaced hyphen as a separator but not one inside a name', () => {
      assert.deepEqual(ids(parse('Storm - 44 - 3')), ['storm']);
      assert.deepEqual(ids(parse('Spider-Man - 60')), ['spider_man']);
    });

    it('accepts Lv and P tags in any order', () => {
      const a = parse('Storm Lv44 P3').applied[0];
      assert.equal(a.level, 44);
      assert.equal(a.prestige, 3);

      const b = parse('Storm P3 Lv44').applied[0];
      assert.equal(b.level, 44);
      assert.equal(b.prestige, 3);
    });

    it('accepts prestige on its own when tagged', () => {
      const entry = parse('Storm p3').applied[0];
      assert.equal(entry.prestige, 3);
      assert.equal(entry.level, null);
    });

    it('accepts hero aliases', () => {
      assert.deepEqual(ids(parse('Spidey 60')), ['spider_man']);
      assert.deepEqual(ids(parse('Ms. Marvel 60')), ['captain_marvel']);
      assert.deepEqual(ids(parse('Mr Fantastic 60')), ['mister_fantastic']);
    });

    it('is case insensitive', () => {
      assert.deepEqual(ids(parse('WOLVERINE 60')), ['wolverine']);
      assert.deepEqual(ids(parse('doctor strange 60')), ['doctor_strange']);
    });

    it('skips heading and comment lines', () => {
      const result = parse('# my roster\nName Level\n---\nThor 60');
      assert.deepEqual(ids(result), ['thor']);
      assert.ok(result.skipped >= 2);
      assert.deepEqual(errors_of(result), []);
    });
  });

  // Joewin's choice: apply what works, report what does not. One typo must not
  // discard the whole paste.
  describe('bad lines are reported, not fatal', () => {
    it('keeps the good lines when one is wrong', () => {
      const result = parse('Wolverine 60 6\nBatman 60\nStorm 44');

      assert.deepEqual(ids(result), ['wolverine', 'storm']);
      assert.equal(result.errors.length, 1);
      assert.equal(result.errors[0].line, 2);
      assert.match(result.errors[0].reason, /not a hero I recognise/);
    });

    it('rejects a level above the cap', () => {
      const result = parse('Thor 99');
      assert.equal(result.applied.length, 0);
      assert.match(result.errors[0].reason, /outside 1–60/);
    });

    it('rejects a prestige above the top tier', () => {
      const result = parse('Thor 60 9');
      assert.match(result.errors[0].reason, /outside 0–6/);
    });

    it('rejects level zero', () => {
      assert.match(parse('Thor 0').errors[0].reason, /outside/);
    });

    // A bare name is ownership only — this is what makes the /roster text
    // export round-trip, since un-levelled heroes export as just a name.
    it('accepts a bare name as ownership with nothing recorded', () => {
      const result = parse('Thor');

      assert.deepEqual(result.errors, []);
      assert.equal(result.applied.length, 1);
      assert.equal(result.applied[0].heroId, 'thor');
      assert.equal(result.applied[0].level, null);
      assert.equal(result.applied[0].prestige, null);
    });

    it('rejects a duplicate hero and says where it first appeared', () => {
      const result = parse('Thor 60\nThor 44');

      assert.equal(result.applied.length, 1);
      assert.equal(result.applied[0].level, 60, 'the first line wins');
      assert.match(result.errors[0].reason, /already given on line 1/);
    });

    it('catches a duplicate reached via an alias', () => {
      const result = parse('Spider-Man 60\nSpidey 44');
      assert.equal(result.applied.length, 1);
      assert.match(result.errors[0].reason, /already given/);
    });

    it('rejects too many numbers', () => {
      assert.match(parse('Thor 60 3 2').errors[0].reason, /too many numbers/);
    });

    it('reports the original line text so the typo is findable', () => {
      const result = parse('Wolverine 60\n  Batmann 60  ');
      assert.equal(result.errors[0].text, 'Batmann 60');
    });

    // Partial names are refused rather than guessed — "cap" could be several.
    it('does not guess at a partial name', () => {
      assert.equal(parse('Wolv 60').applied.length, 0);
      assert.equal(parse('Doctor 60').applied.length, 0);
    });
  });

  describe('empty and junk input', () => {
    it('returns nothing for empty input', () => {
      for (const input of ['', '   ', '\n\n', null, undefined]) {
        const result = parse(input);
        assert.deepEqual(result.applied, []);
        assert.deepEqual(result.errors, []);
      }
    });

    it('survives a wall of nonsense without throwing', () => {
      const result = parse('!!!\n???\n12345\n\n@@@ 60');
      assert.ok(Array.isArray(result.applied));
      assert.ok(Array.isArray(result.errors));
    });
  });

  describe('a realistic paste', () => {
    it('handles a mixed-format roster', () => {
      const result = parse(
        [
          '# Jahkiel roster',
          'Doctor Strange 60 5',
          'Wolverine, 60, 6',
          'Spider-Man - Lv60 P4',
          'X-23 47',
          'Storm p2',
          'Thor 60',
          'Gambit 31 1',
        ].join('\n'),
      );

      assert.deepEqual(errors_of(result), []);
      assert.equal(result.applied.length, 7);
      assert.deepEqual(ids(result), [
        'doctor_strange',
        'wolverine',
        'spider_man',
        'x_23',
        'storm',
        'thor',
        'gambit',
      ]);
      assert.equal(result.applied[2].prestige, 4);
      assert.equal(result.applied[4].level, null, 'prestige-only line keeps level unset');
    });
  });
});

function errors_of(result) {
  return result.errors.map((e) => `line ${e.line}: ${e.reason}`);
}
