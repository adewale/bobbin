import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "@playwright/test";

const DEFAULT_BASE_URL = process.env.BASE_URL || "http://127.0.0.1:9090";
const DEFAULT_RICH_CHUNK_PATH = process.env.RICH_CHUNK_PATH || "/chunks/an-idea-from-epictetus-blame-no-one-including-yourself-2025-10-13-1xRiCq-135";

function parseArgs(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    outputPath: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--base-url") {
      options.baseUrl = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--output") {
      options.outputPath = argv[index + 1];
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.baseUrl) {
    throw new Error("--base-url requires a value");
  }

  if (argv.includes("--output") && !options.outputPath) {
    throw new Error("--output requires a path");
  }

  return options;
}

function joinUrl(baseUrl, path) {
  return new URL(path, baseUrl).toString();
}

async function auditDesign(page, baseUrl) {
  await page.goto(joinUrl(baseUrl, "/design"), { waitUntil: "networkidle" });

  return page.evaluate(() => {
    const styleOf = (selector, props, index = 0) => {
      const node = document.querySelectorAll(selector)[index];
      if (!node) return null;
      const style = getComputedStyle(node);
      return {
        selector,
        ...Object.fromEntries(props.map((prop) => [prop, style.getPropertyValue(prop) || style[prop] || null])),
      };
    };

    const svgOf = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const polyline = node.querySelector("polyline");
      const style = polyline ? getComputedStyle(polyline) : null;

      return {
        selector,
        viewBox: node.getAttribute("viewBox"),
        renderedWidth: Math.round(node.getBoundingClientRect().width * 100) / 100,
        renderedHeight: Math.round(node.getBoundingClientRect().height * 100) / 100,
        attrStroke: polyline?.getAttribute("stroke") || null,
        computedStroke: style?.stroke || null,
        computedStrokeWidth: style?.strokeWidth || null,
      };
    };

    const topicCloudTopics = Array.from(document.querySelectorAll("#topics .topic-cloud .topic"))
      .slice(0, 3)
      .map((node) => ({
        text: node.textContent?.trim() || "",
        fontSize: getComputedStyle(node).fontSize,
      }));

    const designChunkHref = document.querySelector('#source-fidelity .topic-observation-meta a[href^="/chunks/"]')?.getAttribute("href") || null;

    return {
      sourceChunkHref: designChunkHref,
      layout: {
        main: styleOf("main", ["max-width", "margin-top", "padding-left", "padding-right"]),
        pageWithRail: styleOf(".page-with-rail", ["display", "grid-template-columns", "column-gap", "max-width"]),
        pageBody: styleOf(".page-body.page-body-single", ["max-width"]),
        pageRail: styleOf(".page-rail", ["font-family"]),
      },
      header: {
        siteTitle: styleOf(".site-title", ["font-family", "font-size", "font-weight", "letter-spacing", "text-transform", "color"]),
        navLink: styleOf("header ul a", ["font-family", "font-size", "color", "text-decoration-line"]),
        headerSearchInput: styleOf(".header-search input", ["font-family", "font-size", "width", "background-color", "border-top-color"]),
      },
      breadcrumbs: styleOf(".breadcrumbs", ["font-family", "font-size", "color", "margin-bottom"]),
      catalogue: {
        grid: styleOf(".component-catalogue", ["display", "grid-template-columns", "column-gap", "row-gap"]),
        familyHeading: styleOf(".component-family h3", ["font-family", "font-size", "font-weight", "letter-spacing", "text-transform", "color"]),
        rowTitle: styleOf(".component-family .list-row-title", ["font-family", "font-size", "font-weight", "line-height", "color"]),
        rowMeta: styleOf(".component-family .list-row-meta", ["font-family", "font-size", "line-height", "color"]),
      },
      searchForm: {
        form: styleOf(".search-form", ["display", "column-gap", "margin-bottom"]),
        input: styleOf(".search-form input", ["font-family", "font-size", "background-color", "border-top-color", "padding-top", "padding-right", "padding-bottom", "padding-left"]),
        button: styleOf(".search-form button", ["font-family", "font-size", "font-weight", "background-color", "color", "padding-top", "padding-right", "padding-bottom", "padding-left"]),
      },
      episodeCard: {
        title: styleOf(".episode-card h2", ["font-family", "font-size", "font-weight", "line-height", "margin-top", "margin-bottom"]),
        time: styleOf(".episode-card time", ["font-family", "font-size", "color"]),
        count: styleOf(".chunk-count", ["font-family", "font-size", "color", "background-color"]),
      },
      chunkCard: {
        title: styleOf(".chunk-card h3", ["font-family", "font-size", "font-weight", "line-height", "color"]),
        episodeLink: styleOf(".chunk-card .episode-link", ["font-family", "font-size", "line-height", "color"]),
        excerpt: styleOf(".chunk-card .excerpt", ["font-family", "font-size", "line-height", "color"]),
      },
      browse: {
        yearHeading: styleOf(".browse-year h2", ["font-family", "font-size", "font-weight", "border-bottom-color", "border-bottom-width"]),
        monthHeading: styleOf(".browse-month h3", ["font-family", "font-size", "font-weight", "letter-spacing", "text-transform", "color"]),
        rowTitle: styleOf("#browse .list-row-title", ["font-family", "font-size", "font-weight", "line-height", "color"]),
        rowMeta: styleOf("#browse .list-row-meta", ["font-family", "font-size", "line-height", "color"]),
      },
      topics: {
        pageTitle: styleOf(".component-topic-header h1", ["font-family", "font-size", "font-weight", "font-style", "line-height", "color"]),
        stats: styleOf(".topic-header-stats", ["font-family", "font-size", "line-height", "color"]),
        relatedLabel: styleOf(".topic-related-label", ["font-family", "font-size", "font-weight", "color"]),
        chip: styleOf(".component-chip-strip .topic", ["font-family", "font-size", "line-height", "background-color", "border-top-color", "color"]),
        inlineLink: styleOf(".component-inline-strip a", ["font-family", "font-size", "line-height", "color"]),
        cloudSamples: topicCloudTopics,
        railLink: styleOf(".component-topic-rail .rail-panel-list a", ["font-family", "font-size", "line-height", "color"]),
        railHeading: styleOf(".component-topic-rail h3", ["font-family", "font-size", "font-weight", "letter-spacing", "text-transform", "color"]),
        railChart: svgOf(".component-topic-rail-chart .rail-sparkline"),
        sectionChartHeading: styleOf(".component-topic-section-chart .section-heading", ["font-family", "font-size", "font-weight", "letter-spacing", "text-transform", "color"]),
        sectionChartMeta: styleOf(".component-topic-section-chart .section-meta", ["font-family", "font-size", "line-height", "color"]),
        sectionChart: svgOf(".component-topic-section-chart .topic-spark-svg"),
      },
      sourceFidelity: {
        content: styleOf(".rich-content", ["display", "row-gap", "column-gap", "font-family", "font-size", "line-height", "color"]),
        list: styleOf(".rich-list", ["padding-left"]),
        footnotes: styleOf(".rich-footnotes", ["font-family", "font-size", "line-height", "color", "margin-top"]),
      },
      emptyState: {
        container: styleOf(".empty-archive-state", ["display", "margin-top", "padding-top", "padding-right", "padding-bottom", "padding-left", "background-color", "border-top-color"]),
        heading: styleOf(".empty-archive-state .section-heading", ["font-family", "font-size", "font-weight", "letter-spacing", "text-transform", "color"]),
        paragraph: styleOf(".empty-archive-state p", ["font-family", "font-size", "line-height", "color"]),
      },
      pagination: {
        nav: styleOf(".pagination", ["display", "column-gap", "font-family", "font-size"]),
        link: styleOf(".pagination a", ["font-family", "font-size", "color", "border-top-color", "padding-top", "padding-right", "padding-bottom", "padding-left"]),
        text: styleOf(".pagination span", ["font-family", "font-size", "color"]),
      },
    };
  });
}

