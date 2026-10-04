import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseOptions } from './ab.mjs';
import { summarizeComparison } from './ab-surveys.mjs';

const options = (...args) => parseOptions(['--soak', 'tailhold', ...args]);

test('repeatable environment entries preserve comma-valued tactics, JSON, equals and empty values', () => {
  const o = options('--env', 'AI_TACTICS=stalk=0,blindSpot=1', '--env', 'AUTOPLAY_HUMAN={"lag":0.3,"lead":0.8}',
    '--a', 'NOTE=a=b,c', '--a', 'EMPTY=', '--b', 'NOTE=other');
  assert.deepEqual(o.common, { AI_TACTICS: 'stalk=0,blindSpot=1', AUTOPLAY_HUMAN: '{"lag":0.3,"lead":0.8}' });
  assert.deepEqual(o.A, { NOTE: 'a=b,c', EMPTY: '' });
  assert.equal(o.B.NOTE, 'other');
});

test('flag comparison retains common comma-valued tactics with the variant taking precedence', () => {
  const o = options('--env', 'AI_TACTICS=blindSpot=0,stalk=1', '--flag', 'stalk');
  assert.equal(o.A.AI_TACTICS, 'blindSpot=0,stalk=1,stalk=0');
  assert.equal(o.B.AI_TACTICS, 'blindSpot=0,stalk=1,stalk=1');
});

