import { describe, expect, it, vi } from 'vitest';
import { createAudioFeatures } from '../audio/features';
import { VIBES } from '../audio/mood';
import { AutoDirector, moodOf, nextShow, type ShowMood } from './AutoDirector';
import { chordOf, circleOfFifths, harmonicCentre } from './harmony';
import { SceneDirector } from './SceneDirector';
import { CHLADNI_MODES, SHAPE, sceneByKey } from './scenes';

// Dev-only debug hooks in these modules write to window as they load.
vi.hoisted(() => {
  Object.assign(globalThis, { window: {} });
});

const DT = 1 / 60;

function run(seconds: number, step: (time: number) => void): void {
  for (let t = 0; t < seconds; t += DT) step(t);
}

describe('Morph timing', () => {
  it('opens on the knot, not another sphere', () => {
    const director = new SceneDirector(sceneByKey('morph'));
    expect(director.toShape).toBe(SHAPE.torusKnot);
  });

  it('with a locked tempo, changes shape every 16 beats, on the beat', () => {
    const director = new SceneDirector(sceneByKey('morph'));
    const audio = createAudioFeatures();
    audio.tempoConfidence = 1;
    audio.bpm = 120;
    let changes = 0;
    let shape = director.toShape;
    run(32, (t) => {
      audio.beatIndex = Math.floor(t * 2);
      director.update(DT, audio);
      if (director.toShape !== shape) {
        shape = director.toShape;
        changes++;
      }
    });
    expect(changes).toBe(3); // 64 beats
  });

  it('waits for the 1 once the bar is known', () => {
    const director = new SceneDirector(sceneByKey('morph'));
    const audio = createAudioFeatures();
    audio.tempoConfidence = 1;
    audio.bpm = 120;
    audio.barConfidence = 1;
    let shape = director.toShape;
    const landed: number[] = [];
    run(32, (t) => {
      audio.beatIndex = Math.floor(t * 2);
      audio.barBeat = (audio.beatIndex + 1) % 4;
      director.update(DT, audio);
      if (director.toShape !== shape) {
        shape = director.toShape;
        landed.push(audio.barBeat);
      }
    });
    expect(landed.length).toBeGreaterThan(1);
    expect(landed.every((beat) => beat === 0)).toBe(true);
  });

  it('without a pulse, follows the harmony instead', () => {
    const director = new SceneDirector(sceneByKey('morph'));
    const audio = createAudioFeatures();
    audio.tempoConfidence = 0.2;
    audio.pitchConfidence = 0.6;
    const start = director.toShape;
    run(5.5, () => director.update(DT, audio));
    expect(director.toShape).toBe(start);
    audio.harmonyCount++;
    director.update(DT, audio);
    expect(director.toShape).not.toBe(start);
  });

  it('holds still in silence', () => {
    const director = new SceneDirector(sceneByKey('morph'));
    const audio = createAudioFeatures();
    audio.gate = 0;
    audio.live = true;
    const start = director.toShape;
    run(30, () => director.update(DT, audio));
    expect(director.toShape).toBe(start);
  });
});

describe('Cymatics modes', () => {
  it('moves to the mode of a held pitch', () => {
    const director = new SceneDirector(sceneByKey('cymatics'));
    const audio = createAudioFeatures();
    audio.gate = 1;
    audio.pitchConfidence = 0.7;
    audio.pitchClass = 9;
    run(2.5, () => director.update(DT, audio));
    expect(director.modeTo).toEqual(CHLADNI_MODES[9]);
    expect(director.modeMix).toBe(1);
  });

  it('does not chase every passing note', () => {
    const director = new SceneDirector(sceneByKey('cymatics'));
    const audio = createAudioFeatures();
    audio.gate = 1;
    audio.pitchConfidence = 0.7;
    let changes = 0;
    let mode = director.modeTo;
    run(6, (t) => {
      audio.pitchClass = Math.floor(t * 10) % 12;
      director.update(DT, audio);
      if (director.modeTo !== mode) {
        mode = director.modeTo;
        changes++;
      }
    });
    expect(changes).toBeLessThanOrEqual(5);
  });
});

