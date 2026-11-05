import { type ReactNode, useId } from 'react';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="studio-section">
      <h3 className="studio-section__title">{title}</h3>
      {children}
    </section>
  );
}

interface SliderProps {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}

const multiplier = (value: number) => `${value.toFixed(2)}×`;

/** Labelled range input. Double-click the label to reset to the default. */
export function Slider({
  label,
  hint,
  value,
  min,
  max,
  step,
  defaultValue,
  onChange,
  format = multiplier,
}: SliderProps) {
  const id = useId();
  const changed = value !== defaultValue;
  return (
    <div className="slider" data-changed={changed}>
      <div className="slider__row">
        <label
          htmlFor={id}
          title={hint ? `${hint} · double-click to reset` : 'Double-click to reset'}
          onDoubleClick={() => onChange(defaultValue)}
        >
          {label}
        </label>
        <output htmlFor={id}>{format(value)}</output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
      />
    </div>
  );
}

interface SegmentedProps<T extends string> {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  disabled?: boolean;
  onChange: (value: T) => void;
}

export function Segmented<T extends string>({
  label,
  options,
  value,
  disabled = false,
  onChange,
}: SegmentedProps<T>) {
  return (
    <div
      className="segmented"
      role="radiogroup"
      aria-label={label}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="toggle">
      <span>{label}</span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="toggle__track" aria-hidden="true" />
    </label>
  );
}
