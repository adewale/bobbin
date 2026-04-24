import { FULL_PRODUCT_LOCAL_FIXTURE_COMMAND } from "../lib/local-dev-config";

export function EmptyArchiveState(props: { title: string; detail: string }) {
  return (
    <section class="body-panel empty-archive-state">
      <h2 class="section-heading">{props.title}</h2>
      <p>{props.detail}</p>
      <p>
        Populate the local archive with <code>{FULL_PRODUCT_LOCAL_FIXTURE_COMMAND}</code>.
      </p>
    </section>
  );
}
