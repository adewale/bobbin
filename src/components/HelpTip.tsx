export function HelpTip(props: { label: string; text: string }) {
  return (
    <details class="topic-help-tip">
      <summary aria-label={props.label} title={props.label}>?</summary>
      <div class="topic-help-tip-bubble" role="note">{props.text}</div>
    </details>
  );
}
