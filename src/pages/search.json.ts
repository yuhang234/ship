import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { isoStamp, isoUtc } from '../lib/date';
import type { SearchDoc } from '../lib/search';
import { stripMarkdown } from '../lib/text';
import { url } from '../lib/site';

const LIMIT = 4000;

export const GET: APIRoute = async () => {
  const thoughts = (await getCollection('thoughts')).sort(
    (a, b) => b.data.createdAt.valueOf() - a.data.createdAt.valueOf(),
  );
  const posts = (await getCollection('writing', ({ data }) => data.published)).sort(
    (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf(),
  );

  const docs: SearchDoc[] = [];

  for (const thought of thoughts) {
    docs.push({
      kind: 'thought',
      id: thought.id,
      title: '',
      url: url(`thoughts/#${thought.id}`),
      date: isoStamp(thought.data.createdAt),
      iso: isoUtc(thought.data.createdAt),
      tags: [...thought.data.tags],
      text: stripMarkdown(thought.body ?? '').slice(0, LIMIT),
    });
  }

  for (const post of posts) {
    docs.push({
      kind: 'writing',
      id: post.id,
      title: post.data.title,
      url: url(`writing/${post.id}/`),
      date: isoStamp(post.data.pubDate),
      iso: isoUtc(post.data.pubDate),
      tags: [...post.data.tags],
      text: stripMarkdown(post.body ?? '').slice(0, LIMIT),
    });
  }

  return new Response(JSON.stringify(docs), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
};
