import { commandBasename, shellQuote } from './config.js';
import type { SessionSummary } from './types.js';

export const FIELD_SEPARATOR = '\u001f';

const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\)|[@-_])/g;

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, '');
}

export function trimBlankEdges(value: string): string {
  const lines = value.split('\n');
  while (lines.length > 0 && lines[0]?.trim() === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') lines.pop();
  return lines.join('\n');
}

export function capText(
  value: string,
  maxLines: number,
  maxBytes: number,
): { text: string; truncated: boolean } {
  let truncated = false;
  let lines = value.split('\n');
  if (lines.length > maxLines) {
    lines = lines.slice(-maxLines);
    truncated = true;
  }

  const kept: string[] = [];
  let bytes = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? '';
    const size = Buffer.byteLength(line, 'utf8') + 1;
    if (kept.length > 0 && bytes + size > maxBytes) {
      truncated = true;
      break;
    }
    kept.unshift(line);
    bytes += size;
  }

  return { text: kept.join('\n'), truncated };
}

export function statusVariableFor(command: string): '$?' | '$status' {
  return commandBasename(command) === 'fish' ? '$status' : '$?';
}

export function isSupportedShell(command: string): boolean {
  return ['bash', 'zsh', 'sh', 'fish', 'dash', 'ksh'].includes(commandBasename(command));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface ExtractedOutput {
  output: string;
  exitCode: number | null;
  foundStart: boolean;
  foundEnd: boolean;
}

export function extractMarkedOutput(raw: string, nonce: string): ExtractedOutput {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const startMarker = `__TMUX_MCP_START_${nonce}__`;
  const donePattern = new RegExp(`^__TMUX_MCP_DONE_${escapeRegExp(nonce)}__ rc=(-?\\d+)$`);

  let startIndex = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if ((lines[index] ?? '').trim() === startMarker) {
      startIndex = index;
      break;
    }
  }

  let endIndex = -1;
  let exitCode: number | null = null;
  const from = startIndex === -1 ? 0 : startIndex + 1;
  for (let index = from; index < lines.length; index += 1) {
    const match = donePattern.exec((lines[index] ?? '').trim());
    if (match) {
      endIndex = index;
      exitCode = Number(match[1]);
      break;
    }
  }

  const body =
    startIndex === -1
      ? lines.slice(0, endIndex === -1 ? lines.length : endIndex).join('\n')
      : lines.slice(startIndex + 1, endIndex === -1 ? lines.length : endIndex).join('\n');

  return {
    output: trimBlankEdges(stripAnsi(body)),
    exitCode,
    foundStart: startIndex !== -1,
    foundEnd: endIndex !== -1,
  };
}

export function parseSessionListOutput(
  stdout: string,
  options: { preview: boolean },
): SessionSummary[] {
  const sessions: SessionSummary[] = [];

  for (const rawLine of stdout.split('\n')) {
    if (!rawLine) continue;
    const parts = rawLine.split(FIELD_SEPARATOR);
    if (parts.length < 8) continue;

    const fields = parts.slice(0, 8).map((value) => value.trim());
    const [id, name, attached, windows, activity, cwd, owned, cmd] = fields;
    if (!id || !name) continue;

    let preview: string | null = null;
    if (options.preview) {
      const value = stripAnsi(parts.slice(8).join(FIELD_SEPARATOR))
        .replace(/\r/g, '')
        .trim();
      preview = value ? value.slice(0, 200) : null;
    }

    const activitySeconds = Number(activity);
    sessions.push({
      name,
      id,
      owned: owned === '1',
      attached: Number(attached) || 0,
      windows: Number(windows) || 0,
      cwd: cwd ?? '',
      cmd: cmd ?? '',
      activity: Number.isFinite(activitySeconds) && activitySeconds > 0
        ? new Date(activitySeconds * 1000).toISOString()
        : null,
      preview,
      attach_cmd: `tmux attach -t ${shellQuote(name)}`,
    });
  }

  return sessions;
}

export const SESSION_LIST_SCRIPT = `
set -u
tmux_bin=$1
socket=$2
format=$3
preview_enabled=$4

"$tmux_bin" -S "$socket" list-sessions -F "$format" | while IFS="$(printf '\\037')" read -r id name attached windows activity path owned; do
  pane=$("$tmux_bin" -S "$socket" display-message -p -t "$id" '#{pane_current_command}' 2>/dev/null)
  if [ "$preview_enabled" = "1" ]; then
    preview=$("$tmux_bin" -S "$socket" capture-pane -p -J -t "$id" -S 0 2>/dev/null | awk 'NF{last=$0} END{print last}')
  else
    preview=""
  fi
  printf '%s\\037%s\\037%s\\037%s\\037%s\\037%s\\037%s\\037%s\\037%s\\n' "$id" "$name" "$attached" "$windows" "$activity" "$path" "$owned" "$pane" "$preview"
done
`;

export const SESSION_LIST_FORMAT = [
  '#{session_id}',
  '#{session_name}',
  '#{session_attached}',
  '#{session_windows}',
  '#{session_activity}',
  '#{session_path}',
  '#{@tmux_mcp_owned}',
].join(FIELD_SEPARATOR);
