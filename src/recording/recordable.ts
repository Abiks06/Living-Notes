import type { ActiveSource } from '../state/appStore';

export const TAB_RECORDING_REASON = 'Clips can’t include audio shared from another tab.';

/** Another tab's audio belongs to whatever is playing there, so it never goes into a clip. */
export function canRecordClip(source: ActiveSource | null): boolean {
  return source?.kind !== 'tab';
}
