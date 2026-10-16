import { motionFor } from './pitch-scene';

describe('pitch scene', () => {
  it('maps every outcome to the planned motion', () => {
    expect(motionFor('k')).toBe('miss');
    expect(motionFor('bb')).toBe('take');
    expect(motionFor('hbp')).toBe('hbp');
    expect(motionFor('oip')).toBe('out');
    for (const o of ['single', 'double', 'triple', 'hr'] as const) expect(motionFor(o)).toBe('hit');
  });
});