async function auditTopics(page, baseUrl) {
  await page.goto(joinUrl(baseUrl, "/topics"), { waitUntil: "networkidle" });

  return page.evaluate(() => {
    const styleOf = (selector, props, index = 0) => {
      const node = document.querySelectorAll(selector)[index];
      if (!node) return null;
      const style = getComputedStyle(node);
      return {
        selector,
        ...Object.fromEntries(props.map((prop) => [prop, style.getPropertyValue(prop) || style[prop] || null])),
      };
    };

    const svg = document.querySelector(".multiple-spark.rail-sparkline");
    const polyline = svg?.querySelector("polyline");
    const style = polyline ? getComputedStyle(polyline) : null;

    return {
      grid: styleOf(".multiples-grid", ["display", "grid-template-columns", "column-gap", "row-gap"]),
      cell: styleOf(".multiple-cell", ["display", "min-height", "padding-top", "padding-right", "padding-bottom", "padding-left", "border-top-color", "background-color"]),
      title: styleOf(".multiple-name", ["font-family", "font-size", "font-weight", "line-height", "color"]),
      count: styleOf(".multiple-count", ["font-family", "font-size", "line-height", "color"]),
      sparkline: {
        viewBox: svg?.getAttribute("viewBox") || null,
        renderedWidth: svg ? Math.round(svg.getBoundingClientRect().width * 100) / 100 : null,
        renderedHeight: svg ? Math.round(svg.getBoundingClientRect().height * 100) / 100 : null,
        attrStroke: polyline?.getAttribute("stroke") || null,
        computedStroke: style?.stroke || null,
        computedStrokeWidth: style?.strokeWidth || null,
      },
    };
  });
}

