import { DEFAULT_WORD, sanitizeWord } from '../../settings/schema';
import { useSettings } from '../../settings/settingsStore';
import { Section } from './controls';

/** Your own word as a Morph shape. Typing it takes you straight there. */
export function MorphSection() {
  const word = useSettings((state) => state.word);
  const set = useSettings((state) => state.set);

  return (
    <Section title="Your word">
      <input
        className="word-input"
        type="text"
        value={word}
        placeholder={DEFAULT_WORD}
        aria-label="Word for the particles to form"
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => {
          set('word', sanitizeWord(event.currentTarget.value));
          set('scene', 'morph');
          set('morphShape', 'word');
        }}
      />
      <p className="studio-caption">Up to 16 characters. It travels with your share link.</p>
    </Section>
  );
}
