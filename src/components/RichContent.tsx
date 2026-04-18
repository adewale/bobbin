import type { RichBlock, RichTextNode } from "../types";

function renderNode(node: RichTextNode, key: string) {
  if (node.type === "break") return <br key={key} />;
  if (node.type === "image" && node.src) {
    return <img key={key} src={node.src} alt={node.alt || ""} class="rich-image" loading="lazy" />;
  }

  let content: any = node.text || "";
  if (node.href) content = <a href={node.href}>{content}</a>;
  if (node.superscript) content = <sup>{content}</sup>;
  if (node.strikethrough) content = <s>{content}</s>;
  if (node.underline) content = <u>{content}</u>;
  if (node.italic) content = <em>{content}</em>;
  if (node.bold) content = <strong>{content}</strong>;
  return <span key={key}>{content}</span>;
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

export function RichContent({ blocks }: { blocks: RichBlock[] }) {
  return (
    <div class="rich-content">
      {blocks.map((block, index) => {
        if (block.type === "separator") {
          return <hr key={`sep-${index}`} class="rich-separator" />;
        }

        return (
          <div
            key={`block-${index}`}
            class={`rich-block rich-depth-${block.depth}`}
            style={{ paddingLeft: `${block.depth * 1.25}rem` }}
          >
            <span class="rich-bullet" aria-hidden="true">•</span>
            <div class="rich-block-content">
              {block.nodes.map((node, nodeIndex) => renderNode(node, `${index}-${nodeIndex}`))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