describe('Word on a drop', () => {
  const nebula = sceneByKey('nebula');

  function flashing() {
    const director = new SceneDirector(sceneByKey('terrain'));
    const audio = createAudioFeatures();
    audio.gate = 1;
    director.flashWord(nebula, 0);
    return { director, audio };
  }

  it('takes over quickly, as the word itself', () => {
    const { director, audio } = flashing();
    expect(director.toShape).toBe(SHAPE.text);
    expect(director.toScene).toBe(sceneByKey('morph').id);
    run(0.4, () => director.update(DT, audio));
    expect(director.sceneMix).toBe(1);
  });

  it('stays long enough to be read, even if a snare lands straight away', () => {
    const { director, audio } = flashing();
    run(0.5, () => director.update(DT, audio));
    audio.snareCount = 1;
    run(0.5, () => director.update(DT, audio));
    expect(director.wordFlash).toBe(true);
  });

  it('breaks apart on the next snare, and goes where it was sent', () => {
    const { director, audio } = flashing();
    run(1.8, () => director.update(DT, audio));
    expect(director.wordFlash).toBe(true);
    audio.snareCount = 1;
    director.update(DT, audio);
    expect(director.wordFlash).toBe(false);
    expect(director.shatter).toBeGreaterThan(0.9);
    expect(director.toScene).toBe(nebula.id);
  });

  it('never waits forever for a snare that doesn’t come', () => {
    const { director, audio } = flashing();
    run(4.2, () => director.update(DT, audio));
    expect(director.wordFlash).toBe(false);
  });

  it('holds a word formed in the climb until the drop smashes it', () => {
    const director = new SceneDirector(nebula);
    const audio = createAudioFeatures();
    director.flashWord(nebula, 0, true);
    audio.snareCount = 3;
    for (let i = 0; i < 300; i++) director.update(1 / 60, audio);
    expect(director.wordFlash).toBe(true);
    audio.impact = 1;
    director.update(1 / 60, audio);
    expect(director.wordFlash).toBe(false);
    expect(director.shatter).toBeGreaterThan(0.9);
  });

  it('gives up on a drop that never comes', () => {
    const director = new SceneDirector(nebula);
    const audio = createAudioFeatures();
    director.flashWord(nebula, 0, true);
    for (let i = 0; i < 60 * 15; i++) director.update(1 / 60, audio);
    expect(director.wordFlash).toBe(false);
  });

  it('holds a scene chosen meanwhile until the word has gone', () => {
    const { director, audio } = flashing();
    const cymatics = sceneByKey('cymatics');
    director.setScene(cymatics);
    expect(director.toScene).toBe(sceneByKey('morph').id);
    run(4.2, () => director.update(DT, audio));
    expect(director.toScene).toBe(cymatics.id);
  });

  it('gives Morph its own shape back', () => {
    const director = new SceneDirector(sceneByKey('morph'));
    const audio = createAudioFeatures();
    audio.gate = 1;
    const shape = director.toShape;
    director.flashWord(sceneByKey('morph'), 0);
    run(4.2, () => director.update(DT, audio));
    expect(director.toShape).toBe(shape);
  });
});

