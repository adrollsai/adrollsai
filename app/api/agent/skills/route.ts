import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export const maxDuration = 60;

/**
 * Business skills: upload, list, update, delete.
 *
 * Accepts either a plain text/markdown body or an uploaded file. For files we
 * extract text rather than storing the binary — a skill the agent cannot read is
 * useless, and keeping binaries would mean an extraction step on every read.
 *
 * Text-like formats are read directly. Anything else gets a clear refusal naming
 * the formats that work, instead of silently storing bytes that will never load.
 */

const TEXT_EXT = /\.(md|markdown|txt|text|json|ya?ml|csv|tsv)$/i;
const MAX_CHARS = 60_000;

/** Derive a usable name + description when the file does not declare them. */
function inferMeta(content: string, fallbackName: string) {
  const lines = content.split('\n').map((l) => l.trim());
  const heading = lines.find((l) => /^#{1,3}\s+/.test(l));
  const name = (heading ? heading.replace(/^#{1,3}\s+/, '') : fallbackName).trim().slice(0, 120);

  // First real paragraph after the heading, stripped of prose padding.
  const body = lines.filter((l) => l && !/^#{1,6}\s+/.test(l) && !/^[-*|]/.test(l));
  const description = (body[0] || '').replace(/^\*+|\*+$/g, '').slice(0, 300) || `Uploaded skill: ${name}`;
  return { name, description };
}

async function readTextFromFile(file: File): Promise<{ text: string; filename: string } | { error: string }> {
  const filename = file.name || 'skill.txt';
  const isTextish =
    TEXT_EXT.test(filename) ||
    (file.type || '').startsWith('text/') ||
    /json|yaml|markdown|xml/i.test(file.type || '');

  if (!isTextish) {
    return {
      error:
        `"${filename}" is a ${file.type || 'binary'} file, which I cannot read as a skill. ` +
        `Upload it as .md, .txt, .json, .yaml or .csv — or paste the text directly. ` +
        `If it is a Word or PDF document, export it to text first.`,
    };
  }

  const text = await file.text();
  if (!text.trim()) return { error: `"${filename}" is empty.` };
  if (text.length > MAX_CHARS) {
    return { error: `"${filename}" is ${text.length.toLocaleString()} characters; the limit is ${MAX_CHARS.toLocaleString()}. Split it into two skills.` };
  }
  return { text, filename };
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('agent_skills')
    .select('id, name, description, source_filename, enabled, created_at, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) {
      return NextResponse.json({ skills: [], needsMigration: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ skills: data || [] });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const contentType = req.headers.get('content-type') || '';
  let text = '';
  let filename: string | null = null;
  let name = '';
  let description = '';

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 });

    const read = await readTextFromFile(file);
    if ('error' in read) return NextResponse.json({ error: read.error }, { status: 400 });
    text = read.text;
    filename = read.filename;
    name = String(form.get('name') || '').trim();
    description = String(form.get('description') || '').trim();
  } else {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Expected JSON or a file upload.' }, { status: 400 });
    text = String(body.content || '').trim();
    name = String(body.name || '').trim();
    description = String(body.description || '').trim();
  }

  if (!text) return NextResponse.json({ error: 'The skill has no content.' }, { status: 400 });
  if (text.length > MAX_CHARS) {
    return NextResponse.json({ error: `Skill is over ${MAX_CHARS.toLocaleString()} characters.` }, { status: 400 });
  }

  const inferred = inferMeta(text, name || (filename ? filename.replace(/\.[^.]+$/, '') : 'Untitled skill'));
  name = name || inferred.name;
  description = description || inferred.description;

  const { data, error } = await supabase
    .from('agent_skills')
    .upsert(
      {
        user_id: user.id,
        name,
        description,
        content: text,
        source_filename: filename,
        enabled: true,
      },
      { onConflict: 'user_id,name' }
    )
    .select('id, name, description')
    .maybeSingle();

  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) {
      return NextResponse.json(
        { error: 'Skills are not enabled on this database yet (agent_skills table missing).' },
        { status: 503 }
      );
    }
    // The unique index is on lower(name); upsert on the raw name can miss it.
    if (/duplicate|unique/i.test(error.message)) {
      const { error: updateError } = await supabase
        .from('agent_skills')
        .update({ description, content: text, source_filename: filename, enabled: true })
        .eq('user_id', user.id)
        .ilike('name', name);
      if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
      return NextResponse.json({ ok: true, updated: true, name });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, skill: data, name, description });
}

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const id = body?.id ? String(body.id) : '';
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.description === 'string' && body.description.trim()) patch.description = body.description.trim();
  if (typeof body.content === 'string' && body.content.trim()) patch.content = body.content;
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });

  const { error } = await supabase.from('agent_skills').update(patch).eq('id', id).eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const { error } = await supabase.from('agent_skills').delete().eq('id', id).eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
