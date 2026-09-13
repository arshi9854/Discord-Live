// Lightweight, deterministic keyword clusters—not an LLM or semantic classifier.
const stop = new Set('about after again also because before being could doing from have hello here into just like more some that their them then there these they this those very were what when where which will with would your you the and for are but not was all can has had our out how its hey thanks thank please good great really want need know think today going been does did get got let now one two see much any something everyone'.split(' '));
export function detectTopics(messages) {
  const terms = new Map();
  messages.forEach((message, index) => {
    const tokens = new Set((message.content.toLowerCase().replace(/https?:\/\/\S+|<[^>]*>/g, ' ').match(/[\p{L}]{3,}/gu) || []).filter(word => !stop.has(word)));
    for (const word of tokens) {
      if (!terms.has(word)) terms.set(word, new Set());
      terms.get(word).add(index);
    }
  });
  const ranked = [...terms].filter(([, ids]) => ids.size >= 2).sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));
  const clusters = [];
  for (const [word, ids] of ranked) {
    const similar = clusters.find(cluster => {
      const overlap = [...ids].filter(id => cluster.ids.has(id)).length;
      return overlap / new Set([...ids, ...cluster.ids]).size >= 0.6;
    });
    if (similar) { if (similar.words.length < 2) similar.words.push(word); continue; }
    if (clusters.length < 4) clusters.push({ words: [word], ids });
  }
  return clusters.map(cluster => ({ label: cluster.words.join(' / '), count: cluster.ids.size,
    examples: [...cluster.ids].map(i => messages[i]).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 3),
  }));
}
