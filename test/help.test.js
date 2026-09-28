import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { HELP_SECTIONS } from '../src/commands/help.js';
import { loadCommands } from '../src/lib/commandLoader.js';

describe('/help stays in sync with the real commands', () => {
  let registered;
  let documented;

  before(async () => {
    registered = new Set((await loadCommands()).keys());
    documented = new Set(HELP_SECTIONS.flatMap((s) => s.items.map((i) => i.command)));
  });

  // The point of this file: adding a command without documenting it should
  // fail the suite rather than quietly shipping an incomplete /help.
  it('documents every registered command', () => {
    const missing = [...registered].filter((name) => name !== 'help' && !documented.has(name));
    assert.deepEqual(missing, [], `undocumented command(s): ${missing.join(', ')}`);
  });

  it('does not document commands that do not exist', () => {
    const phantom = [...documented].filter((name) => !registered.has(name));
    assert.deepEqual(phantom, [], `documented but not registered: ${phantom.join(', ')}`);
  });

  it('gives every entry a usage line and an explanation', () => {
    for (const section of HELP_SECTIONS) {
      assert.ok(section.title, 'section missing a title');
      assert.ok(section.items.length > 0, `${section.title} has no items`);

      for (const item of section.items) {
        assert.ok(item.usage?.startsWith('/'), `${item.command}: usage should start with /`);
        assert.ok(item.text?.length > 20, `${item.command}: explanation too thin`);
      }
    }
  });

  it('keeps each section inside Discord\'s 1024-character field limit', () => {
    for (const section of HELP_SECTIONS) {
      const rendered = section.items.map((i) => `**${i.usage}**\n${i.text}`).join('\n\n');
      assert.ok(
        rendered.length <= 1024,
        `${section.title} renders to ${rendered.length} chars, over the 1024 field limit`,
      );
    }
  });

  it('marks the admin section so members do not see it', () => {
    const adminSections = HELP_SECTIONS.filter((s) => s.adminOnly);
    assert.equal(adminSections.length, 1, 'expected exactly one officers-only section');
    assert.ok(adminSections[0].items.every((i) => i.command === 'admin'));
  });
});
