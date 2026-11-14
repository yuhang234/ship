import rss from '@astrojs/rss';
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { SITE, SITE_URL, url } from '../lib/site';

export const GET: APIRoute = async () => {
  const posts = (await getCollection('writing', ({ data }) => data.published))
    .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf())
    .slice(0, 50);

  return rss({
    title: SITE.title,
    description: SITE.description,
    site: SITE_URL,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      link: new URL(url(`writing/${post.id}/`), `${SITE_URL}/`).href,
      categories: [...(post.data.tags ?? []), post.data.category].filter(Boolean),
    })),
    customData: `<language>${SITE.language}</language>`,
    trailingSlash: true,
  });
};
