let scenarioCalls = 0;
export default async function ({ load, input }) {
  scenarioCalls++;
  input ??= {};
  if (input.mode === 'throw') throw new Error('scenario exploded');
  if (input.mode === 'exit') process.exit(7);
  if (input.mode === 'late-exit') process.on('exit', () => process.exit(9));
  if (input.mode === 'no-result') await new Promise(() => {});
  if (input.mode === 'hang') await new Promise(() => { setInterval(() => {}, 1000); });
  if (input.mode === 'nan') return { value: NaN };
  if (input.mode === 'infinity') return { value: Infinity };
  if (input.mode === 'specials') return [NaN, Infinity, -Infinity, -0];
  if (input.mode === 'echo') return { value: input.value };
  if (input.mode === 'negative-zero') return { value: -0 };
  if (input.mode === 'undefined') return { value: undefined };
  if (input.mode === 'array-subclass') {
    class Samples extends Array { get units() { return 'm'; } }
    return new Samples(1, 2);
  }
  const first = await load('state.ts');
  if (input.mode === 'signed-zero') return { value: first.signedZero };
  if (input.mode === 'nan-null') return { value: first.notANumber };
  const second = await load('state.ts');
  const cold = first.initialized();
  first.warmup();
  const warm = second.initialized();
  input.calls = (input.calls ?? 0) + 1;
  return { scenarioCalls, inputCalls: input.calls, cold, warm, observations: [first.observe(), second.observe()] };
}
