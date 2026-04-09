import type { FC } from "hono/jsx";

export const SearchForm: FC<{ query?: string }> = ({ query }) => (
  <form action="/search" method="get" class="search-form">
    <input
      type="search"
      name="q"
      value={query || ""}
      placeholder="Search Bits and Bobs..."
      aria-label="Search"
    />
    <button type="submit">Search</button>
  </form>
);
