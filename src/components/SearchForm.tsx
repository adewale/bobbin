import type { FC } from "hono/jsx";

export const SearchForm: FC<{ query?: string; autofocus?: boolean; view?: string }> = ({ query, autofocus, view }) => (
  <form action="/search" method="get" class="search-form">
    <input
      type="search"
      name="q"
      value={query || ""}
      placeholder="Search Bits and Bobs..."
      aria-label="Search"
      autofocus={autofocus}
    />
    {view === "browse" && <input type="hidden" name="view" value="browse" />}
    <button type="submit">Search</button>
  </form>
);