async function auditHome(page, baseUrl) {
  await page.goto(joinUrl(baseUrl, "/"), { waitUntil: "networkidle" });

  return page.evaluate(() => {
    const svg = document.querySelector(".home-novel-topic-history .rail-sparkline");
    const polyline = svg?.querySelector("polyline");
    const style = polyline ? getComputedStyle(polyline) : null;

    return {
      novelTopicHistory: {
        viewBox: svg?.getAttribute("viewBox") || null,
        renderedWidth: svg ? Math.round(svg.getBoundingClientRect().width * 100) / 100 : null,
        renderedHeight: svg ? Math.round(svg.getBoundingClientRect().height * 100) / 100 : null,
        attrStroke: polyline?.getAttribute("stroke") || null,
        computedStroke: style?.stroke || null,
        computedStrokeWidth: style?.strokeWidth || null,
      },
    };
  });
}

async function auditRichChunk(page, url) {
  await page.goto(url, { waitUntil: "networkidle" });

  return page.evaluate(() => {
    const styleOf = (selector, props) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const style = getComputedStyle(node);
      return {
        selector,
        ...Object.fromEntries(props.map((prop) => [prop, style.getPropertyValue(prop) || style[prop] || null])),
      };
    };

    return {
      content: styleOf(".rich-content", ["display", "row-gap", "column-gap", "font-family", "font-size", "line-height", "color"]),
      list: styleOf(".rich-list", ["padding-left"]),
      paragraph: styleOf(".rich-paragraph", ["font-family", "font-size", "line-height", "color"]),
      footnotes: styleOf(".rich-footnotes", ["font-family", "font-size", "line-height", "color", "margin-top"]),
      footnoteItem: styleOf(".rich-footnote-item", ["font-family", "font-size", "line-height", "color"]),
    };
  });
}

async function auditMobile(page, baseUrl) {
  await page.goto(joinUrl(baseUrl, "/design"), { waitUntil: "networkidle" });
  const design = await page.evaluate(() => ({
    catalogue: getComputedStyle(document.querySelector(".component-catalogue")).gridTemplateColumns,
    railRow: getComputedStyle(document.querySelector(".component-topic-rail-row")).gridTemplateColumns,
  }));

  await page.goto(joinUrl(baseUrl, "/topics"), { waitUntil: "networkidle" });
  const topics = await page.evaluate(() => ({
    grid: getComputedStyle(document.querySelector(".multiples-grid")).gridTemplateColumns,
    sparkWidth: Math.round(document.querySelector(".multiple-spark.rail-sparkline").getBoundingClientRect().width * 100) / 100,
  }));

  return { design, topics };
}

async function writeOutput(outputPath, contents) {
  const resolvedPath = resolve(outputPath);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, contents, "utf8");
  return resolvedPath;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const browser = await chromium.launch({ headless: true });
  const desktopPage = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
  const mobilePage = await browser.newPage({ viewport: { width: 390, height: 1100 } });

  try {
    const design = await auditDesign(desktopPage, options.baseUrl);
    const topics = await auditTopics(desktopPage, options.baseUrl);
    const home = await auditHome(desktopPage, options.baseUrl);
    const mobile = await auditMobile(mobilePage, options.baseUrl);
    const richChunkUrl = design.sourceChunkHref
      ? joinUrl(options.baseUrl, design.sourceChunkHref)
      : joinUrl(options.baseUrl, DEFAULT_RICH_CHUNK_PATH);
    const richChunk = await auditRichChunk(desktopPage, richChunkUrl);

    const report = {
      generatedAt: new Date().toISOString(),
      baseUrl: options.baseUrl,
      richChunkUrl,
      desktop: {
        design,
        topics,
        home,
        richChunk,
      },
      mobile,
    };

    const output = `${JSON.stringify(report, null, 2)}\n`;

    if (options.outputPath) {
      const resolvedPath = await writeOutput(options.outputPath, output);
      process.stdout.write(`${resolvedPath}\n`);
      return;
    }

    process.stdout.write(output);
  } finally {
    await mobilePage.close();
    await desktopPage.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error("Computed-values audit failed:", error);
  process.exit(1);
});
