/**
 * Save a generated file, preferring the File System Access picker so the user
 * chooses the destination, and falling back to a download where it is missing.
 *
 * Extracted from the MIDI exporter when the second and third export paths
 * appeared — the picker typing and the fallback branch are fiddly enough that
 * three copies would drift.
 */
export type SaveOutcome = 'saved' | 'cancelled' | 'downloaded';

export type SaveOptions = {
  /** Suggested filename, including extension. */
  name: string;
  mime: string;
  /** Extension with the leading dot, e.g. '.json'. */
  extension: string;
  description: string;
};

export async function saveGeneratedFile(
  text: string,
  options: SaveOptions,
): Promise<SaveOutcome> {
  const bytes = new TextEncoder().encode(text);

  const picker = (
    window as unknown as {
      showSaveFilePicker?: (config: unknown) => Promise<{
        createWritable: () => Promise<{
          write: (data: Uint8Array) => Promise<void>;
          close: () => Promise<void>;
        }>;
      }>;
    }
  ).showSaveFilePicker;

  if (typeof picker === 'function') {
    try {
      const handle = await picker({
        suggestedName: options.name,
        types: [
          {
            description: options.description,
            accept: { [options.mime]: [options.extension] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();
      return 'saved';
    } catch (error) {
      // AbortError means the user closed the picker — not a failure.
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
      // Anything else (unsupported in this context) falls through to download.
    }
  }

  const blob = new Blob([bytes], { type: options.mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = options.name;
  anchor.click();
  URL.revokeObjectURL(url);
  return 'downloaded';
}

/** Strip characters that break filenames on Windows. */
export function safeFileName(input: string, fallback = 'flplens'): string {
  const cleaned = input
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}
