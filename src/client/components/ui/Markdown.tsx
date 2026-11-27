import React from 'react';

/**
 * Small Markdown renderer for descriptions and notes. Builds React elements directly
 * (never innerHTML) and only links http(s) URLs, so user content cannot inject markup.
 *
 * Supports: # headings, - / * / 1. lists, - [ ] checklists, > quotes, --- rules,
 * ``` code blocks, **bold**, *italic*, `code`, [text](url) and bare URLs.
 */

const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|https?:\/\/[^\s<]+[^\s<.,;:!?)])/g;

const safeHref = (url: string) => (/^https?:\/\//i.test(url) ? url : null);

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const token = m[0];
    const start = m.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const key = `${keyPrefix}-${i++}`;
    if (token.startsWith('**')) {
      out.push(<strong key={key} className="font-semibold">{renderInline(token.slice(2, -2), key)}</strong>);
    } else if (token.startsWith('`')) {
      out.push(<code key={key} className="px-1 py-0.5 rounded bg-subtle border border-line font-mono text-[0.9em] text-tone-red-fg">{token.slice(1, -1)}</code>);
    } else if (token.startsWith('[')) {
      const [, label, url] = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/) ?? [];
      const href = safeHref(url ?? '');
      out.push(
        href ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer" className="text-accent-ink underline underline-offset-2 decoration-line-strong hover:decoration-current">
            {label}
          </a>
        ) : (
          label
        )
      );
    } else if (token.startsWith('http')) {
      out.push(
        <a key={key} href={token} target="_blank" rel="noopener noreferrer" className="text-accent-ink underline underline-offset-2 decoration-line-strong hover:decoration-current break-all">
          {token}
        </a>
      );
    } else {
      out.push(<em key={key}>{renderInline(token.slice(1, -1), key)}</em>);
    }
    last = start + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export const Markdown: React.FC<{ source: string; className?: string }> = ({ source, className = '' }) => {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const key = `b${i}`;

    if (line.trim() === '') {
      i++;
      continue;
    }

    if (line.startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++]);
      i++;
      blocks.push(
        <pre key={key} className="my-3 p-3 rounded-md bg-subtle border border-line font-mono text-meta overflow-x-auto whitespace-pre">
          {body.join('\n')}
        </pre>
      );
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const cls = level === 1 ? 'text-xl font-semibold mt-6 mb-2' : level === 2 ? 'text-lg font-semibold mt-5 mb-1.5' : 'text-base font-semibold mt-4 mb-1';
      const Tag = (`h${level + 2}` as 'h3' | 'h4' | 'h5');
      blocks.push(<Tag key={key} className={`${cls} text-fg first:mt-0`}>{renderInline(heading[2], key)}</Tag>);
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      blocks.push(<hr key={key} className="my-4 border-line" />);
      i++;
      continue;
    }

    if (line.startsWith('>')) {
      const body: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) body.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push(
        <blockquote key={key} className="my-3 pl-3 border-l-[3px] border-fg text-fg-muted">
          {renderInline(body.join(' '), key)}
        </blockquote>
      );
      continue;
    }

    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        const text = lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '');
        const check = text.match(/^\[( |x|X)\]\s+(.*)$/);
        const ik = `${key}-${items.length}`;
        items.push(
          check ? (
            <li key={ik} className="flex items-start gap-2 list-none -ml-5">
              <span aria-hidden="true" className={`mt-[3px] w-3.5 h-3.5 shrink-0 rounded-sm border ${check[1] !== ' ' ? 'bg-accent border-accent' : 'border-line-strong'}`} />
              <span className={check[1] !== ' ' ? 'line-through text-fg-faint' : ''}>
                <span className="sr-only">{check[1] !== ' ' ? 'Done: ' : 'To do: '}</span>
                {renderInline(check[2], ik)}
              </span>
            </li>
          ) : (
            <li key={ik}>{renderInline(text, ik)}</li>
          )
        );
        i++;
      }
      blocks.push(
        ordered ? (
          <ol key={key} className="my-2 pl-5 list-decimal space-y-1">{items}</ol>
        ) : (
          <ul key={key} className="my-2 pl-5 list-disc space-y-1 marker:text-fg-faint">{items}</ul>
        )
      );
      continue;
    }

    // Paragraph: consecutive non-special lines
    const body: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,3}\s|>|```|\s*([-*]|\d+\.)\s+)/.test(lines[i])) body.push(lines[i++]);
    blocks.push(
      <p key={key} className="my-2 first:mt-0">
        {body.map((l, j) => (
          <React.Fragment key={j}>
            {j > 0 && <br />}
            {renderInline(l, `${key}-${j}`)}
          </React.Fragment>
        ))}
      </p>
    );
  }

  return <div className={`text-body leading-relaxed text-fg break-words ${className}`}>{blocks}</div>;
};