test('inherited defence modes and tactics survive unless explicitly overridden', () => {
  const saved = { DEFENCE_AB: process.env.DEFENCE_AB, AI_TACTICS: process.env.AI_TACTICS };
  try {
    process.env.DEFENCE_AB = 'off';
    process.env.AI_TACTICS = 'blindSpot=0';
    const modes = parseOptions(['--soak', 'defence', '--b', 'DEFENCE_AB=mix']);
    assert.equal(modes.A.DEFENCE_AB, 'off');
    assert.equal(modes.B.DEFENCE_AB, 'mix');
    assert.equal(parseOptions(['--soak', 'defence', '--set', 'brake', '--b', 'DEFENCE_AB=mix']).A.DEFENCE_AB, 'brake');
    assert.equal(options('--flag', 'stalk').A.AI_TACTICS, 'blindSpot=0,stalk=0');
    assert.equal(options('--env', 'AI_TACTICS=blindSpot=1', '--flag', 'stalk').A.AI_TACTICS, 'blindSpot=1,stalk=0');
    process.env.AI_TACTICS = 'escalateDefence=0';
    assert.throws(() => parseOptions(['--soak', 'defence', '--b', 'DEFENCE_AB=mix']), /overwrites/);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('ambiguous duplicates, invalid keys and overwritten defence flags fail before launching', () => {
  assert.throws(() => options('--a', 'X=1', '--a', 'X=2'), /duplicate.*X/);
  assert.throws(() => options('--a', 'BAD KEY=x'), /KEY=VALUE/);
  assert.throws(() => options('--a', 'AI_TACTICS=stalk=0,AUTOPLAY_PILOT=human'), /repeat/);
  assert.throws(() => parseOptions(['--soak', 'defence', '--flag', 'escalateDefence']), /DEFENCE_AB/);
  assert.throws(() => options('--flag', 'stalk', '--set', 'default,typo'), /unknown.*set/);
  assert.equal(options('--flag', 'stalk').reps, 36);
  const modes = parseOptions(['--soak', 'defence', '--a', 'DEFENCE_AB=off', '--b', 'DEFENCE_AB=mix']);
  assert.equal(modes.A.DEFENCE_AB, 'off');
  assert.equal(modes.B.DEFENCE_AB, 'mix');
});

const compare = (soak, a, b = a, reps = 4) => summarizeComparison(soak, [
  { variant: 'A', tag: 'A-seed-', code: 0, text: a },
  { variant: 'B', tag: 'B-seed-', code: 0, text: b },
], { reps });

test('missing, malformed, empty and mismatched summaries cannot look like a successful comparison', () => {
  assert.throws(() => compare('quick', 'RATES missions=4 killedCaptured=1 coll=NaN playerColl=0'), /coll/);
  assert.throws(() => compare('quick', 'RATES missions=0 killedCaptured=0 coll=0 playerColl=0'), /missions/);
  assert.throws(() => compare('fairness', 'fairness set=typo reps=4\nsetup | n | win%'), /no.*rows/);
  assert.throws(() => compare('fairness', 'one | 4 | 0% | 25% (1/0/0)', 'two | 4 | 0% | 25% (1/0/0)'), /setup.*differ/);
  assert.throws(() => compare('fairness', 'one | 3 | 0% | 0% (0/0/0)'), /expected 4/);
  assert.throws(() => summarizeComparison('quick', [
    { variant: 'A', tag: 'failed', code: 1, text: 'RATES missions=4 killedCaptured=1 coll=0 playerColl=0' },
    { variant: 'B', tag: 'ok', code: 0, text: 'RATES missions=4 killedCaptured=1 coll=0 playerColl=0' },
  ], { reps: 4 }), /failed.*exited/);
});

test('fairness uses exact fate counts, not rounded win percentages, for its existing intervals', () => {
  const text = compare('fairness', 'default | 4 | 33% | 50% (1/0/1)');
  assert.match(text, /50\.0%/);
  assert.match(text, /within noise/);
});

test('overlapping fairness sets do not multiply identical seeded samples', () => {
  const row = 'sopwith_camel v albatros_dv | 4 | 33% | 50% (1/0/1)';
  assert.equal(compare('fairness', `${row}\n${row}`), compare('fairness', row));
  assert.throws(() => compare('fairness', `${row}\n${row.replace('33%', '67%')}`), /conflicting.*row/);
});

test('raid exposes exact bomb and loss counts but preserves rounded success as descriptive evidence', () => {
  const text = compare('raid', 'raid set=default reps=4\nraid setup | n | dropped/carried\n' +
    'raid one | 4 | 8/16 (50%) | 3/8 (38%) | 2/8 | 33% | 2/12 (17%) | 0/0 | 1/12 | 1 (25%)');
  assert.match(text, /dropped\/carried.*8\/16/);
  assert.match(text, /on target\/dropped.*3\/8/);
  assert.match(text, /success.*33%/);
  assert.doesNotMatch(text, /within noise|differs|95%|verdict/);
  assert.throws(() => compare('raid', 'one | 4 | 8/16 (50%) | 3/8 (38%) | 2/8 | 33% | 2/12 (17%) | 0/0 | 1/12 | 5 (125%)'), /player down/);
  const collateral = compare('raid', 'raid one | 4 | 8/16 (50%) | 3/8 (38%) | 10/8 | 33% | 2/12 (17%) | 0/0 | 1/12 | 1 (25%)');
  assert.match(collateral, /ground destroyed\/objective targets.*10\/8/);
});

test('zero-drop raid reports retain zero counts without inventing a percentage', () => {
  const row = 'raid one | 4 | 0/16 (0%) | 0/0 (-) | 0/8 | 0% | 4/12 (33%) | 0/0 | 0/12 | 4 (100%)';
  const text = compare('raid', row);
  assert.match(text, /on target\/dropped \| 0\/0 \| 0\/0/);
  assert.throws(() => compare('raid', row.replace('0/0 (-)', '0/16 (-)')), /percentage/);
});

const defence = (mode, hits) => `defence veteran D.VII, Camel on its tail at 2,000 m, pursuer human-like, 4 seeds\n` +
  `  ${mode} flew 200 s, attacking 20 s, tail held 40 s (circling 75%, varied 25%, 1.25 kinds/episode over 4, longest 15 s), hits taken ${hits}, down 1/4, unhit crashes 0, pursuer fixed guns 8/40 (20%)\n` +
  `defence ace D.VII, Bristol on its tail at 300 m (the playtest report), pursuer human-like, 4 seeds\n` +
  `  ${mode} flew 200 s, attacking 20 s, tail held 40 s (circling 75%, varied 25%, 1.25 kinds/episode over 4, longest 15 s), hits taken ${hits}, down 1/4, unhit crashes 0, pursuer fixed guns 8/40 (20%)`;

test('defence compares survey modes on the same case, and rejects ordinary assertion-test output', () => {
  const text = compare('defence', defence('off', 12), defence('mix', 8));
  assert.match(text, /hits taken \(total\).*12.*8/);
  assert.match(text, /mode.*off.*mix/);
  assert.match(text, /pursuer.*human-like.*human-like/);
  assert.throws(() => compare('defence', defence('off', 12), defence('mix', 8).replaceAll('human-like', 'veteran autoplayer')), /pursuers differ/);
  assert.doesNotMatch(text, /within noise|verdict/);
  assert.throws(() => compare('defence', 'defence veteran D.VII\n  veteran pursuer, off: flew 200 s'), /survey/);
});

test('defence crash counts include both aircraft per seed', () => {
  const both = defence('off', 0).replaceAll('unhit crashes 0', 'unhit crashes 8');
  assert.match(compare('defence', both), /unhit crashes.*8.*8/);
  assert.throws(() => compare('defence', both.replaceAll('unhit crashes 8', 'unhit crashes 9')), /unhit crashes/);
});

const tail = (bucket = '') => 'tailhold set=default reps=4 AI_TACTICS=(default) player=veteran\n' +
  '== default (quick screen) (4 runs): player down 1, player crashed 0, crashes -, player fixed guns 3/40 (7.5%)\n' + bucket;
const bucket = '  german fokker_dvii | held 25 s/run | circle 80% | varied 20% | kinds/episode 1.20 (5) | flat 50% | bank 45 deg | dh -25 m/run | longest 40 s | stretches 5 | hits taken 1.5/run (0.06/s) | states: defend break 80% (0.06 hits/s)';

test('tailhold keeps rounded hold metrics descriptive and absent buckets explicitly unobserved', () => {
  const text = compare('tailhold', tail(bucket), tail());
  assert.match(text, /held s\/run.*25.*not observed/);
  assert.match(text, /fixed gun hits\/rounds.*3\/40/);
  assert.doesNotMatch(text, /within noise|verdict|95%/);
  assert.throws(() => compare('tailhold', tail(bucket), tail().replace('default (quick screen)', 'other')), /setup.*differ/);
  assert.match(text, /pursuer.*veteran.*veteran/);
  assert.throws(() => compare('tailhold', tail(bucket), tail().replace('player=veteran', 'player=human-like')), /pursuers differ/);
  assert.throws(() => compare('tailhold', tail(bucket.replace('held 25', 'held NaN'))), /held/);
  const unarmed = tail().replace('3/40 (7.5%)', '0/0 (-%)');
  assert.match(compare('tailhold', unarmed), /fixed gun hits\/rounds.*0\/0/);
});
