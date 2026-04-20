import type { RichBlock, RichFootnote, RichTextNode } from "../types";

function renderNode(node: RichTextNode, key: string) {
  if (node.type === "break") return <br key={key} />;
  if (node.type === "image" && node.src) {
    return (
      <figure key={key} class="rich-image-figure">
        <img src={node.src} alt={node.alt || ""} class="rich-image" loading="lazy" />
        {node.alt ? <figcaption>{node.alt}</figcaption> : null}
      </figure>
    );
  }

  let content: any = node.text || "";
  if (node.href) content = <a href={node.href}>{content}</a>;
  if (node.superscript) content = <sup>{content}</sup>;
  if (node.strikethrough) content = <s>{content}</s>;
  if (node.underline) content = <u>{content}</u>;
  if (node.italic) content = <em>{content}</em>;
  if (node.bold) content = <strong>{content}</strong>;
  return <>{content}</>;
}

function renderAnchorTargets(block: RichBlock) {
  return (block.anchorIds || []).map((anchorId) => <a id={anchorId} class="rich-anchor-target" aria-hidden="true"></a>);
}

export function parseRichContentJson(value: string | null): RichBlock[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parseFootnotesJson(value: string | null): RichFootnote[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function renderList(blocks: RichBlock[], startIndex: number, depth: number): [any, number] {
  const items: any[] = [];
  let index = startIndex;

  while (index < blocks.length) {
    const block = blocks[index];
    if (block.type === "separator") break;
    if (block.depth < depth) break;
    if (block.depth > depth) {
      const last = items[items.length - 1];
      if (!last) break;
      const [childList, nextIndex] = renderList(blocks, index, block.depth);
      items[items.length - 1] = (
        <li class={`rich-list-item rich-depth-${depth}`}>{last.props.children}{childList}</li>
      );
      index = nextIndex;
      continue;
    }

    const content = (
      <div class="rich-block-content">
        {renderAnchorTargets(block)}
        {block.nodes.map((node, nodeIndex) => renderNode(node, `${index}-${nodeIndex}`))}
      </div>
    );
    items.push(<li class={`rich-list-item rich-depth-${depth}`}>{content}</li>);
    index += 1;
  }

  return [<ul class={`rich-list rich-depth-${depth}`}>{items}</ul>, index];
}

export function RichContent({ blocks }: { blocks: RichBlock[] }) {
  const rendered: any[] = [];
  let index = 0;

  while (index < blocks.length) {
    const block = blocks[index];
    if (block.type === "separator") {
      rendered.push(<hr key={`sep-${index}`} class="rich-separator" />);
      index += 1;
      continue;
    }

    if (block.type === "paragraph") {
      rendered.push(
        <div key={`para-${index}`} class="rich-paragraph">
          {renderAnchorTargets(block)}
          {block.nodes.map((node, nodeIndex) => renderNode(node, `${index}-${nodeIndex}`))}
        </div>
      );
      index += 1;
      continue;
    }

    const [list, nextIndex] = renderList(blocks, index, block.depth);
    rendered.push(<div key={`list-${index}`} class="rich-content-group">{list}</div>);
    index = nextIndex;
  }

  return <div class="rich-content">{rendered}</div>;
}

export function RichFootnotes({ footnotes }: { footnotes: RichFootnote[] }) {
  if (footnotes.length === 0) return null;
  return (
    <aside class="rich-footnotes">
      <hr class="rich-separator" />
      <ol>
        {footnotes.map((footnote) => (
          <li id={footnote.id} class="rich-footnote-item">
            <sup>[{footnote.label}]</sup> {footnote.text}
          </li>
        ))}
      </ol>
    </aside>
  );
}