describe('Chords', () => {
  const chroma = (...notes: number[]) => {
    const out = new Float32Array(12);
    for (const note of notes) out[note] = 1;
    return out;
  };

  it('tells major from minor, even when the loudest note isn’t the root', () => {
    const major = chroma(0, 4, 7);
    expect(chordOf(major).root).toBe(0);
    expect(chordOf(major).colour).toBeGreaterThan(0.2);
    const minor = chroma(9, 0, 4);
    minor[4] = 1.5;
    expect(chordOf(minor).root).toBe(9);
    expect(chordOf(minor).colour).toBeLessThan(-0.2);
  });

  it('calls silence neither', () => {
    expect(chordOf(new Float32Array(12)).colour).toBe(0);
  });

  it('places related chords close together, and distant ones apart', () => {
    const c = harmonicCentre(chroma(0, 4, 7), { x: 0, y: 0 });
    const am = harmonicCentre(chroma(9, 0, 4), { x: 0, y: 0 });
    const fSharp = harmonicCentre(chroma(6, 10, 1), { x: 0, y: 0 });
    const apart = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y);
    expect(apart(c, am)).toBeLessThan(apart(c, fSharp));
  });

  it('moves smoothly as one note of a chord changes', () => {
    const before = harmonicCentre(chroma(0, 4, 7), { x: 0, y: 0 });
    const shifted = chroma(0, 4, 7);
    shifted[9] = 0.3;
    const after = harmonicCentre(shifted, { x: 0, y: 0 });
    expect(Math.hypot(before.x - after.x, before.y - after.y)).toBeLessThan(0.1);
  });
});

describe('circleOfFifths', () => {
  const distance = (a: number, b: number) => {
    const p = circleOfFifths(a);
    const q = circleOfFifths(b);
    return Math.hypot(p.x - q.x, p.y - q.y);
  };

  it('keeps related keys close and distant keys far', () => {
    expect(distance(0, 7)).toBeLessThan(distance(0, 2));
    expect(distance(0, 2)).toBeLessThan(distance(0, 6));
  });

  it('tells every pitch class apart', () => {
    for (let a = 0; a < 12; a++) {
      for (let b = a + 1; b < 12; b++) expect(distance(a, b)).toBeGreaterThan(0.5);
    }
  });
});

