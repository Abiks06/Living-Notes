import { describe, expect, it } from 'vitest';
import { GpuTimer } from './GpuTimer';

const TIME_ELAPSED_EXT = 1;
const GPU_DISJOINT_EXT = 2;
const QUERY_RESULT_AVAILABLE = 3;
const QUERY_RESULT = 4;

/** A fake context whose query results stay unavailable until `ready` is set. */
function fakeGl() {
  const state = { ready: false, disjoint: false, nanoseconds: 5_000_000 };
  const gl = {
    QUERY_RESULT_AVAILABLE,
    QUERY_RESULT,
    getExtension: () => ({ TIME_ELAPSED_EXT, GPU_DISJOINT_EXT }),
    createQuery: () => ({}),
    deleteQuery: () => undefined,
    beginQuery: () => undefined,
    endQuery: () => undefined,
    getParameter: () => state.disjoint,
    getQueryParameter: (_query: unknown, name: number) =>
      name === QUERY_RESULT_AVAILABLE ? state.ready : state.nanoseconds,
  };
  return { gl: gl as unknown as WebGL2RenderingContext, state };
}

function frame(timer: GpuTimer) {
  timer.begin();
  timer.end();
}

describe('GpuTimer', () => {
  it('reports milliseconds once results arrive', () => {
    const { gl, state } = fakeGl();
    const timer = new GpuTimer(gl);
    frame(timer);
    expect(timer.ms).toBeNull();
    state.ready = true;
    frame(timer);
    expect(timer.ms).toBe(5);
    expect(timer.samples).toBe(2);
  });

  it('recovers after the in-flight queue fills (it used to freeze forever)', () => {
    const { gl, state } = fakeGl();
    const timer = new GpuTimer(gl);
    for (let i = 0; i < 10; i++) frame(timer);
    expect(timer.samples).toBe(0);
    state.ready = true;
    frame(timer);
    expect(timer.samples).toBeGreaterThan(0);
    frame(timer);
    expect(timer.ms).toBe(5);
  });

  it('discards results from a disjoint period', () => {
    const { gl, state } = fakeGl();
    const timer = new GpuTimer(gl);
    frame(timer);
    state.disjoint = true;
    frame(timer);
    expect(timer.samples).toBe(0);
  });
});
