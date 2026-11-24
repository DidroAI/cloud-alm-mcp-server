/**
 * The questions the setup wizard asks, behind an interface so the wizard
 * can be tested without a terminal. The terminal version draws them with
 * @clack/prompts.
 */

export type Choice<T> = { value: T; label: string; hint?: string };

/** Every question answers `undefined` when the user cancels (Ctrl-C, Esc). */
export type Prompts = {
  intro(title: string): void;
  outro(text: string): void;
  cancel(text: string): void;
  note(text: string, title?: string): void;
  info(text: string): void;
  success(text: string): void;
  warn(text: string): void;
  error(text: string): void;
  select<T>(message: string, options: Choice<T>[]): Promise<T | undefined>;
  /** Tick boxes; an empty answer is allowed. */
  multiselect<T>(message: string, options: Choice<T>[], initial: T[]): Promise<T[] | undefined>;
  text(
    message: string,
    options?: { placeholder?: string; validate?: (value: string) => string | undefined },
  ): Promise<string | undefined>;
  /** A pasted secret, any number of lines, never shown. Empty when nothing was pasted. */
  secret(message: string): Promise<string | undefined>;
  /** Run `work` behind a spinner; `done` is what stays on screen. */
  spin<T>(message: string, work: () => Promise<T>, done: (result: T) => string): Promise<T>;
};

/**
 * Agents that run commands in a terminal of their own: they get no
 * questions. The variables are the ones each agent sets for its commands.
 */
const AGENT_ENV = [
  "AI_AGENT", "CLAUDECODE", "CLAUDE_CODE", "CODEX_SANDBOX", "CODEX_CI", "CODEX_THREAD_ID",
  "CURSOR_AGENT", "CURSOR_TRACE_ID", "GEMINI_CLI", "ANTIGRAVITY_AGENT", "AUGMENT_AGENT",
  "OPENCODE_CLIENT", "REPL_ID", "COPILOT_MODEL", "CI",
];

/** True when an agent or CI runs the command, whatever its terminal looks like. */
export const runByAgent = (env: Record<string, string | undefined>): boolean =>
  env.OPENCODE === "1" || env.CURSOR_EXTENSION_HOST_ROLE === "agent-exec" || AGENT_ENV.some((name) => env[name]?.trim());

/** True when a person can be asked: a terminal on both ends, and no agent or CI running the command. */
export function canAsk(
  env: Record<string, string | undefined>,
  stdinIsTTY: boolean,
  stdoutIsTTY: boolean,
): boolean {
  return stdinIsTTY && stdoutIsTTY && env.TERM !== "dumb" && !runByAgent(env);
}

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

/**
 * What a hidden paste has collected so far, fed one chunk of raw terminal
 * input at a time. A key is several lines, so a line break does not end
 * it: the paste ends when the terminal says so (bracketed paste), when the
 * text is complete JSON, or on Enter alone.
 */
export function pasteReader() {
  let text = "";
  return {
    /** `true`: finished; `false`: cancelled; `undefined`: keep reading. */
    feed(chunk: string): boolean | undefined {
      if (chunk === "\x03" || chunk === "\x1b") return false;
      const ended = chunk.includes(PASTE_END);
      const clean = chunk.split(PASTE_START).join("").split(PASTE_END).join("");
      if (clean === "\x04") return true;
      const enterAlone = clean === "\r" || clean === "\n" || clean === "\r\n";
      // Backspace and other control keys are ignored: nothing is on screen to edit.
      text += clean.replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
      if (ended || enterAlone) return true;
      try {
        JSON.parse(text);
        return true;
      } catch {
        return undefined;
      }
    },
    text: () => text.trim(),
  };
}

/** Read a pasted secret from the terminal without showing it. */
function readSecret(input: NodeJS.ReadStream, output: NodeJS.WriteStream): Promise<string | undefined> {
  return new Promise((done) => {
    const reader = pasteReader();
    const wasRaw = input.isRaw;
    const finish = (value: string | undefined) => {
      input.off("data", onData);
      output.write("\x1b[?2004l");
      input.setRawMode(wasRaw);
      input.pause();
      done(value);
    };
    const onData = (chunk: Buffer) => {
      const state = reader.feed(chunk.toString("utf8"));
      if (state !== undefined) finish(state ? reader.text() : undefined);
    };
    input.setRawMode(true);
    // Bracketed paste: the terminal marks where a paste starts and ends.
    output.write("\x1b[?2004h");
    input.resume();
    input.on("data", onData);
  });
}

/** The questions drawn in the terminal. */
export async function terminalPrompts(
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stdout,
): Promise<Prompts> {
  const p = await import("@clack/prompts");
  const answer = <T>(value: unknown): T | undefined => (p.isCancel(value) ? undefined : (value as T));
  const io = { input, output };
  return {
    intro: (title) => p.intro(title, { output }),
    outro: (text) => p.outro(text, { output }),
    cancel: (text) => p.cancel(text, { output }),
    note: (text, title) => p.note(text, title, { output, format: (line) => line }),
    info: (text) => p.log.message(text, { output }),
    success: (text) => p.log.success(text, { output }),
    warn: (text) => p.log.warn(text, { output }),
    error: (text) => p.log.error(text, { output }),
    select: async (message, options) => answer(await p.select({ message, options: options as never, ...io })),
    multiselect: async (message, options, initial) =>
      answer(await p.multiselect({ message, options: options as never, initialValues: initial, required: false, ...io })),
    text: async (message, options = {}) =>
      answer(
        await p.text({
          message,
          ...(options.placeholder ? { placeholder: options.placeholder } : {}),
          ...(options.validate ? { validate: (value) => options.validate?.(value ?? "") } : {}),
          ...io,
        }),
      ),
    secret: async (message) => {
      p.log.step(message, { output });
      const value = await readSecret(input, output);
      if (value) p.log.message(`Received ${value.length} characters (not shown).`, { output });
      return value;
    },
    spin: async (message, work, done) => {
      const s = p.spinner({ output });
      s.start(message);
      try {
        const result = await work();
        s.stop(done(result));
        return result;
      } catch (error) {
        s.error(message);
        throw error;
      }
    },
  };
}
