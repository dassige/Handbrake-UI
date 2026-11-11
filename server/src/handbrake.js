import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';

const execFileP = promisify(execFile);

/**
 * Splits HandBrakeCLI --json stdout into JSON blocks.
 * HandBrakeCLI prints e.g. "Progress: {" ... "}" (pretty-printed, closing brace
 * at column 0) and "JSON Title Set: {" ... "}". Any other line is plain text.
 */
export class JsonBlockParser {
  constructor({ onBlock, onText }) {
    this.onBlock = onBlock;
    this.onText = onText ?? (() => {});
    this.pending = '';
    this.label = null;
    this.lines = [];
  }

  push(chunk) {
    this.pending += chunk;
    let nl;
    while ((nl = this.pending.indexOf('\n')) >= 0) {
      const line = this.pending.slice(0, nl).replace(/\r$/, '');
      this.pending = this.pending.slice(nl + 1);
      this.line(line);
    }
  }

  line(line) {
    if (this.label === null) {
      const m = /^(Progress|JSON Title Set): (.*)$/.exec(line);
      if (!m) {
        this.onText(line);
        return;
      }
      this.label = m[1];
      this.lines = [m[2]];
    } else {
      this.lines.push(line);
    }
    if (this.lines.length === 1 ? this.lines[0].endsWith('}') : line === '}') {
      const text = this.lines.join('\n');
      const label = this.label;
      this.label = null;
      this.lines = [];
      try {
        this.onBlock(label, JSON.parse(text));
      } catch {
        this.onText(`${label}: ${text}`);
      }
    }
  }
}

/**
 * The indented list that follows a "header" line in HandBrakeCLI --help, e.g. the
 * encoders under "Select video encoder:". Each item is alone on a line, indented by 20+ spaces.
 */
export function parseHelpList(text, header) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.includes(header));
  const items = [];
  for (let i = start + 1; start >= 0 && i < lines.length; i++) {
    const m = /^\s{20,}([A-Za-z0-9_:.-]+)\s*$/.exec(lines[i]);
    if (!m) break;
    items.push(m[1]);
  }
  return items;
}

/** The values printed by --encoder-preset-list (and the tune/profile/level lists). */
export function parseEncoderList(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^Available --encoder-\w+ values for/.test(l));
  if (start < 0) return null;
  const items = [];
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^ {4}(\S.*?)\s*$/.exec(lines[i]);
    if (!m) break;
    if (m[1] === 'Option not supported by encoder') return [];
    items.push(m[1]);
  }
  return items;
}

/**
 * The built-in presets printed by --preset-list: folders end with "/", presets are
 * indented one level (4 spaces) below their folder and their description one more.
 * Log lines from libhb are not indented and are skipped.
 */
export function parseBuiltinPresets(text) {
  const out = [];
  const folders = [];
  let last = null;
  for (const raw of text.split(/\r?\n/)) {
    const m = /^((?: {4})*)(\S.*?)\s*$/.exec(raw);
    if (!m) continue;
    const depth = m[1].length / 4;
    const line = m[2];
    if (line.endsWith('/') && depth <= folders.length && !line.startsWith('[')) {
      folders.length = depth;
      folders.push(line.slice(0, -1));
      last = null;
    } else if (depth > 0 && depth === folders.length) {
      last = { category: folders.join(' / '), name: line, description: '' };
      out.push(last);
    } else if (depth > 0 && depth === folders.length + 1 && last) {
      last.description = last.description ? `${last.description} ${line}` : line;
    }
  }
  return out;
}

export class HandBrake {
  constructor(cli) {
    this.cli = cli;
    this.capsPromise = null;
  }

  /** Runs HandBrakeCLI and returns stdout + stderr whatever the exit code; rejects only when it can't run. */
  async output(args, timeout = 30_000) {
    try {
      const { stdout, stderr } = await execFileP(this.cli, args, { maxBuffer: 8 << 20, timeout });
      return stdout + stderr;
    } catch (err) {
      if (err.code === 'ENOENT' || err.killed || err.stdout == null) throw err;
      return `${err.stdout}${err.stderr}`;
    }
  }

