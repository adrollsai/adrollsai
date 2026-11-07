import { Sandbox } from '@e2b/code-interpreter';

function getE2BApiKey(): string {
  return (process.env.E2B_API_KEY || '').replace(/^["']|["']$/g, '').trim();
}

/**
 * Creates or runs code in an isolated E2B Cloud Sandbox.
 * Gives the agent a full Ubuntu/Linux MicroVM with root terminal access,
 * npm, pip, Python, Node, FFmpeg, and yt-dlp capability.
 */
export async function executeInE2BSandbox(options: {
  command?: string;
  files?: Array<{ path: string; content: string }>;
  timeoutMs?: number;
}) {
  const apiKey = getE2BApiKey();
  if (!apiKey) {
    throw new Error('E2B_API_KEY is not configured in environment variables.');
  }

  const { command, files = [], timeoutMs = 120_000 } = options;
  let sandbox: Sandbox | null = null;

  try {
    // Spin up an isolated E2B Sandbox in ~150ms
    sandbox = await Sandbox.create({
      apiKey,
      timeoutMs,
    });

    // Write any provided code or assets into the sandbox
    for (const file of files) {
      await sandbox.files.write(file.path, file.content);
    }

    if (!command) {
      return {
        success: true,
        message: `Successfully wrote ${files.length} file(s) into sandbox.`,
        stdout: '',
        stderr: '',
      };
    }

    // Run bash command in sandbox
    const result = await sandbox.commands.run(command, {
      timeoutMs,
    });

    return {
      success: result.exitCode === 0,
      exitCode: result.exitCode,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      error: result.error ? String(result.error) : undefined,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Error executing command in E2B sandbox',
      stdout: '',
      stderr: '',
    };
  } finally {
    if (sandbox) {
      try {
        await sandbox.kill();
      } catch (killErr) {
        // Ignore sandbox teardown errors
      }
    }
  }
}

