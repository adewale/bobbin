import type { Child } from "hono/jsx";
import { TopicList } from "./TopicList";

type TopicRelated = {
  id?: number | string;
  name: string;
  slug: string;
};

type TopicWordStats = {
  total_count: number;
  distinctiveness: number;
};

type TopicBurstStats = {
  score: number;
  peakQuarter: string | null;
};

export function TopicHeader(props: {
  title: string;
  totalChunks: number;
  totalEpisodes: number;
  wordStats?: TopicWordStats | null;
  burstStats?: TopicBurstStats | null;
  relatedTopics?: TopicRelated[];
  distinctivenessHelp?: Child;
  burstHelp?: Child;
  relatedHelp?: Child;
}) {
  return (
    <>
      <h1>{props.title}</h1>
      <div class="topic-stats-row">
        <p class="topic-header-stats">
          {props.wordStats ? <><span class="topic-mentions">{props.wordStats.total_count.toLocaleString()} mentions</span> &middot; </> : null}
          {props.totalChunks} chunk{props.totalChunks !== 1 ? "s" : ""} &middot; {props.totalEpisodes} episode{props.totalEpisodes !== 1 ? "s" : ""}
        </p>
        {props.wordStats && props.wordStats.distinctiveness > 0 ? (
          <div class="topic-distinctiveness topic-inline-heading-row">
            <span>{props.wordStats.distinctiveness.toFixed(1)}&times; distinctiveness vs baseline</span>
            {props.distinctivenessHelp}
          </div>
        ) : null}
        {props.burstStats && props.burstStats.score > 1 ? (
          <div class="topic-burst topic-inline-heading-row">
            <span>
              {props.burstStats.score.toFixed(1)}x burst
              {props.burstStats.peakQuarter ? ` in ${props.burstStats.peakQuarter.replace("-", " ")}` : ""}
            </span>
            {props.burstHelp}
          </div>
        ) : null}
      </div>

      {props.relatedTopics && props.relatedTopics.length > 0 ? (
        <div class="topic-related">
          <span class="topic-inline-heading-row">
            <span class="topic-related-label">Related:</span>
            {props.relatedHelp}
          </span>{" "}
          <TopicList topics={props.relatedTopics} layout="run" />
        </div>
      ) : null}
    </>
  );
}
