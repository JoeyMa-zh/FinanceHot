// Topic pages: which articles a topic takes, and their counts.
// Written before the code, from the ways it can go wrong:
// - a company topic takes an article about another company that only mentions it (several subjects,
//   its name nowhere in the title), or drops one about it whose title names it in English, in another
//   case, next to Chinese text, or only by a product (it is the article's only subject);
// - a Latin name matches inside another word ("Metadata" is not Meta); a headline naming a company
//   that is not a subject of the article gets in;
// - a technical-direction topic stops taking its tags;
// - withdrawn or not yet released articles appear in a list or a count;
// - an article or story page names a topic its reports do not belong to;
// - a topic without content has no page, or an unknown slug or a page past the end has one.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { publishArticle } from "@aihot/backend/publication/publish";
import { TOPICS, loadTopicPage, listTopicSummaries, topicsOfStory } from "@aihot/backend/publication/topics";
import { buildApp } from "../apps/api/src/app.ts";

const T = tag();
const OFFICIAL = `test-topics-official-${T}`;
const MEDIA = `test-topics-media-${T}`;
const app = await buildApp();

before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, first_party, next_fetch_at) VALUES
    (${OFFICIAL}, 'Official', 'rss', 'T1', 'editorial', true, '2100-01-01'),
    (${MEDIA}, 'Media', 'rss', 'T2', 'editorial', false, '2100-01-01')`;
});
after(async () => {
  await app.close();
  await stopBoss();
  await closeDb();
});

let n = 0;
interface Report {
  source?: string;
  at: Date;
  title: string;
  originalTitle?: string;
  subjects?: string[];
  tags?: string[];
  score?: number;
  selected?: boolean;
  fact?: number;
  category?: string;
}

/** A published report; `fact` links it to a fact before publishing, as grouping would. */
async function report(r: Report): Promise<string> {
  n += 1;
  const { articleId } = await upsertMaterial({
    sourceId: r.source ?? MEDIA, url: `https://example.com/topics-${T}-${n}`, title: r.originalTitle ?? r.title, bodyText: "body", bodyHtml: "<p>body</p>", bodyStatus: "ok", via: "fetch", publishedAt: r.at,
  });
  await sql`UPDATE articles SET discovered_at = ${r.at}, timeline_at = ${r.at}, grouped_at = now() WHERE id = ${articleId}`;
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected, subjects, tags)
            VALUES (${articleId}, 1, 'rule', 'pass', ${r.category ?? "earnings"}, ${r.title}, ${`摘要 ${n}`}, ${r.score ?? 80}, ${r.selected ?? true}, ${r.subjects ?? []}, ${[{ earnings: "公司财报", macro: "宏观数据", "market-move": "市场行情", opinion: "市场观点", commentary: "市场观点" }[r.category ?? "earnings"] ?? "公司财报", ...(r.tags ?? [])]})`;
  if (r.fact) await sql`INSERT INTO fact_articles (fact_id, article_id, role) VALUES (${r.fact}, ${articleId}, 'report')`;
  await publishArticle(articleId, { releasedAt: new Date(r.at.getTime() + 60_000) });
  return articleId;
}

async function story(title: string): Promise<{ id: number; publicId: string }> {
  const publicId = randomUUID();
  const [s] = await sql<{ id: number }[]>`INSERT INTO stories (public_id, title, first_report_at, latest_at) VALUES (${publicId}, ${title}, now(), now()) RETURNING id`;
  return { id: s!.id, publicId };
}

async function fact(storyId: number | null, title: string): Promise<number> {
  const [f] = await sql<{ id: number }[]>`INSERT INTO facts (public_id, story_id, title) VALUES (${`f-${T}-${randomUUID()}`}, ${storyId}, ${title}) RETURNING id`;
  return f!.id;
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
const ids = (items: Array<{ id: string }>) => items.map((i) => i.id);
const page = async (slug: string, p = 1) => {
  const data = await loadTopicPage(slug, p, new Date());
  assert.ok(data, `${slug} page ${p}`);
  return data;
};
/** Every article of a topic, over all its pages. */
async function members(slug: string): Promise<string[]> {
  const first = await page(slug);
  const out = ids(first.items);
  for (let p = 2; p <= first.pageCount; p++) out.push(...ids((await page(slug, p)).items));
  return out;
}

test("a company topic takes the articles about it, not the ones that only mention it", async () => {
  const about = await report({ at: hoursAgo(30), title: `iPhone 销量超预期 ${T}`, subjects: ["apple"] });
  const product = await report({ at: hoursAgo(31), title: `iPad 新版上线 ${T}`, subjects: ["apple"] });
  const english = await report({ at: hoursAgo(32), title: `新财报发布 ${T}`, originalTitle: `Apple raises guidance ${T}`, subjects: ["apple", "microsoft"] });
  const subpoena = await report({ at: hoursAgo(33), title: `欧盟向微软发出反垄断传票 ${T}`, subjects: ["microsoft", "apple", "broadcom"] });
  const lowerCase = await report({ at: hoursAgo(34), title: `microsoft 公布新的回购计划 ${T}`, subjects: ["microsoft", "apple"] });
  const pact = await report({ at: hoursAgo(35), title: `多家科技巨头签署安全协议 ${T}`, subjects: ["microsoft", "apple", "alphabet"] });
  const metadata = await report({ at: hoursAgo(36), title: `Metadata 标准发布，微软参与 ${T}`, subjects: ["meta", "microsoft"] });
  const adjacent = await report({ at: hoursAgo(37), title: `发布Meta的新广告工具 ${T}`, subjects: ["meta", "microsoft"] });
  const headline = await report({ at: hoursAgo(38), title: `苹果被一篇盘点提到 ${T}`, subjects: ["alphabet"] });
  const goldNote = await report({ at: hoursAgo(39), title: `黄金避险需求升温 ${T}`, tags: ["黄金"] });

  const apple = await members("apple");
  for (const id of [about, product, english]) assert.ok(apple.includes(id), "about Apple");
  for (const id of [subpoena, lowerCase, pact, headline]) assert.ok(!apple.includes(id), "only mentions Apple");
  const microsoft = await members("microsoft");
  for (const id of [subpoena, lowerCase, metadata]) assert.ok(microsoft.includes(id), "about Microsoft");
  for (const id of [english, pact]) assert.ok(!microsoft.includes(id), "only mentions Microsoft");
  const meta = await members("meta");
  assert.ok(meta.includes(adjacent), "Meta next to Chinese text");
  assert.ok(!meta.includes(metadata), "Metadata is not Meta");
  assert.ok((await members("gold")).includes(goldNote), "a field topic takes its tag");

  // The article page names the topics it belongs to.
  const topicsOf = async (id: string) => {
    const res = await app.inject({ method: "GET", url: `/api/site/items/${id}` });
    return (JSON.parse(res.body) as { topics: Array<{ slug: string }> }).topics.map((t) => t.slug);
  };
  assert.deepEqual(await topicsOf(about), ["apple", "earnings"]);
  assert.deepEqual(await topicsOf(subpoena), ["microsoft", "earnings"]);
  assert.deepEqual(await topicsOf(pact), ["earnings"]);
  assert.deepEqual(await topicsOf(goldNote), ["gold", "earnings"]);
});

test("a story page names the topics of its reports", async () => {
  const launch = await story(`黄金避险交易升温 ${T}`);
  await report({ source: OFFICIAL, at: hoursAgo(26), title: `黄金避险交易升温 ${T}`, tags: ["黄金"], fact: await fact(launch.id, "避险买盘进入黄金") });
  assert.deepEqual(await topicsOfStory(launch.id), [{ slug: "gold", name: "黄金" }, { slug: "earnings", name: "公司财报" }]);
});

test("withdrawn articles stay out of lists and counts", async () => {
  const kept = await report({ at: hoursAgo(5), title: `特斯拉发布新车型 ${T}`, subjects: ["tesla"] });
  const withdrawn = await report({ at: hoursAgo(4), title: `特斯拉撤回的声明 ${T}`, subjects: ["tesla"] });
  await sql`UPDATE publications SET visibility = 'withdrawn' WHERE article_id = ${withdrawn}`;

  const data = await page("tesla");
  assert.deepEqual(ids(data.items), [kept]);
  assert.equal(data.topic.total, 1);
  const summary = (await listTopicSummaries()).topics.find((t) => t.slug === "tesla")!;
  assert.equal(summary.latest?.title, `特斯拉发布新车型 ${T}`, "the index shows the newest public article");
});

test("every topic has a page; unknown topics and pages past the end have none", async () => {
  const empty = await page("ipo");
  assert.equal(empty.topic.indexable, false, "a topic without content is not indexed");
  assert.deepEqual(empty.items, []);
  assert.equal(await loadTopicPage("not-a-topic", 1, new Date()), null);
  assert.equal(await loadTopicPage("ipo", 2, new Date()), null);
  const index = await app.inject({ method: "GET", url: "/api/site/topics" });
  const body = JSON.parse(index.body) as { groups: Array<{ key: string }>; topics: Array<{ slug: string }> };
  assert.deepEqual(body.groups.map((g) => g.key), ["company", "field", "genre"]);
  assert.deepEqual(body.topics.map((t) => t.slug).sort(), TOPICS.map((t) => t.slug).sort(), "the index lists every topic");
});