  /** Whether HandBrakeCLI can be run at all (cached). */
  available() {
    this.availablePromise ??= this.output(['--version']).then(
      () => true,
      (err) => {
        if (err.code !== 'ENOENT') this.availablePromise = null;
        return false;
      },
    );
    return this.availablePromise;
  }

  /**
   * What the installed HandBrakeCLI can do, for the preset editor: video encoders with their
   * presets, tunes, profiles and levels, audio encoders, containers and mixdowns.
   * Asked once (about 4 runs per video encoder) and cached; null when the CLI is missing.
   */
  capabilities() {
    this.capsPromise ??= this.readCapabilities().catch((err) => {
      this.capsPromise = null;
      if (err.code === 'ENOENT') return null;
      throw err;
    });
    return this.capsPromise;
  }

  async readCapabilities() {
    const help = await this.output(['--help']);
    const version = /HandBrake\s+(\S+)/.exec(await this.output(['--version']))?.[1] ?? 'unknown';
    const videoNames = parseHelpList(help, 'Select video encoder:');
    const kinds = ['preset', 'tune', 'profile', 'level'];
    const tasks = videoNames.flatMap((name) => kinds.map((kind) => ({ name, kind })));
    const results = new Map();
    // A few at a time: each run initialises libhb, which probes the GPUs.
    let next = 0;
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        while (next < tasks.length) {
          const t = tasks[next++];
          const list = parseEncoderList(await this.output([`--encoder-${t.kind}-list`, t.name]));
          results.set(`${t.name}:${t.kind}`, list ?? []);
        }
      }),
    );
    return {
      source: 'handbrake',
      version,
      videoEncoders: videoNames.map((name) => ({
        name,
        presets: results.get(`${name}:preset`),
        tunes: results.get(`${name}:tune`),
        profiles: results.get(`${name}:profile`),
        levels: results.get(`${name}:level`),
      })),
      audioEncoders: parseHelpList(help, 'Select audio encoder(s):'),
      containers: parseHelpList(help, 'Select container format:'),
      mixdowns: parseHelpList(help, 'Format(s) for audio downmixing/upmixing:'),
    };
  }

  /** HandBrake's built-in presets ({ category, name, description }), or null when the CLI is missing. */
  async builtinPresets() {
    try {
      return parseBuiltinPresets(await this.output(['--preset-list']));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  /**
   * Writes preset `name` (built in, or from importFile) as HandBrake exports it: upgraded to
   * this version's format, with every setting filled in. Returns the parsed export file.
   */
  async exportPreset({ name, importFile, outFile }) {
    const args = [];
    if (importFile) args.push('--preset-import-file', importFile);
    args.push('--preset', name, '--preset-export', name, '--preset-export-file', outFile);
    const text = await this.output(args);
    let data;
    try {
      data = JSON.parse(await fs.promises.readFile(outFile, 'utf8'));
    } catch {
      const reason = /^.*(?:invalid|error|failed).*$/im.exec(text)?.[0]?.trim();
      throw new Error(reason || `HandBrakeCLI could not export preset "${name}"`);
    }
    if (!Array.isArray(data?.PresetList) || !data.PresetList[0]) throw new Error('HandBrakeCLI wrote an empty preset file');
    return data;
  }

  /** Version string and video encoders, or { error } when the CLI is missing. */
  async info() {
    try {
      const opts = { maxBuffer: 4 << 20, timeout: 30_000 };
      const v = await execFileP(this.cli, ['--version'], opts);
      const version = /HandBrake\s+(\S+)/.exec(v.stdout + v.stderr)?.[1] ?? 'unknown';
      // --help lists only the encoders usable on this machine (e.g. qsv_* when Quick Sync works).
      const h = await execFileP(this.cli, ['--help'], opts);
      const lines = (h.stdout + h.stderr).split('\n');
      const start = lines.findIndex((l) => l.includes('Select video encoder:'));
      const encoders = [];
      for (let i = start + 1; start >= 0 && i < lines.length; i++) {
        const m = /^\s{20,}([A-Za-z0-9_]+)\s*$/.exec(lines[i]);
        if (!m) break;
        encoders.push(m[1]);
      }
      return { version, encoders };
    } catch (err) {
      return { error: err.code === 'ENOENT' ? `${this.cli} not found` : err.message };
    }
  }

  /**
   * Checks that HandBrakeCLI can load a preset file. Returns null when OK or
   * the CLI is not installed (development), otherwise an error message.
   */
  async validatePresetFile(file) {
    try {
      const { stdout, stderr } = await execFileP(
        this.cli,
        ['--preset-import-file', file, '--preset-list'],
        { maxBuffer: 8 << 20, timeout: 30_000 },
      );
      const text = stdout + stderr;
      const err = /^(.*(?:error|failed|invalid).*)$/im.exec(text);
      if (err && !/^\s*\+/.test(err[1])) return err[1].trim();
      return null;
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      return (err.stderr || err.message || 'Preset import failed').toString().trim().split('\n').pop();
    }
  }

  /** Scans a source file and returns a compact description of it. */
  scan(input, { timeoutMs = 180_000 } = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(this.cli, ['--json', '--scan', '--previews', '1:0', '-i', input], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let titleSet = null;
      let errText = '';
      const parser = new JsonBlockParser({
        onBlock: (label, data) => {
          if (label === 'JSON Title Set') titleSet = data;
        },
      });
      child.stdout.setEncoding('utf8').on('data', (d) => parser.push(d));
      child.stderr.setEncoding('utf8').on('data', (d) => {
        errText = (errText + d).slice(-4000);
      });
      const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', () => {
        clearTimeout(timer);
        const title = titleSet?.TitleList?.[0];
        if (!title) {
          const reason = /No title found|ERROR[^\n]*/.exec(errText)?.[0] ?? 'Scan failed';
          reject(new Error(reason));
          return;
        }
        resolve(summarizeTitle(title));
      });
    });
  }

  /**
   * Starts an encode. Returns the child process; events are delivered through
   * the callbacks. onExit(code, signal) is called once.
   */
  encode({ presetFile, presetName, input, output, format, nice, logFile, onProgress, onExit }) {
    const args = [
      '--json',
      '--preset-import-file', presetFile,
      '--preset', presetName,
      '-i', input,
      '-o', output,
      '--format', format,
    ];
    const useNice = process.platform !== 'win32' && nice > 0;
    const cmd = useNice ? 'nice' : this.cli;
    const cmdArgs = useNice ? ['-n', String(nice), this.cli, ...args] : args;

    const log = fs.createWriteStream(logFile, { flags: 'a' });
    log.write(`# ${new Date().toISOString()} ${this.cli} ${args.map(quote).join(' ')}\n`);

    const child = spawn(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    const parser = new JsonBlockParser({
      onBlock: (label, data) => {
        if (label === 'Progress') onProgress(data);
      },
      onText: (line) => {
        if (line.trim()) log.write(line + '\n');
      },
    });
    child.stdout.setEncoding('utf8').on('data', (d) => parser.push(d));
    child.stderr.on('data', (d) => log.write(d));

    let finished = false;
    const finish = (code, signal, err) => {
      if (finished) return;
      finished = true;
      if (err) log.write(`\n# failed to start: ${err.message}\n`);
      log.write(`\n# exit code=${code} signal=${signal ?? ''}\n`);
      log.end(() => onExit(code, signal, err));
    };
    child.on('error', (err) => finish(-1, null, err));
    child.on('close', (code, signal) => finish(code, signal));
    return child;
  }
}

function quote(a) {
  return /^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`;
}

function summarizeTitle(t) {
  const d = t.Duration ?? {};
  const seconds = (d.Hours ?? 0) * 3600 + (d.Minutes ?? 0) * 60 + (d.Seconds ?? 0);
  const fr = t.FrameRate;
  return {
    container: t.Container,
    duration: seconds,
    width: t.Geometry?.Width,
    height: t.Geometry?.Height,
    fps: fr?.Den ? Math.round((fr.Num / fr.Den) * 1000) / 1000 : null,
    videoCodec: t.VideoCodec,
    audio: (t.AudioList ?? []).map((a) => ({
      lang: a.LanguageCode ?? a.Language,
      description: a.Description,
      codec: a.CodecName,
      channels: a.ChannelCount,
    })),
    subtitles: (t.SubtitleList ?? []).map((s) => ({
      lang: s.LanguageCode ?? s.Language,
      format: s.SourceName,
    })),
    chapters: t.ChapterList?.length ?? 0,
  };
}
