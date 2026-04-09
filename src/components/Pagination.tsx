import type { FC } from "hono/jsx";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  baseUrl: string;
}

export const Pagination: FC<PaginationProps> = ({
  currentPage,
  totalPages,
  baseUrl,
}) => {
  if (totalPages <= 1) return null;

  const sep = baseUrl.includes("?") ? "&" : "?";

  return (
    <nav class="pagination" aria-label="Pagination">
      {currentPage > 1 && (
        <a href={`${baseUrl}${sep}page=${currentPage - 1}`} rel="prev">
          Previous
        </a>
      )}
      <span>
        Page {currentPage} of {totalPages}
      </span>
      {currentPage < totalPages && (
        <a href={`${baseUrl}${sep}page=${currentPage + 1}`} rel="next">
          Next
        </a>
      )}
    </nav>
  );
};
