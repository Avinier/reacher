import { serve } from "@hono/node-server";
import { createServer, getServerPort, reddit } from "@devvit/web/server";
import { Hono } from "hono";
import { z } from "zod";

const app = new Hono();

const submitPostSchema = z.object({
  subredditName: z.string().min(1),
  title: z.string().min(1).max(300),
  text: z.string().min(1).max(40000),
  runAs: z.enum(["USER", "APP"]).default("USER"),
});

const submitCommentSchema = z.object({
  postId: z.string().min(3),
  text: z.string().min(1).max(10000),
  runAs: z.enum(["USER", "APP"]).default("USER"),
});

const sendPrivateMessageSchema = z.object({
  to: z.string().min(1).max(80).transform((value) => value.replace(/^u\//i, "").replace(/^\/u\//i, "")),
  subject: z.string().min(1).max(100),
  text: z.string().min(1).max(10000),
});

const listingSchema = z.object({
  subredditName: z.string().min(1).optional(),
  sort: z.enum(["hot", "new", "top", "rising", "controversial"]).default("hot"),
  timeframe: z.enum(["hour", "day", "week", "month", "year", "all"]).default("week"),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

function html(body: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Reacher Reddit Devvit</title>
    <style>
      body { font: 15px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; max-width: 880px; }
      form { border: 1px solid #ddd; border-radius: 8px; padding: 16px; margin: 16px 0; }
      label { display: grid; gap: 6px; margin: 10px 0; font-weight: 600; }
      input, textarea, select { font: inherit; padding: 9px; border: 1px solid #ccc; border-radius: 6px; }
      textarea { min-height: 120px; }
      button { font: inherit; padding: 9px 14px; border: 0; border-radius: 6px; background: #111; color: white; cursor: pointer; }
      code { background: #f4f4f4; padding: 2px 5px; border-radius: 4px; }
      .muted { color: #666; }
    </style>
  </head>
  <body>${body}</body>
</html>`;
}

app.get("/api/health", (c) => c.json({ ok: true, app: "reacher-reddit-devvit" }));

app.get("/", (c) =>
  c.html(
    html(`<h1>Reacher Reddit Devvit</h1>
      <p class="muted">Use this playtest surface to verify Reddit write paths. Reacher's local app should still keep operator approval before calling these actions.</p>
      <form method="post" action="/form/submit-post">
        <h2>Submit post</h2>
        <label>Subreddit <input name="subredditName" value="reacher_usage_dev" /></label>
        <label>Run as <select name="runAs"><option>USER</option><option>APP</option></select></label>
        <label>Title <input name="title" /></label>
        <label>Text <textarea name="text"></textarea></label>
        <button type="submit">Submit post</button>
      </form>
      <form method="post" action="/form/submit-comment">
        <h2>Submit comment</h2>
        <label>Post/comment fullname, e.g. <code>t3_abc123</code> <input name="postId" /></label>
        <label>Run as <select name="runAs"><option>USER</option><option>APP</option></select></label>
        <label>Text <textarea name="text"></textarea></label>
        <button type="submit">Submit comment</button>
      </form>
      <form method="post" action="/form/send-private-message">
        <h2>Send private message</h2>
        <p class="muted">Private messages are sent by the app account, not <code>runAs: USER</code>.</p>
        <label>To username <input name="to" /></label>
        <label>Subject <input name="subject" /></label>
        <label>Text <textarea name="text"></textarea></label>
        <button type="submit">Send private message</button>
      </form>`),
  ),
);

app.get("/api/posts", async (c) => {
  const parsed = listingSchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams.entries()));
  if (!parsed.success) return c.json({ ok: false, error: parsed.error.flatten() }, 400);

  const { subredditName, sort, timeframe, limit } = parsed.data;
  const options = { subredditName, timeframe, limit, pageSize: Math.min(limit, 100) };
  const listing =
    sort === "new" ? reddit.getNewPosts(options) :
    sort === "top" ? reddit.getTopPosts(options) :
    sort === "rising" ? reddit.getRisingPosts(options) :
    sort === "controversial" ? reddit.getControversialPosts(options) :
    reddit.getHotPosts(options);
  const posts = await listing.all();
  return c.json({
    ok: true,
    posts: posts.map((post) => ({
      id: post.id,
      title: post.title,
      permalink: post.permalink,
      url: post.url,
      authorName: post.authorName,
      subredditName: post.subredditName,
      score: post.score,
      numberOfComments: post.numberOfComments,
    })),
  });
});

app.post("/api/submit-post", async (c) => {
  const parsed = submitPostSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ ok: false, error: parsed.error.flatten() }, 400);
  }

  const { subredditName, title, text, runAs } = parsed.data;
  const post = await reddit.submitPost({
    runAs,
    subredditName,
    title,
    text,
  });

  return c.json({
    ok: true,
    id: post.id,
    permalink: post.permalink,
  });
});

app.post("/api/submit-comment", async (c) => {
  const parsed = submitCommentSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ ok: false, error: parsed.error.flatten() }, 400);
  }

  const { postId, text, runAs } = parsed.data;
  const comment = await reddit.submitComment({
    id: postId as `t3_${string}` | `t1_${string}`,
    text,
    runAs,
  });

  return c.json({
    ok: true,
    id: comment.id,
    permalink: comment.permalink,
  });
});

app.post("/api/send-private-message", async (c) => {
  const parsed = sendPrivateMessageSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ ok: false, error: parsed.error.flatten() }, 400);
  }

  await reddit.sendPrivateMessage(parsed.data);

  return c.json({
    ok: true,
    to: parsed.data.to,
  });
});

app.post("/form/submit-post", async (c) => {
  const body = await c.req.parseBody();
  const parsed = submitPostSchema.parse(body);
  const post = await reddit.submitPost(parsed);
  return c.html(html(`<h1>Post submitted</h1><p><a href="${post.permalink}">${post.permalink}</a></p><p><a href="/">Back</a></p>`));
});

app.post("/form/submit-comment", async (c) => {
  const body = await c.req.parseBody();
  const parsed = submitCommentSchema.parse(body);
  const comment = await reddit.submitComment({
    id: parsed.postId as `t3_${string}` | `t1_${string}`,
    text: parsed.text,
    runAs: parsed.runAs,
  });
  return c.html(html(`<h1>Comment submitted</h1><p><a href="${comment.permalink}">${comment.permalink}</a></p><p><a href="/">Back</a></p>`));
});

app.post("/form/send-private-message", async (c) => {
  const body = await c.req.parseBody();
  const parsed = sendPrivateMessageSchema.parse(body);
  await reddit.sendPrivateMessage(parsed);
  return c.html(html(`<h1>Private message sent</h1><p>Sent to u/${parsed.to}.</p><p><a href="/">Back</a></p>`));
});

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