describe('AutoDirector', () => {
  const steady = () => {
    const audio = createAudioFeatures();
    audio.gate = 1;
    audio.loudnessDb = -20;
    return audio;
  };

  it('changes every 32 beats when locked', () => {
    const auto = new AutoDirector();
    const audio = steady();
    audio.tempoConfidence = 1;
    const times: number[] = [];
    run(70, (t) => {
      audio.beatIndex = Math.floor(t * 2);
      if (auto.update(DT, audio)) times.push(t);
    });
    expect(times.length).toBeGreaterThanOrEqual(3);
    const [first = 0, second = 0] = times;
    expect(second - first).toBeCloseTo(16, 0);
  });

  it('jumps on a drop, but never sooner than the minimum hold', () => {
    const auto = new AutoDirector();
    const audio = steady();
    let fired = false;
    run(20, () => (fired = auto.update(DT, audio) || fired));
    fired = false;
    audio.loudnessDb = -8;
    run(1.5, () => (fired = auto.update(DT, audio) || fired));
    expect(fired).toBe(true);
    fired = false;
    audio.loudnessDb = -30;
    run(5, () => (fired = auto.update(DT, audio) || fired));
    expect(fired).toBe(false);
  });

  it('stops the clock during silence', () => {
    const auto = new AutoDirector();
    const audio = steady();
    audio.gate = 0;
    let fired = false;
    run(120, () => (fired = auto.update(DT, audio) || fired));
    expect(fired).toBe(false);
  });

  it('calls a breath ending in a kick a drop', () => {
    const auto = new AutoDirector();
    const audio = steady();
    run(20, () => auto.update(DT, audio));
    audio.impact = 1;
    expect(auto.update(DT, audio)).toBe(true);
    expect(auto.drop).toBe(true);
  });

  it('lets a real drop through right after a routine change', () => {
    const auto = new AutoDirector();
    const audio = steady();
    audio.tempoConfidence = 1;
    let changed = -1;
    run(17, (t) => {
      audio.beatIndex = Math.floor(t * 2);
      if (auto.update(DT, audio)) changed = t;
    });
    expect(changed).toBeGreaterThan(15);
    run(1, () => auto.update(DT, audio));
    audio.impact = 1;
    expect(auto.update(DT, audio)).toBe(true);
    expect(auto.takeWord()).toBe(true);
  });

  it('spells the word once, then rests', () => {
    const auto = new AutoDirector();
    const audio = steady();
    run(20, () => auto.update(DT, audio));
    audio.loudnessDb = -8;
    let fired = false;
    run(1.5, () => (fired = auto.update(DT, audio) || fired));
    expect(fired).toBe(true);
    expect(auto.takeWord()).toBe(true);
    audio.loudnessDb = -20;
    run(20, () => auto.update(DT, audio));
    audio.loudnessDb = -8;
    fired = false;
    run(1.5, () => (fired = auto.update(DT, audio) || fired));
    expect(fired).toBe(true);
    expect(auto.drop).toBe(true);
    expect(auto.takeWord()).toBe(false);
  });

  // Short-term loudness spikes on every hit, which used to read as a new section each time.
  it('doesn’t mistake kicks for a drop', () => {
    const auto = new AutoDirector();
    const audio = steady();
    let fired = false;
    run(20, (t) => {
      audio.loudnessDb = t % 0.5 < 0.12 ? -14 : -28;
      if (t > 13) fired = auto.update(DT, audio) || fired;
      else auto.update(DT, audio);
    });
    expect(fired).toBe(false);
  });

  it('doesn’t mistake a new track for a drop', () => {
    const auto = new AutoDirector();
    const audio = steady();
    audio.loudnessDb = -35;
    run(20, () => auto.update(DT, audio));
    auto.newTrack();
    audio.loudnessDb = -10;
    let changed = false;
    run(1, () => (changed = auto.update(DT, audio) || changed));
    expect(changed).toBe(false);
  });

  it('keeps words for drops, not breakdowns', () => {
    const auto = new AutoDirector();
    const audio = steady();
    run(20, () => auto.update(DT, audio));
    audio.loudnessDb = -40;
    let fired = false;
    run(1.5, () => (fired = auto.update(DT, audio) || fired));
    expect(fired).toBe(true);
    expect(auto.takeWord()).toBe(false);
  });

  describe('Mood', () => {
    const tally = (mood: ShowMood) => {
      const scenes = new Set<string>();
      const palettes = new Set<string>();
      for (let i = 0; i < 400; i++) {
        const show = nextShow('sphere', 'mercury', mood, () => (i * 0.61803) % 1);
        scenes.add(show.scene);
        palettes.add(show.palette);
      }
      return { scenes, palettes };
    };

    it('reads the music', () => {
      const audio = steady();
      audio.tempoConfidence = 0.2;
      expect(moodOf(audio)).toBe('ambient');
      audio.tempoConfidence = 1;
      expect(moodOf(audio, true)).toBe('heavy');
      audio.vibe = VIBES.indexOf('Melodic drift');
      expect(moodOf(audio)).toBe('smooth');
      audio.vibe = VIBES.indexOf('Heavy groove');
      expect(moodOf(audio)).toBe('heavy');
      audio.vibe = VIBES.indexOf('Listening');
      expect(moodOf(audio)).toBe('open');
    });

    it('keeps beatless music off rigid grids', () => {
      expect([...tally('ambient').scenes].sort()).toEqual(['cymatics', 'nebula']);
    });

    it('never cuts a smooth groove to neon, or a drop to grey', () => {
      expect(tally('smooth').palettes.has('cyber')).toBe(false);
      expect(tally('heavy').palettes.has('mercury')).toBe(false);
    });

    it('still leaves somewhere to go when the look already matches', () => {
      for (const r of [0, 0.5, 0.99]) {
        const next = nextShow('nebula', 'aurora', 'ambient', () => r);
        expect(next.scene).toBe('cymatics');
        expect(next.palette).not.toBe('aurora');
      }
    });
  });

  it('always moves to a different scene and palette', () => {
    for (const r of [0, 0.5, 0.99]) {
      const next = nextShow('nebula', 'aurora', 'open', () => r);
      expect(next.scene).not.toBe('nebula');
      expect(next.palette).not.toBe('aurora');
    }
  });
});
